import { basename, resolve } from "node:path";
import { expandTemplate } from "../adapters/config";
import type { GitGateway, GitWorktreeEntry } from "../adapters/git";
import type { PortProbe } from "../adapters/port-probe";
import {
  buildProjectSessionName,
  buildWorktreeParkingWindowName,
  buildWorktreeWindowName,
  WM_WINDOW_ROLE_OPTION,
  WM_WORKTREE_ID_OPTION,
  type TmuxGateway,
  type TmuxPaneSummary,
  type TmuxWindowRole,
  type TmuxWindowSummary,
} from "../adapters/tmux";
import { buildRuntimeEnvMap, readWorktreeMeta, readWorktreePrs } from "../adapters/fs";
import type { AgentId, ProjectConfig } from "../domain/config";
import type { OneshotMeta, PrEntry, ServiceRuntimeState, WorktreeSource, WorktreeTab } from "../domain/model";
import { mapWithConcurrency } from "../lib/async";
import { ProjectRuntime } from "./project-runtime";
import type { ComponentCatalogService } from "./component-catalog-service";
import { ComponentMonitorService } from "./component-monitor-service";
import type { ComponentRuntimeState } from "../domain/components";

function makeUnmanagedWorktreeId(path: string): string {
  return `unmanaged:${resolve(path)}`;
}

function isValidPort(port: number | null): port is number {
  return port !== null && Number.isInteger(port) && port >= 1 && port <= 65535;
}

async function buildServiceStates(
  deps: Pick<ReconciliationServiceDependencies, "config" | "portProbe">,
  input: {
    allocatedPorts: Record<string, number>;
    startupEnvValues: Record<string, string>;
    worktreeId: string;
    branch: string;
    profile: string;
    agent: AgentId;
    runtime: "host" | "docker";
  },
): Promise<ServiceRuntimeState[]> {
  const runtimeEnv = buildRuntimeEnvMap({
    schemaVersion: 1,
    worktreeId: input.worktreeId,
    branch: input.branch,
    createdAt: "",
    profile: input.profile,
    agent: input.agent,
    runtime: input.runtime,
    startupEnvValues: input.startupEnvValues,
    allocatedPorts: input.allocatedPorts,
  });

  return Promise.all(deps.config.services.map(async (service) => {
    const port = input.allocatedPorts[service.portEnv] ?? null;
    const running = isValidPort(port)
      ? await deps.portProbe.isListening(port)
      : false;
    return {
      name: service.name,
      port,
      running,
      url: port !== null && service.urlTemplate
        ? expandTemplate(service.urlTemplate, runtimeEnv)
        : null,
    };
  }));
}

/** Locate a worktree's window by its stable id anchor, falling back to the legacy name match for
 *  windows created before the anchor existed (they get backfilled by healWindowNames). Matching on
 *  the anchor is what survives an in-worktree `git checkout -b`, which changes the branch — and so
 *  the expected window name — while the live window keeps the name it was born with. */
function findWindow(
  windows: TmuxWindowSummary[],
  sessionName: string,
  worktreeId: string,
  branch: string,
  role: TmuxWindowRole = "main",
): TmuxWindowSummary | null {
  const anchored = windows.find((window) =>
    window.sessionName === sessionName
    && window.worktreeId === worktreeId
    && window.role === role
  );
  if (anchored) return anchored;

  const windowName = role === "parking"
    ? buildWorktreeParkingWindowName(branch)
    : buildWorktreeWindowName(branch);
  return windows.find((window) =>
    window.sessionName === sessionName
    && window.windowName === windowName
    && window.worktreeId === null
  ) ?? null;
}

function resolveBranch(entry: GitWorktreeEntry, metaBranch: string | null): string {
  const fallback = basename(entry.path);
  return entry.branch ?? metaBranch ?? (fallback.length > 0 ? fallback : "unknown");
}

export interface ReconciliationServiceDependencies {
  config: ProjectConfig;
  git: GitGateway;
  tmux: TmuxGateway;
  portProbe: PortProbe;
  runtime: ProjectRuntime;
  componentCatalog?: Pick<ComponentCatalogService, "getComponents">;
}

export interface ReconciliationServiceOptions {
  freshnessMs?: number;
  now?: () => number;
  concurrency?: number;
}

export interface ReconcileOptions {
  force?: boolean;
}

