import { basename, resolve } from "node:path";
import type { ProjectConfig } from "../config";
import { expandTemplate } from "../config";
import type { GitGateway, GitWorktreeEntry } from "../adapters/git";
import { buildProjectSessionName, buildWorktreeWindowName, type TmuxGateway, type TmuxWindowSummary } from "../adapters/tmux";
import { buildRuntimeEnvMap, readWorktreeMeta } from "../adapters/fs";
import type { ServiceRuntimeState } from "../domain/model";
import { ProjectRuntime } from "./project-runtime";

function makeUnmanagedWorktreeId(path: string): string {
  return `unmanaged:${resolve(path)}`;
}

function buildServiceStates(
  config: ProjectConfig,
  input: {
    allocatedPorts: Record<string, number>;
    startupEnvValues: Record<string, string>;
    worktreeId: string;
    branch: string;
    profile: string;
    agent: "claude" | "codex";
    runtime: "host" | "docker";
  },
): ServiceRuntimeState[] {
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

  return config.services.map((service) => {
    const port = input.allocatedPorts[service.portEnv] ?? null;
    return {
      name: service.name,
      port,
      running: false,
      url: port !== null && service.urlTemplate
        ? expandTemplate(service.urlTemplate, runtimeEnv)
        : null,
    };
  });
}

function findWindow(
  windows: TmuxWindowSummary[],
  sessionName: string,
  branch: string,
): TmuxWindowSummary | null {
  const windowName = buildWorktreeWindowName(branch);
  return windows.find((window) => window.sessionName === sessionName && window.windowName === windowName) ?? null;
}

function resolveBranch(entry: GitWorktreeEntry, metaBranch: string | null): string {
  const fallback = basename(entry.path);
  return entry.branch ?? metaBranch ?? (fallback.length > 0 ? fallback : "unknown");
}

export interface ReconciliationServiceDependencies {
  config: ProjectConfig;
  git: GitGateway;
  tmux: TmuxGateway;
  runtime: ProjectRuntime;
}

export class ReconciliationService {
  constructor(private readonly deps: ReconciliationServiceDependencies) {}

  async reconcile(repoRoot: string): Promise<void> {
    const normalizedRepoRoot = resolve(repoRoot);
    const worktrees = this.deps.git.listWorktrees(normalizedRepoRoot);
    const sessionName = buildProjectSessionName(normalizedRepoRoot);

    let windows: TmuxWindowSummary[] = [];
    try {
      windows = this.deps.tmux.listWindows();
    } catch {
      windows = [];
    }

    const seenWorktreeIds = new Set<string>();

    for (const entry of worktrees) {
      if (entry.bare) continue;
      if (resolve(entry.path) === normalizedRepoRoot) continue;

      const gitDir = this.deps.git.resolveWorktreeGitDir(entry.path);
      const meta = await readWorktreeMeta(gitDir);
      const branch = resolveBranch(entry, meta?.branch ?? null);
      const worktreeId = meta?.worktreeId ?? makeUnmanagedWorktreeId(entry.path);

      seenWorktreeIds.add(worktreeId);

      this.deps.runtime.upsertWorktree({
        worktreeId,
        branch,
        path: entry.path,
        profile: meta?.profile ?? null,
        agentName: meta?.agent ?? null,
        runtime: meta?.runtime ?? "host",
      });

      const gitStatus = this.deps.git.readWorktreeStatus(entry.path);
      this.deps.runtime.setGitState(worktreeId, {
        exists: true,
        branch,
        dirty: gitStatus.dirty,
        aheadCount: gitStatus.aheadCount,
        currentCommit: gitStatus.currentCommit,
      });

      const window = findWindow(windows, sessionName, branch);
      this.deps.runtime.setSessionState(worktreeId, {
        exists: window !== null,
        sessionName: window?.sessionName ?? null,
        paneCount: window?.paneCount ?? 0,
      });

      if (meta) {
        this.deps.runtime.setServices(
          worktreeId,
          buildServiceStates(this.deps.config, {
            allocatedPorts: meta.allocatedPorts,
            startupEnvValues: meta.startupEnvValues,
            worktreeId: meta.worktreeId,
            branch,
            profile: meta.profile,
            agent: meta.agent,
            runtime: meta.runtime,
          }),
        );
      } else {
        this.deps.runtime.setServices(worktreeId, []);
      }
    }

    for (const state of this.deps.runtime.listWorktrees()) {
      if (!seenWorktreeIds.has(state.worktreeId)) {
        this.deps.runtime.removeWorktree(state.worktreeId);
      }
    }
  }
}
