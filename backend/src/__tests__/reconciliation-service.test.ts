import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectConfig } from "../domain/config";
import type { GitGateway, GitWorktreeEntry, GitWorktreeStatus, TryGitCommandResult, UnpushedCommit } from "../adapters/git";
import type { PortProbe } from "../adapters/port-probe";
import type { TmuxGateway, TmuxPaneSummary, TmuxWindowSummary } from "../adapters/tmux";
import {
  buildProjectSessionName,
  buildWorktreeParkingWindowName,
  buildWorktreeWindowName,
  WM_WINDOW_ROLE_OPTION,
  WM_WORKTREE_ID_OPTION,
} from "../adapters/tmux";
import { writeWorktreeMeta, writeWorktreePrs } from "../adapters/fs";
import { ProjectRuntime } from "../services/project-runtime";
import { ReconciliationService } from "../services/reconciliation-service";

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

class FakeGitGateway implements GitGateway {
  constructor(
    private readonly worktrees: GitWorktreeEntry[],
    private readonly gitDirs: Map<string, string>,
    private readonly statuses: Map<string, GitWorktreeStatus>,
    private readonly liveWorktrees?: GitWorktreeEntry[],
  ) {}

  resolveRepoRoot(dir: string): string | null {
    return dir;
  }

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

  listLiveWorktrees(): GitWorktreeEntry[] {
    return this.liveWorktrees ?? this.worktrees;
  }

  listLocalBranches(): string[] {
    return [];
  }

  listRemoteBranches(): string[] {
    return [];
  }

  readWorktreeStatus(cwd: string): GitWorktreeStatus {
    return this.statuses.get(cwd) ?? { dirty: false, aheadCount: 0, currentCommit: null };
  }

  readStatus(): string {
    return "";
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

  listUnpushedCommits(): UnpushedCommit[] {
    return [];
  }

  fetchBranch(_repoRoot: string, _remote: string, _branch: string): TryGitCommandResult {
    return { ok: true, stdout: "" };
  }

  fastForwardMerge(_repoRoot: string, _ref: string): TryGitCommandResult {
    return { ok: true, stdout: "" };
  }

  hardReset(_repoRoot: string, _ref: string): TryGitCommandResult {
    return { ok: true, stdout: "" };
  }
}

class FakeTmuxGateway implements TmuxGateway {
  readonly renamed: Array<{ sessionName: string; windowName: string; newName: string }> = [];
  readonly options: Array<{ sessionName: string; windowName: string; option: string; value: string }> = [];
  readonly killedWindows: Array<{ sessionName: string; windowName: string }> = [];

  constructor(
    private readonly windows: TmuxWindowSummary[],
    private readonly panes: TmuxPaneSummary[] = [],
  ) {}

  getPaneId(_target: string): string {
    return "%0";
  }

  createParkedPane(_opts: {
    sessionName: string;
    parkingWindow: string;
    cwd: string;
    command: string;
    worktreeId?: string;
  }): string {
    return "%99";
  }

  swapPanes(_source: string, _destination: string): void {}

  killPane(_target: string): void {}

  ensureServer(): void {
    throw new Error("not implemented");
  }

  ensureSession(): void {
    throw new Error("not implemented");
  }

  hasWindow(sessionName: string, windowName: string): boolean {
    return this.windows.some(
      (window) => window.sessionName === sessionName && window.windowName === windowName,
    );
  }

  killWindow(sessionName: string, windowName: string): void {
    this.killedWindows.push({ sessionName, windowName });
    const index = this.windows.findIndex(
      (window) => window.sessionName === sessionName && window.windowName === windowName,
    );
    if (index >= 0) this.windows.splice(index, 1);
  }

  createWindow(): void {
    throw new Error("not implemented");
  }

  splitWindow(): void {
    throw new Error("not implemented");
  }

  renameWindow(sessionName: string, windowName: string, newName: string): void {
    this.renamed.push({ sessionName, windowName, newName });
    const window = this.windows.find(
      (entry) => entry.sessionName === sessionName && entry.windowName === windowName,
    );
    if (window) window.windowName = newName;
  }

  setWindowOption(sessionName: string, windowName: string, option: string, value: string): void {
    this.options.push({ sessionName, windowName, option, value });
    const window = this.windows.find(
      (entry) => entry.sessionName === sessionName && entry.windowName === windowName,
    );
    if (!window) return;
    if (option === WM_WORKTREE_ID_OPTION) window.worktreeId = value;
    if (option === WM_WINDOW_ROLE_OPTION) window.role = value === "parking" ? "parking" : "main";
  }

