import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectConfig } from "../domain/config";
import type { GitGateway, GitWorktreeEntry, GitWorktreeStatus } from "../adapters/git";
import type { PortProbe } from "../adapters/port-probe";
import type { TmuxGateway, TmuxWindowSummary } from "../adapters/tmux";
import { buildProjectSessionName, buildWorktreeWindowName } from "../adapters/tmux";
import { writeWorktreeMeta, writeWorktreePrs } from "../adapters/fs";
import { ProjectRuntime } from "../services/project-runtime";
import { ReconciliationService } from "../services/reconciliation-service";

class FakeGitGateway implements GitGateway {
  constructor(
    private readonly worktrees: GitWorktreeEntry[],
    private readonly gitDirs: Map<string, string>,
    private readonly statuses: Map<string, GitWorktreeStatus>,
  ) {}

  resolveWorktreeRoot(cwd: string): string {
    return cwd;
  }

  resolveWorktreeGitDir(cwd: string): string {
    const gitDir = this.gitDirs.get(cwd);
    if (!gitDir) throw new Error(`Missing git dir for ${cwd}`);
    return gitDir;
  }

  listWorktrees(): GitWorktreeEntry[] {
    return this.worktrees;
  }

  listLocalBranches(): string[] {
    return [];
  }

  readWorktreeStatus(cwd: string): GitWorktreeStatus {
    return this.statuses.get(cwd) ?? { dirty: false, aheadCount: 0, currentCommit: null };
  }

  createWorktree(): void {
    throw new Error("not implemented");
  }

  removeWorktree(): void {
    throw new Error("not implemented");
  }

  deleteBranch(): void {
    throw new Error("not implemented");
  }

  mergeBranch(): void {
    throw new Error("not implemented");
  }

  currentBranch(): string {
    return "main";
  }

  readDiff(): string {
    return "";
  }

  readUnpushedDiff(): string {
    return "";
  }
}

class FakeTmuxGateway implements TmuxGateway {
  constructor(private readonly windows: TmuxWindowSummary[]) {}

  ensureServer(): void {
    throw new Error("not implemented");
  }

  ensureSession(): void {
    throw new Error("not implemented");
  }

  hasWindow(): boolean {
    throw new Error("not implemented");
  }

  killWindow(): void {
    throw new Error("not implemented");
  }

  createWindow(): void {
    throw new Error("not implemented");
  }

  splitWindow(): void {
    throw new Error("not implemented");
  }

  setWindowOption(): void {
    throw new Error("not implemented");
  }

  runCommand(): void {
    throw new Error("not implemented");
  }

  selectPane(): void {
    throw new Error("not implemented");
  }

  listWindows(): TmuxWindowSummary[] {
    return this.windows;
  }
}

class FakePortProbe implements PortProbe {
  constructor(private readonly listening = new Set<number>()) {}

  async isListening(port: number): Promise<boolean> {
    return this.listening.has(port);
  }
}

const TEST_CONFIG: ProjectConfig = {
  name: "Project",
  workspace: {
    mainBranch: "main",
    worktreeRoot: "__worktrees",
    defaultAgent: "claude",
  },
  profiles: {
    default: {
      runtime: "host",
      envPassthrough: [],
      panes: [],
    },
  },
  services: [
    {
      name: "frontend",
      portEnv: "FRONTEND_PORT",
      urlTemplate: "http://127.0.0.1:${FRONTEND_PORT}",
    },
  ],
  startupEnvs: {},
  integrations: {
    github: { linkedRepos: [] },
    linear: { enabled: true },
  },
  lifecycleHooks: {},
  autoName: null,
};