interface ReconciledWorktreeState {
  worktreeId: string;
  branch: string;
  label: string | null;
  baseBranch: string | null;
  path: string;
  profile: string | null;
  agentName: AgentId | null;
  agentTerminalStale: boolean;
  runtime: "host" | "docker";
  source: WorktreeSource;
  oneshot: OneshotMeta | null;
  tabs: WorktreeTab[];
  activeTabId: string | null;
  git: {
    dirty: boolean;
    aheadCount: number;
    currentCommit: string | null;
  };
  session: {
    exists: boolean;
    sessionName: string | null;
    paneCount: number;
  };
  /** Live windows owned by this worktree, used by the heal pass to realign drifted names. */
  windows: {
    main: TmuxWindowSummary | null;
    parking: TmuxWindowSummary | null;
  };
  services: ServiceRuntimeState[];
  components: ComponentRuntimeState[];
  prs: PrEntry[];
}

export class ReconciliationService {
  private readonly freshnessMs: number;
  private readonly now: () => number;
  private readonly concurrency: number;
  private inFlight: Promise<void> | null = null;
  private lastReconciledAt = 0;
  private readonly componentMonitor: ComponentMonitorService;

  constructor(
    private readonly deps: ReconciliationServiceDependencies,
    options: ReconciliationServiceOptions = {},
  ) {
    this.freshnessMs = options.freshnessMs ?? 500;
    this.now = options.now ?? Date.now;
    this.concurrency = options.concurrency ?? 4;
    this.componentMonitor = new ComponentMonitorService(deps.portProbe, { now: this.now });
  }

  async reconcile(repoRoot: string, options: ReconcileOptions = {}): Promise<void> {
    if (this.inFlight) {
      return await this.inFlight;
    }

    if (!options.force && this.now() - this.lastReconciledAt < this.freshnessMs) {
      return;
    }

    const normalizedRepoRoot = resolve(repoRoot);
    const reconcilePromise = this.runReconcile(normalizedRepoRoot).then(() => {
      this.lastReconciledAt = this.now();
    });
    this.inFlight = reconcilePromise.finally(() => {
      this.inFlight = null;
    });
    return await this.inFlight;
  }

  private async runReconcile(normalizedRepoRoot: string): Promise<void> {
    const worktrees = this.deps.git.listLiveWorktrees(normalizedRepoRoot);
    const sessionName = buildProjectSessionName(normalizedRepoRoot);

    let windows: TmuxWindowSummary[] = [];
    let panes: TmuxPaneSummary[] = [];
    try {
      windows = this.deps.tmux.listWindows();
    } catch {
      windows = [];
    }
    try {
      panes = this.deps.tmux.listPanes?.() ?? [];
    } catch {
      panes = [];
    }
    const componentDefinitions = await this.deps.componentCatalog?.getComponents() ?? [];

    const seenWorktreeIds = new Set<string>();

    const candidateEntries = worktrees.filter((entry) =>
      !entry.bare && resolve(entry.path) !== normalizedRepoRoot
    );
    const reconciledStates = await mapWithConcurrency(candidateEntries, this.concurrency, async (entry) => {
      const gitDir = this.deps.git.resolveWorktreeGitDir(entry.path);
      const meta = await readWorktreeMeta(gitDir);
      const branch = resolveBranch(entry, meta?.branch ?? null);
      const worktreeId = meta?.worktreeId ?? makeUnmanagedWorktreeId(entry.path);
      const gitStatus = this.deps.git.readWorktreeStatus(entry.path);
      const window = findWindow(windows, sessionName, worktreeId, branch);
      const parkingWindow = findWindow(windows, sessionName, worktreeId, branch, "parking");

      return {
        worktreeId,
        branch,
        label: meta?.label ?? null,
        baseBranch: meta?.baseBranch ?? null,
        path: entry.path,
        profile: meta?.profile ?? null,
        agentName: meta?.agent ?? null,
        agentTerminalStale: meta?.agentTerminalStale === true,
        runtime: meta?.runtime ?? "host",
        source: meta?.source ?? "ui",
        oneshot: meta?.oneshot ?? null,
        tabs: meta?.tabs ?? [],
        activeTabId: meta?.activeTabId ?? null,
        git: {
          dirty: gitStatus.dirty,
          aheadCount: gitStatus.aheadCount,
          currentCommit: gitStatus.currentCommit,
        },
        session: {
          exists: window !== null,
          sessionName: window?.sessionName ?? null,
          paneCount: window?.paneCount ?? 0,
        },
        windows: {
          main: window,
          parking: parkingWindow,
        },
        services: meta
          ? await buildServiceStates(this.deps, {
              allocatedPorts: meta.allocatedPorts,
              startupEnvValues: meta.startupEnvValues,
              worktreeId: meta.worktreeId,
              branch,
              profile: meta.profile,
              agent: meta.agent,
              runtime: meta.runtime,
            })
          : [],
        components: meta
          ? await this.componentMonitor.buildStates({
              worktreeId,
              selectedComponentIds: meta.selectedComponents ?? [],
              componentPorts: meta.componentPorts ?? {},
              definitions: componentDefinitions,
              session: {
                exists: window !== null,
                sessionName: window?.sessionName ?? null,
                windowName: window?.windowName ?? buildWorktreeWindowName(branch),
              },
              panes,
            })
          : [],
        prs: await readWorktreePrs(gitDir),
      } satisfies ReconciledWorktreeState;
    });

    this.healWindows(sessionName, reconciledStates, windows);

    for (const state of reconciledStates) {
      seenWorktreeIds.add(state.worktreeId);

      this.deps.runtime.upsertWorktree({
        worktreeId: state.worktreeId,
        branch: state.branch,
        label: state.label,
        baseBranch: state.baseBranch,
        path: state.path,
        profile: state.profile,
        agentName: state.agentName,
        agentTerminalStale: state.agentTerminalStale,
        runtime: state.runtime,
        source: state.source,
        oneshot: state.oneshot,
        tabs: state.tabs,
        activeTabId: state.activeTabId,
      });

      this.deps.runtime.setGitState(state.worktreeId, {
        exists: true,
        branch: state.branch,
        dirty: state.git.dirty,
        aheadCount: state.git.aheadCount,
        currentCommit: state.git.currentCommit,
      });

      this.deps.runtime.setSessionState(state.worktreeId, {
        exists: state.session.exists,
        sessionName: state.session.sessionName,
        paneCount: state.session.paneCount,
      });

      this.deps.runtime.setServices(state.worktreeId, state.services);
      this.deps.runtime.setComponents(state.worktreeId, state.components);
      this.deps.runtime.setPrs(state.worktreeId, state.prs);
    }

    for (const state of this.deps.runtime.listWorktrees()) {
      if (!seenWorktreeIds.has(state.worktreeId)) {
        this.deps.runtime.removeWorktree(state.worktreeId);
      }
    }
  }

