import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectConfig } from "../config";
import { BunGitGateway } from "../adapters/git";
import { buildProjectSessionName, buildWorktreeWindowName, type TmuxGateway, type TmuxWindowSummary } from "../adapters/tmux";
import { getWorktreeStoragePaths, readWorktreeMeta } from "../adapters/fs";
import type { DockerGateway, LaunchContainerOpts } from "../docker";
import { ProjectRuntime } from "../services/project-runtime";
import { ReconciliationService } from "../services/reconciliation-service";
import { LifecycleService } from "../services/lifecycle-service";

function run(args: string[], cwd: string): string {
  const result = Bun.spawnSync(args, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    const stderr = new TextDecoder().decode(result.stderr).trim();
    throw new Error(`${args.join(" ")} failed: ${stderr || `exit ${result.exitCode}`}`);
  }

  return new TextDecoder().decode(result.stdout).trim();
}

class FakeTmuxGateway implements TmuxGateway {
  private readonly windows = new Map<string, TmuxWindowSummary>();

  ensureServer(): void {}

  ensureSession(_sessionName: string, _cwd: string): void {}

  hasWindow(sessionName: string, windowName: string): boolean {
    return this.windows.has(this.key(sessionName, windowName));
  }

  killWindow(sessionName: string, windowName: string): void {
    this.windows.delete(this.key(sessionName, windowName));
  }

  createWindow(opts: { sessionName: string; windowName: string; cwd: string; command?: string }): void {
    this.windows.set(this.key(opts.sessionName, opts.windowName), {
      sessionName: opts.sessionName,
      windowName: opts.windowName,
      paneCount: 1,
    });
  }

  splitWindow(opts: {
    target: string;
    split: "right" | "bottom";
    sizePct?: number;
    cwd: string;
    command?: string;
  }): void {
    const paneSeparatorIndex = opts.target.lastIndexOf(".");
    const sessionWindow = paneSeparatorIndex >= 0 ? opts.target.slice(0, paneSeparatorIndex) : opts.target;
    if (!sessionWindow) return;
    const window = this.windows.get(sessionWindow);
    if (!window) return;
    window.paneCount += 1;
  }

  setWindowOption(_sessionName: string, _windowName: string, _option: string, _value: string): void {}

  runCommand(_target: string, _command: string): void {}

  selectPane(_target: string): void {}

  listWindows(): TmuxWindowSummary[] {
    return [...this.windows.values()].map((window) => ({ ...window }));
  }

  private key(sessionName: string, windowName: string): string {
    return `${sessionName}:${windowName}`;
  }
}

class FakeDockerGateway implements DockerGateway {
  readonly launched: LaunchContainerOpts[] = [];
  readonly removed: string[] = [];

  async launchContainer(opts: LaunchContainerOpts): Promise<string> {
    this.launched.push({
      ...opts,
      runtimeEnv: { ...opts.runtimeEnv },
      services: opts.services.map((service) => ({ ...service })),
    });
    return `wm-${opts.branch}-container`;
  }

  async removeContainer(branch: string): Promise<void> {
    this.removed.push(branch);
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
      panes: [
        { id: "agent", kind: "agent", focus: true },
        { id: "shell", kind: "shell", split: "right", sizePct: 25 },
      ],
    },
    sandbox: {
      runtime: "docker",
      image: "sandbox-image",
      envPassthrough: [],
      panes: [
        { id: "agent", kind: "agent", focus: true },
      ],
    },
  },
  services: [
    {
      name: "frontend",
      portEnv: "FRONTEND_PORT",
      portStart: 3000,
      portStep: 10,
    },
  ],
  startupEnvs: {
    FEATURE_FLAG: true,
  },
  integrations: {
    github: { linkedRepos: [] },
    linear: { enabled: true },
  },
};