describe("ReconciliationService", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("reconciles managed worktrees into the runtime and removes stale entries", async () => {
    const repoRoot = "/repo/project";
    const managedPath = "/repo/project/__worktrees/feature-search";
    const managedGitDir = await mkdtemp(join(tmpdir(), "webmux-reconcile-managed-"));
    tempDirs.push(managedGitDir);

    await writeWorktreeMeta(managedGitDir, {
      schemaVersion: 1,
      worktreeId: "wt_feature",
      branch: "feature/search",
      createdAt: "2026-03-06T00:00:00.000Z",
      profile: "default",
      agent: "claude",
      runtime: "host",
      startupEnvValues: {},
      allocatedPorts: { FRONTEND_PORT: 3010 },
    });
    await writeWorktreePrs(managedGitDir, [
      {
        repo: "org/repo",
        number: 77,
        state: "open",
        url: "https://github.com/org/repo/pull/77",
        updatedAt: "2026-03-06T00:05:00.000Z",
        ciStatus: "success",
        ciChecks: [],
        comments: [],
      },
    ]);

    const runtime = new ProjectRuntime();
    runtime.upsertWorktree({
      worktreeId: "wt_stale",
      branch: "feature/stale",
      path: "/repo/project/__worktrees/feature-stale",
      runtime: "host",
    });

    const git = new FakeGitGateway(
      [
        { path: repoRoot, branch: "main", head: "aaa111", detached: false, bare: false },
        { path: managedPath, branch: "feature/search", head: "bbb222", detached: false, bare: false },
      ],
      new Map([[managedPath, managedGitDir]]),
      new Map([[managedPath, { dirty: true, aheadCount: 2, currentCommit: "bbb222" }]]),
    );
    const tmux = new FakeTmuxGateway([
      {
        sessionName: buildProjectSessionName(repoRoot),
        windowName: buildWorktreeWindowName("feature/search"),
        paneCount: 3,
      },
    ]);

    const service = new ReconciliationService({
      config: TEST_CONFIG,
      git,
      tmux,
      portProbe: new FakePortProbe(new Set([3010])),
      runtime,
    });

    await service.reconcile(repoRoot);

    const state = runtime.getWorktree("wt_feature");
    expect(state).not.toBeNull();
    expect(state?.branch).toBe("feature/search");
    expect(state?.profile).toBe("default");
    expect(state?.git.dirty).toBe(true);
    expect(state?.git.aheadCount).toBe(2);
    expect(state?.git.currentCommit).toBe("bbb222");
    expect(state?.session.exists).toBe(true);
    expect(state?.session.paneCount).toBe(3);
    expect(state?.services).toEqual([
      {
        name: "frontend",
        port: 3010,
        running: true,
        url: "http://127.0.0.1:3010",
      },
    ]);
    expect(state?.prs).toEqual([
      {
        repo: "org/repo",
        number: 77,
        state: "open",
        url: "https://github.com/org/repo/pull/77",
        updatedAt: "2026-03-06T00:05:00.000Z",
        ciStatus: "success",
        ciChecks: [],
        comments: [],
      },
    ]);
    expect(runtime.getWorktree("wt_stale")).toBeNull();
  });

  it("creates synthetic ids for unmanaged worktrees", async () => {
    const repoRoot = "/repo/project";
    const unmanagedPath = "/repo/project/__worktrees/unmanaged";

    const runtime = new ProjectRuntime();
    const git = new FakeGitGateway(
      [
        { path: repoRoot, branch: "main", head: "aaa111", detached: false, bare: false },
        { path: unmanagedPath, branch: "feature/unmanaged", head: "ccc333", detached: false, bare: false },
      ],
      new Map([[unmanagedPath, unmanagedPath]]),
      new Map([[unmanagedPath, { dirty: false, aheadCount: 0, currentCommit: "ccc333" }]]),
    );
    const tmux = new FakeTmuxGateway([]);

    const service = new ReconciliationService({
      config: TEST_CONFIG,
      git,
      tmux,
      portProbe: new FakePortProbe(),
      runtime,
    });

    await service.reconcile(repoRoot);

    const state = runtime.getWorktreeByBranch("feature/unmanaged");
    expect(state).not.toBeNull();
    expect(state?.worktreeId.startsWith("unmanaged:")).toBe(true);
    expect(state?.profile).toBeNull();
    expect(state?.agentName).toBeNull();
    expect(state?.services).toEqual([]);
  });
});