  /** Realign live windows with the worktree's current branch.
   *
   *  Window names encode the branch (`wm-<branch>`), but a `git checkout -b` inside a worktree
   *  changes the branch under a running window. Without this, the window no longer matches the
   *  name every other lookup computes, so the worktree reads as closed and reopening it spawns a
   *  duplicate window. Identity comes from the id anchor, so here we simply rename the window back
   *  into agreement with the branch — restoring the `wm-<live-branch>` invariant the rest of the
   *  system relies on. Runs sequentially: renames and collision kills mutate shared window names.
   */
  private healWindows(
    sessionName: string,
    states: ReconciledWorktreeState[],
    windows: TmuxWindowSummary[],
  ): void {
    const liveWorktreeIds = new Set(states.map((state) => state.worktreeId));

    for (const state of states) {
      this.healWindow(sessionName, state, state.windows.main, "main", liveWorktreeIds, windows);
      this.healWindow(sessionName, state, state.windows.parking, "parking", liveWorktreeIds, windows);
    }
  }

  private healWindow(
    sessionName: string,
    state: ReconciledWorktreeState,
    window: TmuxWindowSummary | null,
    role: TmuxWindowRole,
    liveWorktreeIds: Set<string>,
    windows: TmuxWindowSummary[],
  ): void {
    if (!window) return;

    // Backfill the anchor onto windows that predate it, so they survive the next branch rename.
    if (window.worktreeId === null) {
      this.deps.tmux.setWindowOption(sessionName, window.windowName, WM_WORKTREE_ID_OPTION, state.worktreeId);
      this.deps.tmux.setWindowOption(sessionName, window.windowName, WM_WINDOW_ROLE_OPTION, role);
      window.worktreeId = state.worktreeId;
      window.role = role;
    }

    const expectedName = role === "parking"
      ? buildWorktreeParkingWindowName(state.branch)
      : buildWorktreeWindowName(state.branch);
    if (window.windowName === expectedName) return;

    const squatter = windows.find((other) =>
      other !== window && other.sessionName === sessionName && other.windowName === expectedName
    );
    if (squatter) {
      // Git forbids two worktrees on one branch, so a live worktree can never legitimately hold
      // this name. Anything else squatting on it is a leftover from an earlier rename — reap it.
      // If some live worktree somehow does own it, leave both alone rather than duplicate names.
      if (squatter.worktreeId !== null && liveWorktreeIds.has(squatter.worktreeId)) return;
      this.deps.tmux.killWindow(sessionName, expectedName);
      windows.splice(windows.indexOf(squatter), 1);
    }

    this.deps.tmux.renameWindow(sessionName, window.windowName, expectedName);
    window.windowName = expectedName;
  }
}