function makeLifecycleService(
  repoRoot: string,
  tmux: FakeTmuxGateway,
  runtime: ProjectRuntime,
  docker: DockerGateway = new FakeDockerGateway(),
): LifecycleService {
  const git = new BunGitGateway();
  const reconciliation = new ReconciliationService({
    config: TEST_CONFIG,
    git,
    tmux,
    runtime,
  });

  return new LifecycleService({
    projectRoot: repoRoot,
    controlBaseUrl: "http://127.0.0.1:5111",
    getControlToken: async () => "secret-token",
    config: TEST_CONFIG,
    git,
    tmux,
    docker,
    reconciliation,
  });
}

describe("LifecycleService", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function initRepo(): Promise<string> {
    const repoRoot = await mkdtemp(join(tmpdir(), "webmux-lifecycle-"));
    tempDirs.push(repoRoot);

    run(["git", "init", "-b", "main"], repoRoot);
    run(["git", "config", "user.name", "Test User"], repoRoot);
    run(["git", "config", "user.email", "test@example.com"], repoRoot);
    await Bun.write(join(repoRoot, "README.md"), "# repo\n");
    run(["git", "add", "README.md"], repoRoot);
    run(["git", "commit", "-m", "init"], repoRoot);
    await mkdir(join(repoRoot, "__worktrees"), { recursive: true });

    return repoRoot;
  }

  it("creates a managed host worktree with metadata, env files, and tmux layout", async () => {
    const repoRoot = await initRepo();
    const runtime = new ProjectRuntime();
    const tmux = new FakeTmuxGateway();
    const lifecycle = makeLifecycleService(repoRoot, tmux, runtime);

    const created = await lifecycle.createWorktree({
      branch: "feature/search",
      prompt: "fix the search flow",
      envOverrides: { CUSTOM_TOKEN: "abc123" },
    });

    const worktreePath = join(repoRoot, "__worktrees", "feature", "search");
    const gitDir = new BunGitGateway().resolveWorktreeGitDir(worktreePath);
    const meta = await readWorktreeMeta(gitDir);
    const paths = getWorktreeStoragePaths(gitDir);
    const runtimeEnvText = await Bun.file(paths.runtimeEnvPath).text();
    const controlEnvText = await Bun.file(paths.controlEnvPath).text();

    expect(created.branch).toBe("feature/search");
    expect(meta?.worktreeId).toBe(created.worktreeId);
    expect(meta?.startupEnvValues).toEqual({
      FEATURE_FLAG: "true",
      CUSTOM_TOKEN: "abc123",
    });
    expect(meta?.allocatedPorts).toEqual({ FRONTEND_PORT: 3010 });
    expect(runtimeEnvText).toContain("WEBMUX_WORKTREE_PATH=");
    expect(runtimeEnvText).toContain("CUSTOM_TOKEN=abc123");
    expect(controlEnvText).toContain("WEBMUX_CONTROL_URL=http://127.0.0.1:5111/api/runtime/events");

    expect(tmux.listWindows()).toEqual([
      {
        sessionName: buildProjectSessionName(repoRoot),
        windowName: buildWorktreeWindowName("feature/search"),
        paneCount: 2,
      },
    ]);

    const state = runtime.getWorktreeByBranch("feature/search");
    expect(state?.session.exists).toBe(true);
    expect(state?.session.paneCount).toBe(2);
  });

  it("opens an unmanaged worktree by initializing metadata and rebuilding tmux layout", async () => {
    const repoRoot = await initRepo();
    const runtime = new ProjectRuntime();
    const tmux = new FakeTmuxGateway();
    const git = new BunGitGateway();
    const lifecycle = makeLifecycleService(repoRoot, tmux, runtime);
    const worktreePath = join(repoRoot, "__worktrees", "feature-open");

    git.createWorktree({
      repoRoot,
      worktreePath,
      branch: "feature-open",
      baseBranch: "main",
    });

    const opened = await lifecycle.openWorktree("feature-open");
    const gitDir = git.resolveWorktreeGitDir(worktreePath);
    const meta = await readWorktreeMeta(gitDir);

    expect(opened.branch).toBe("feature-open");
    expect(meta).not.toBeNull();
    expect(meta?.branch).toBe("feature-open");
    expect(tmux.listWindows()[0]?.windowName).toBe(buildWorktreeWindowName("feature-open"));
    expect(runtime.getWorktreeByBranch("feature-open")?.worktreeId).toBe(opened.worktreeId);
  });

  it("creates a managed docker worktree through the container runtime path", async () => {
    const repoRoot = await initRepo();
    const runtime = new ProjectRuntime();
    const tmux = new FakeTmuxGateway();
    const docker = new FakeDockerGateway();
    const lifecycle = makeLifecycleService(repoRoot, tmux, runtime, docker);

    const created = await lifecycle.createWorktree({
      branch: "feature-sandbox",
      profile: "sandbox",
    });

    expect(created.branch).toBe("feature-sandbox");
    expect(docker.launched).toHaveLength(1);
    expect(docker.launched[0]?.branch).toBe("feature-sandbox");
    expect(docker.launched[0]?.runtimeEnv.WEBMUX_RUNTIME).toBe("docker");

    expect(tmux.listWindows()).toEqual([
      {
        sessionName: buildProjectSessionName(repoRoot),
        windowName: buildWorktreeWindowName("feature-sandbox"),
        paneCount: 1,
      },
    ]);

    const state = runtime.getWorktreeByBranch("feature-sandbox");
    expect(state?.agent.runtime).toBe("docker");
    expect(state?.session.exists).toBe(true);
  });

  it("rejects removing a dirty worktree", async () => {
    const repoRoot = await initRepo();
    const runtime = new ProjectRuntime();
    const tmux = new FakeTmuxGateway();
    const lifecycle = makeLifecycleService(repoRoot, tmux, runtime);

    await lifecycle.createWorktree({ branch: "feature-dirty" });

    const worktreePath = join(repoRoot, "__worktrees", "feature-dirty");
    await Bun.write(join(worktreePath, "README.md"), "# dirty\n");

    await expect(lifecycle.removeWorktree("feature-dirty")).rejects.toThrow(
      "Worktree has uncommitted changes: feature-dirty",
    );

    expect(new BunGitGateway().listWorktrees(repoRoot).some((entry) => entry.path === worktreePath)).toBe(true);
    expect(run(["git", "branch", "--list", "feature-dirty"], repoRoot)).toContain("feature-dirty");
  });

  it("removes the sandbox container before deleting a docker worktree", async () => {
    const repoRoot = await initRepo();
    const runtime = new ProjectRuntime();
    const tmux = new FakeTmuxGateway();
    const docker = new FakeDockerGateway();
    const lifecycle = makeLifecycleService(repoRoot, tmux, runtime, docker);

    await lifecycle.createWorktree({
      branch: "feature-remove-docker",
      profile: "sandbox",
    });

    await lifecycle.removeWorktree("feature-remove-docker");

    expect(docker.removed).toContain("feature-remove-docker");
    expect(new BunGitGateway().listWorktrees(repoRoot).some((entry) => entry.branch === "feature-remove-docker")).toBe(false);
  });

  it("merges a clean worktree into main and removes it on success", async () => {
    const repoRoot = await initRepo();
    const runtime = new ProjectRuntime();
    const tmux = new FakeTmuxGateway();
    const lifecycle = makeLifecycleService(repoRoot, tmux, runtime);

    await lifecycle.createWorktree({ branch: "feature-merge" });

    const worktreePath = join(repoRoot, "__worktrees", "feature-merge");
    await Bun.write(join(worktreePath, "README.md"), "# merged change\n");
    run(["git", "add", "README.md"], worktreePath);
    run(["git", "commit", "-m", "feature change"], worktreePath);

    await lifecycle.mergeWorktree("feature-merge");

    expect(new BunGitGateway().listWorktrees(repoRoot).some((entry) => entry.path === worktreePath)).toBe(false);
    expect(run(["git", "branch", "--list", "feature-merge"], repoRoot)).toBe("");
    expect(await Bun.file(join(repoRoot, "README.md")).text()).toContain("merged change");
  });
});
