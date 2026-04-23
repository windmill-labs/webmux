import { basename, resolve } from "node:path";
import { expandTemplate } from "../adapters/config";
import type { GitGateway, GitWorktreeEntry } from "../adapters/git";
import type { PortProbe } from "../adapters/port-probe";
import { buildProjectSessionName, buildWorktreeWindowName, type TmuxGateway, type TmuxWindowSummary } from "../adapters/tmux";
import { buildRuntimeEnvMap, readWorktreeMeta, readWorktreePrs } from "../adapters/fs";
import type { AgentId, ProjectConfig } from "../domain/config";
import type { PrEntry, ServiceRuntimeState } from "../domain/model";
import { mapWithConcurrency } from "../lib/async";
import { ProjectRuntime } from "./project-runtime";

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

function findWindow(
  windows: TmuxWindowSummary[],
  sessionName: string,
  branch: string,
): TmuxWindowSummary | null {
  const windowName = buildWorktreeWindowName(branch);
  return windows.find((window) =>
    window.sessionName === sessionName && window.windowName === windowName
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
  baseBranch: string | null;
  path: string;
  profile: string | null;
  agentName: AgentId | null;
  runtime: "host" | "docker";
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
  services: ServiceRuntimeState[];
  prs: PrEntry[];
}

export class ReconciliationService {
  private readonly freshnessMs: number;
  private readonly now: () => number;
  private readonly concurrency: number;
  private inFlight: Promise<void> | null = null;
  private lastReconciledAt = 0;

  constructor(
    private readonly deps: ReconciliationServiceDependencies,
    options: ReconciliationServiceOptions = {},
  ) {
    this.freshnessMs = options.freshnessMs ?? 500;
    this.now = options.now ?? Date.now;
    this.concurrency = options.concurrency ?? 4;
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
    const worktrees = this.deps.git.listWorktrees(normalizedRepoRoot);
    const sessionName = buildProjectSessionName(normalizedRepoRoot);

    let windows: TmuxWindowSummary[] = [];
    try {
      windows = this.deps.tmux.listWindows();
    } catch {
      windows = [];
    }

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
      const window = findWindow(windows, sessionName, branch);

      return {
        worktreeId,
        branch,
        baseBranch: meta?.baseBranch ?? null,
        path: entry.path,
        profile: meta?.profile ?? null,
        agentName: meta?.agent ?? null,
        runtime: meta?.runtime ?? "host",
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
        prs: await readWorktreePrs(gitDir),
      } satisfies ReconciledWorktreeState;
    });

    for (const state of reconciledStates) {
      seenWorktreeIds.add(state.worktreeId);

      this.deps.runtime.upsertWorktree({
        worktreeId: state.worktreeId,
        branch: state.branch,
        baseBranch: state.baseBranch,
        path: state.path,
        profile: state.profile,
        agentName: state.agentName,
        runtime: state.runtime,
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
      this.deps.runtime.setPrs(state.worktreeId, state.prs);
    }

    for (const state of this.deps.runtime.listWorktrees()) {
      if (!seenWorktreeIds.has(state.worktreeId)) {
        this.deps.runtime.removeWorktree(state.worktreeId);
      }
    }
  }
}