  runCommand(): void {
    throw new Error("not implemented");
  }

  selectPane(): void {
    throw new Error("not implemented");
  }

  listWindows(): TmuxWindowSummary[] {
    return this.windows.map((window) => ({ ...window }));
  }

  listPanes(): TmuxPaneSummary[] {
    return this.panes.map((pane) => ({ ...pane }));
  }
}

function fakeWindow(overrides: Partial<TmuxWindowSummary> & Pick<TmuxWindowSummary, "sessionName" | "windowName">): TmuxWindowSummary {
  return {
    paneCount: 1,
    worktreeId: null,
    role: null,
    ...overrides,
  };
}

class FakePortProbe implements PortProbe {
  readonly calls: number[] = [];

  constructor(
    private readonly listening = new Set<number>(),
    private readonly onProbe?: (port: number) => Promise<void> | void,
  ) {}

  async isListening(port: number): Promise<boolean> {
    this.calls.push(port);
    await this.onProbe?.(port);
    return this.listening.has(port);
  }
}

function deferred(): Deferred {
  let resolve!: () => void;
  return {
    promise: new Promise<void>((res) => {
      resolve = res;
    }),
    resolve,
  };
}

const TEST_CONFIG: ProjectConfig = {
  name: "Project",
  componentCatalog: null,
  workspace: {
    mainBranch: "main",
    worktreeRoot: "__worktrees",
    defaultAgent: "claude",
    autoPull: { enabled: false, intervalSeconds: 300 },
  },
  profiles: {
    default: {
      runtime: "host",
      envPassthrough: [],
      panes: [],
    },
  },
  agents: {},
  services: [
    {
      name: "frontend",
      portEnv: "FRONTEND_PORT",
      urlTemplate: "http://127.0.0.1:${FRONTEND_PORT}",
    },
  ],
  startupEnvs: {},
  integrations: {
    github: { linkedRepos: [], autoRemoveOnMerge: false },
    linear: { enabled: true, autoCreateWorktrees: false, createTicketOption: false },
  },
  lifecycleHooks: {},
  autoName: null,
  oneshot: { systemPrompt: "" },
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
      baseBranch: "main",
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
      fakeWindow({
        sessionName: buildProjectSessionName(repoRoot),
        windowName: buildWorktreeWindowName("feature/search"),
        paneCount: 3,
      }),
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
    expect(state?.baseBranch).toBe("main");
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

  it("reconciles tagged component panes and TCP readiness", async () => {
    const repoRoot = "/repo/project";
    const worktreePath = "/repo/project/__worktrees/feature-components";
    const gitDir = await mkdtemp(join(tmpdir(), "webmux-reconcile-components-"));
    tempDirs.push(gitDir);
    await writeWorktreeMeta(gitDir, {
      schemaVersion: 1,
      worktreeId: "wt_components",
      branch: "feature/components",
      createdAt: "2026-03-06T00:00:00.000Z",
      profile: "default",
      agent: "claude",
      runtime: "host",
      startupEnvValues: {},
      allocatedPorts: {},
      selectedComponents: ["service-alerts"],
      componentPorts: {
        "service-alerts": { http: 24_000 },
      },
    });

    const sessionName = buildProjectSessionName(repoRoot);
    const windowName = buildWorktreeWindowName("feature/components");
    const runtime = new ProjectRuntime();
    const service = new ReconciliationService({
      config: TEST_CONFIG,
      git: new FakeGitGateway(
        [
          { path: repoRoot, branch: "main", bare: false, head: "abc", detached: false },
          {
            path: worktreePath,
            branch: "feature/components",
            bare: false,
            head: "def",
            detached: false,
          },
        ],
        new Map([[worktreePath, gitDir]]),
        new Map(),
      ),
      tmux: new FakeTmuxGateway(
        [fakeWindow({
          sessionName,
          windowName,
          paneCount: 2,
          worktreeId: "wt_components",
          role: "main",
        })],
        [{
          sessionName,
          windowName,
          paneId: "%2",
          paneIndex: 1,
          pid: 123,
          dead: false,
          exitCode: null,
          componentId: "service-alerts",
        }],
      ),
      portProbe: new FakePortProbe(new Set([24_000])),
      runtime,
      componentCatalog: {
        getComponents: async () => [{
          id: "service-alerts",
          label: "Alerts",
          kind: "service",
          workingDir: "services/service-alerts",
          command: "yarn dev",
          environment: {},
          ports: [{
            name: "http",
            processEnv: "PORT",
            protocol: "http",
            health: { type: "tcp" },
          }],
        }],
      },
    });

    await service.reconcile(repoRoot, { force: true });

    expect(runtime.getWorktreeByBranch("feature/components")?.components).toEqual([{
      id: "service-alerts",
      label: "Alerts",
      kind: "service",
      paneIndex: 1,
      processStatus: "running",
      healthStatus: "ready",
      ports: { http: 24_000 },
      urls: { http: "http://localhost:24000" },
      exitCode: null,
    }]);
  });

  it("keeps the existing window after an in-worktree branch rename and renames it in place", async () => {
    // Repro: `git checkout -b feature/new` inside the worktree. The live tmux window is still
    // named after the old branch. Identity must come from the @wm_worktree_id anchor, so the
    // worktree stays "open" and the window is renamed in place instead of being orphaned.
    const repoRoot = "/repo/project";
    const managedPath = "/repo/project/__worktrees/feature-rename";
    const managedGitDir = await mkdtemp(join(tmpdir(), "webmux-reconcile-rename-"));
    tempDirs.push(managedGitDir);

    await writeWorktreeMeta(managedGitDir, {
      schemaVersion: 1,
      worktreeId: "wt_rename",
      branch: "feature/old",
      createdAt: "2026-07-11T00:00:00.000Z",
      profile: "default",
      agent: "claude",
      runtime: "host",
      startupEnvValues: {},
      allocatedPorts: {},
    });

    const sessionName = buildProjectSessionName(repoRoot);
    const runtime = new ProjectRuntime();
    const git = new FakeGitGateway(
      [
        { path: repoRoot, branch: "main", head: "aaa111", detached: false, bare: false },
        // git now reports the NEW branch, while tmux still holds the OLD window name.
        { path: managedPath, branch: "feature/new", head: "bbb222", detached: false, bare: false },
      ],
      new Map([[managedPath, managedGitDir]]),
      new Map([[managedPath, { dirty: false, aheadCount: 0, currentCommit: "bbb222" }]]),
    );
    const tmux = new FakeTmuxGateway([
      fakeWindow({
        sessionName,
        windowName: buildWorktreeWindowName("feature/old"),
        paneCount: 2,
        worktreeId: "wt_rename",
        role: "main",
      }),
      fakeWindow({
        sessionName,
        windowName: buildWorktreeParkingWindowName("feature/old"),
        paneCount: 1,
        worktreeId: "wt_rename",
        role: "parking",
      }),
    ]);

    const service = new ReconciliationService({
      config: TEST_CONFIG,
      git,
      tmux,
      portProbe: new FakePortProbe(),
      runtime,
    });

    await service.reconcile(repoRoot);

    const state = runtime.getWorktree("wt_rename");
    expect(state?.branch).toBe("feature/new");
    // The session must still be considered open — this is the bug.
    expect(state?.session.exists).toBe(true);
    expect(state?.session.paneCount).toBe(2);

    // The window is renamed in place, restoring the wm-<live-branch> invariant.
    expect(tmux.renamed).toContainEqual({
      sessionName,
      windowName: buildWorktreeWindowName("feature/old"),
      newName: buildWorktreeWindowName("feature/new"),
    });
    expect(tmux.renamed).toContainEqual({
      sessionName,
      windowName: buildWorktreeParkingWindowName("feature/old"),
      newName: buildWorktreeParkingWindowName("feature/new"),
    });
    // No window was killed — the original session survives.
    expect(tmux.killedWindows).toEqual([]);
  });

  it("backfills the worktree id anchor onto pre-existing unanchored windows", async () => {
    const repoRoot = "/repo/project";
    const managedPath = "/repo/project/__worktrees/feature-legacy";
    const managedGitDir = await mkdtemp(join(tmpdir(), "webmux-reconcile-legacy-"));
    tempDirs.push(managedGitDir);

    await writeWorktreeMeta(managedGitDir, {
      schemaVersion: 1,
      worktreeId: "wt_legacy",
      branch: "feature/legacy",
      createdAt: "2026-07-11T00:00:00.000Z",
      profile: "default",
      agent: "claude",
      runtime: "host",
      startupEnvValues: {},
      allocatedPorts: {},
    });

    const sessionName = buildProjectSessionName(repoRoot);
    const runtime = new ProjectRuntime();
    const git = new FakeGitGateway(
      [
        { path: repoRoot, branch: "main", head: "aaa111", detached: false, bare: false },
        { path: managedPath, branch: "feature/legacy", head: "bbb222", detached: false, bare: false },
      ],
      new Map([[managedPath, managedGitDir]]),
      new Map([[managedPath, { dirty: false, aheadCount: 0, currentCommit: "bbb222" }]]),
    );
    // Window created before this feature existed: correct name, no anchor.
    const tmux = new FakeTmuxGateway([
      fakeWindow({
        sessionName,
        windowName: buildWorktreeWindowName("feature/legacy"),
        paneCount: 1,
      }),
    ]);

    const service = new ReconciliationService({
      config: TEST_CONFIG,
      git,
      tmux,
      portProbe: new FakePortProbe(),
      runtime,
    });

    await service.reconcile(repoRoot);

    expect(runtime.getWorktree("wt_legacy")?.session.exists).toBe(true);
    expect(tmux.options).toContainEqual({
      sessionName,
      windowName: buildWorktreeWindowName("feature/legacy"),
      option: WM_WORKTREE_ID_OPTION,
      value: "wt_legacy",
    });
    expect(tmux.options).toContainEqual({
      sessionName,
      windowName: buildWorktreeWindowName("feature/legacy"),
      option: WM_WINDOW_ROLE_OPTION,
      value: "main",
    });
    expect(tmux.renamed).toEqual([]);
  });

  it("kills a stale orphan window that squats on the renamed window's target name", async () => {
    const repoRoot = "/repo/project";
    const managedPath = "/repo/project/__worktrees/feature-collide";
    const managedGitDir = await mkdtemp(join(tmpdir(), "webmux-reconcile-collide-"));
    tempDirs.push(managedGitDir);

    await writeWorktreeMeta(managedGitDir, {
      schemaVersion: 1,
      worktreeId: "wt_collide",
      branch: "feature/old",
      createdAt: "2026-07-11T00:00:00.000Z",
      profile: "default",
      agent: "claude",
      runtime: "host",
      startupEnvValues: {},
      allocatedPorts: {},
    });

    const sessionName = buildProjectSessionName(repoRoot);
    const runtime = new ProjectRuntime();
    const git = new FakeGitGateway(
      [
        { path: repoRoot, branch: "main", head: "aaa111", detached: false, bare: false },
        { path: managedPath, branch: "feature/new", head: "bbb222", detached: false, bare: false },
      ],
      new Map([[managedPath, managedGitDir]]),
      new Map([[managedPath, { dirty: false, aheadCount: 0, currentCommit: "bbb222" }]]),
    );
    const tmux = new FakeTmuxGateway([
      fakeWindow({
        sessionName,
        windowName: buildWorktreeWindowName("feature/old"),
        paneCount: 2,
        worktreeId: "wt_collide",
        role: "main",
      }),
      // A dead leftover window already squatting on wm-feature/new, owned by nobody live.
      fakeWindow({
        sessionName,
        windowName: buildWorktreeWindowName("feature/new"),
        paneCount: 1,
        worktreeId: "wt_dead",
        role: "main",
      }),
    ]);

    const service = new ReconciliationService({
      config: TEST_CONFIG,
      git,
      tmux,
      portProbe: new FakePortProbe(),
      runtime,
    });

    await service.reconcile(repoRoot);

    expect(tmux.killedWindows).toContainEqual({
      sessionName,
      windowName: buildWorktreeWindowName("feature/new"),
    });
    expect(tmux.renamed).toContainEqual({
      sessionName,
      windowName: buildWorktreeWindowName("feature/old"),
      newName: buildWorktreeWindowName("feature/new"),
    });
    const state = runtime.getWorktree("wt_collide");
    expect(state?.session.exists).toBe(true);
    expect(state?.session.paneCount).toBe(2);
  });

  it("ignores stale worktree registrations whose directory no longer exists", async () => {
    // Reproduces the ENOENT add-flow crash: a git registration points at a directory
    // that's gone. The service must complete the reconcile, never call git against the
    // stale path, and not surface it in runtime state.
    const repoRoot = "/repo/project";
    const stalePath = "/repo/project/__worktrees/feature-stale-on-disk";
    const livePath = "/repo/project/__worktrees/feature-live";
    const liveGitDir = await mkdtemp(join(tmpdir(), "webmux-reconcile-live-"));
    tempDirs.push(liveGitDir);

    await writeWorktreeMeta(liveGitDir, {
      schemaVersion: 1,
      worktreeId: "wt_live",
      branch: "feature/live",
      createdAt: "2026-05-13T00:00:00.000Z",
      profile: "default",
      agent: "claude",
      runtime: "host",
      startupEnvValues: {},
      allocatedPorts: { FRONTEND_PORT: 3010 },
    });

    const runtime = new ProjectRuntime();
    const mainEntry = { path: repoRoot, branch: "main", head: "aaa111", detached: false, bare: false };
    const liveEntry = { path: livePath, branch: "feature/live", head: "bbb222", detached: false, bare: false };
    const staleEntry = { path: stalePath, branch: "feature/stale-on-disk", head: "ccc333", detached: false, bare: false };

    const git = new FakeGitGateway(
      [mainEntry, liveEntry, staleEntry],
      new Map([
        [livePath, liveGitDir],
        // No mapping for stalePath — if the service ever calls resolveWorktreeGitDir
        // on it, the fake throws and the test fails.
      ]),
      new Map([[livePath, { dirty: false, aheadCount: 0, currentCommit: "bbb222" }]]),
      [mainEntry, liveEntry], // listLiveWorktrees excludes the stale entry
    );

    const service = new ReconciliationService({
      config: TEST_CONFIG,
      git,
      tmux: new FakeTmuxGateway([]),
      portProbe: new FakePortProbe(new Set([3010])),
      runtime,
    });

    await service.reconcile(repoRoot);

    expect(runtime.getWorktree("wt_live")).not.toBeNull();
    expect(runtime.getWorktreeByBranch("feature/stale-on-disk")).toBeNull();
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

  it("coalesces concurrent reconcile calls and skips fresh repeats", async () => {
    const repoRoot = "/repo/project";
    const managedPath = "/repo/project/__worktrees/feature-fresh";
    const managedGitDir = await mkdtemp(join(tmpdir(), "webmux-reconcile-fresh-"));
    tempDirs.push(managedGitDir);

    await writeWorktreeMeta(managedGitDir, {
      schemaVersion: 1,
      worktreeId: "wt_fresh",
      branch: "feature/fresh",
      createdAt: "2026-03-06T00:00:00.000Z",
      profile: "default",
      agent: "claude",
      runtime: "host",
      startupEnvValues: {},
      allocatedPorts: { FRONTEND_PORT: 3010 },
    });

    let probeCount = 0;
    const firstProbeReached = deferred();
    const firstProbeRelease = deferred();
    const secondProbeReached = deferred();
    const secondProbeRelease = deferred();
    let nowMs = 10_000;
    const portProbe = new FakePortProbe(new Set([3010]), async () => {
      probeCount += 1;
      if (probeCount === 1) {
        firstProbeReached.resolve();
        await firstProbeRelease.promise;
        return;
      }
      if (probeCount === 2) {
        secondProbeReached.resolve();
        await secondProbeRelease.promise;
        return;
      }
      throw new Error(`unexpected port probe ${probeCount}`);
    });
    const runtime = new ProjectRuntime();
    const git = new FakeGitGateway(
      [
        { path: repoRoot, branch: "main", head: "aaa111", detached: false, bare: false },
        { path: managedPath, branch: "feature/fresh", head: "bbb222", detached: false, bare: false },
      ],
      new Map([[managedPath, managedGitDir]]),
      new Map([[managedPath, { dirty: false, aheadCount: 0, currentCommit: "bbb222" }]]),
    );
    const service = new ReconciliationService(
      {
        config: TEST_CONFIG,
        git,
        tmux: new FakeTmuxGateway([]),
        portProbe,
        runtime,
      },
      {
        freshnessMs: 1000,
        now: () => nowMs,
      },
    );

    const first = service.reconcile(repoRoot);
    const second = service.reconcile(repoRoot);
    await firstProbeReached.promise;

    expect(portProbe.calls).toEqual([3010]);
    firstProbeRelease.resolve();
    await Promise.all([first, second]);
    expect(portProbe.calls).toEqual([3010]);

    await service.reconcile(repoRoot);
    expect(portProbe.calls).toEqual([3010]);

    nowMs += 1001;
    const third = service.reconcile(repoRoot);
    await secondProbeReached.promise;
    expect(portProbe.calls).toEqual([3010, 3010]);
    secondProbeRelease.resolve();
    await third;
  });
});
