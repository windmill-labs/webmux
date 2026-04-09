import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectConfig } from "../domain/config";
import { BunGitGateway, type GitGateway } from "../adapters/git";
import type { LifecycleHookRunner, RunLifecycleHookInput } from "../adapters/hooks";
import type { PortProbe } from "../adapters/port-probe";
import { buildProjectSessionName, buildWorktreeWindowName, type TmuxGateway, type TmuxWindowSummary } from "../adapters/tmux";
import { getWorktreeStoragePaths, readWorktreeArchiveState, readWorktreeMeta } from "../adapters/fs";
import type { DockerGateway, LaunchContainerOpts } from "../adapters/docker";
import type { AutoNameConfig } from "../domain/config";
import { ProjectRuntime } from "../services/project-runtime";
import { ArchiveStateService } from "../services/archive-state-service";
import type { AutoNameGenerator } from "../services/auto-name-service";
import { ReconciliationService } from "../services/reconciliation-service";
import {
  buildCreateWorktreeTargets,
  LifecycleError,
  LifecycleService,
  type CreateWorktreeProgress,
} from "../services/lifecycle-service";

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
  readonly createdWindows: Array<{ sessionName: string; windowName: string; cwd: string; command?: string }> = [];
  readonly commands: Array<{ target: string; command: string }> = [];

  ensureServer(): void {}

  ensureSession(_sessionName: string, _cwd: string): void {}

  hasWindow(sessionName: string, windowName: string): boolean {
    return this.windows.has(this.key(sessionName, windowName));
  }

  killWindow(sessionName: string, windowName: string): void {
    this.windows.delete(this.key(sessionName, windowName));
  }

  createWindow(opts: { sessionName: string; windowName: string; cwd: string; command?: string }): void {
    this.createdWindows.push({ ...opts });
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

  runCommand(target: string, command: string): void {
    this.commands.push({ target, command });
  }

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

class FakePortProbe implements PortProbe {
  async isListening(): Promise<boolean> {
    return false;
  }
}

class FakeHookRunner implements LifecycleHookRunner {
  readonly calls: RunLifecycleHookInput[] = [];

  constructor(
    private readonly onRun?: (input: RunLifecycleHookInput) => void | Promise<void>,
  ) {}

  async run(input: RunLifecycleHookInput): Promise<void> {
    this.calls.push({
      ...input,
      env: { ...input.env },
    });
    await this.onRun?.(input);
  }
}

class FakeAutoNameService implements AutoNameGenerator {
  readonly calls: Array<{ config: AutoNameConfig; task: string }> = [];

  constructor(private readonly branch = "generated-branch") {}

  async generateBranchName(config: AutoNameConfig, task: string): Promise<string> {
    this.calls.push({
      config: { ...config },
      task,
    });
    return this.branch;
  }
}

class AheadTrackingGitGateway extends BunGitGateway {
  constructor(private readonly branches: Set<string>) {
    super();
  }

  readWorktreeStatus(cwd: string): ReturnType<BunGitGateway["readWorktreeStatus"]> {
    const status = super.readWorktreeStatus(cwd);
    for (const branch of this.branches) {
      if (cwd.endsWith(branch)) {
        return {
          ...status,
          dirty: false,
          aheadCount: 2,
        };
      }
    }
    return status;
  }
}

const TEST_CONFIG: ProjectConfig = {
  name: "Project",
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
    github: { linkedRepos: [], autoRemoveOnMerge: false },
    linear: { enabled: true, autoCreateWorktrees: false, createTicketOption: false },
  },
  lifecycleHooks: {
    postCreate: "scripts/post-create.sh",
    preRemove: "scripts/pre-remove.sh",
  },
  autoName: null,
};

const NO_DEFAULT_PROFILE_CONFIG: ProjectConfig = {
  ...TEST_CONFIG,
  profiles: {
    slim: {
      runtime: "host",
      envPassthrough: [],
      panes: [
        { id: "agent", kind: "agent", focus: true },
      ],
    },
    full: {
      runtime: "host",
      envPassthrough: [],
      panes: [
        { id: "agent", kind: "agent", focus: true },
        { id: "shell", kind: "shell", split: "right", sizePct: 25 },
      ],
    },
  },
};

function makeLifecycleService(
  repoRoot: string,
  tmux: FakeTmuxGateway,
  runtime: ProjectRuntime,
  docker: DockerGateway = new FakeDockerGateway(),
  hooks: LifecycleHookRunner = new FakeHookRunner(),
  config: ProjectConfig = TEST_CONFIG,
  git: GitGateway = new BunGitGateway(),
  autoName: AutoNameGenerator = new FakeAutoNameService(),
  createCallbacks: {
    onProgress?: (progress: CreateWorktreeProgress) => void | Promise<void>;
    onFinished?: (branch: string) => void | Promise<void>;
  } = {},
): LifecycleService {
  const reconciliation = new ReconciliationService({
    config,
    git,
    tmux,
    portProbe: new FakePortProbe(),
    runtime,
  });

  return new LifecycleService({
    projectRoot: repoRoot,
    controlBaseUrl: "http://127.0.0.1:5111",
    getControlToken: async () => "secret-token",
    config,
    archiveState: new ArchiveStateService(git.resolveWorktreeGitDir(repoRoot)),
    git,
    tmux,
    docker,
    reconciliation,
    hooks,
    autoName,
    onCreateProgress: createCallbacks.onProgress,
    onCreateFinished: createCallbacks.onFinished,
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

  it("builds paired claude and codex targets from one task branch", () => {
    expect(buildCreateWorktreeTargets("feature/search", "both")).toEqual([
      { branch: "claude-feature/search", agent: "claude" },
      { branch: "codex-feature/search", agent: "codex" },
    ]);
  });

  it("creates a managed host worktree with metadata, env files, and tmux layout", async () => {
    const repoRoot = await initRepo();
    const runtime = new ProjectRuntime();
    const tmux = new FakeTmuxGateway();
    const hooks = new FakeHookRunner(() => {
      expect(tmux.listWindows()).toEqual([]);
    });
    const lifecycle = makeLifecycleService(repoRoot, tmux, runtime, new FakeDockerGateway(), hooks);

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
    expect(meta?.baseBranch).toBe("main");
    expect(meta?.startupEnvValues).toEqual({
      FEATURE_FLAG: "true",
      CUSTOM_TOKEN: "abc123",
    });
    expect(meta?.allocatedPorts).toEqual({ FRONTEND_PORT: 3010 });
    expect(runtimeEnvText).toContain("WEBMUX_WORKTREE_PATH=");
    expect(runtimeEnvText).toContain("CUSTOM_TOKEN=abc123");
    expect(controlEnvText).toContain("WEBMUX_CONTROL_URL=http://127.0.0.1:5111/api/runtime/events");
    expect(hooks.calls).toEqual([
      expect.objectContaining({
        name: "postCreate",
        command: "scripts/post-create.sh",
        cwd: worktreePath,
        env: expect.objectContaining({
          CUSTOM_TOKEN: "abc123",
          FEATURE_FLAG: "true",
          FRONTEND_PORT: "3010",
          WEBMUX_BRANCH: "feature/search",
          WEBMUX_PROFILE: "default",
          WEBMUX_RUNTIME: "host",
          WEBMUX_WORKTREE_PATH: worktreePath,
        }),
      }),
    ]);

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

  it("creates paired managed worktrees for both agents from one task branch", async () => {
    const repoRoot = await initRepo();
    const runtime = new ProjectRuntime();
    const tmux = new FakeTmuxGateway();
    const lifecycle = makeLifecycleService(repoRoot, tmux, runtime);
    const git = new BunGitGateway();

    const created = await lifecycle.createWorktrees({
      branch: "feature/search",
      prompt: "fix the search flow",
      agent: "both",
    });

    const claudeBranch = "claude-feature/search";
    const codexBranch = "codex-feature/search";
    const claudePath = join(repoRoot, "__worktrees", "claude-feature", "search");
    const codexPath = join(repoRoot, "__worktrees", "codex-feature", "search");
    const claudeMeta = await readWorktreeMeta(git.resolveWorktreeGitDir(claudePath));
    const codexMeta = await readWorktreeMeta(git.resolveWorktreeGitDir(codexPath));

    expect(created).toEqual({
      primaryBranch: claudeBranch,
      branches: [claudeBranch, codexBranch],
    });
    expect(claudeMeta?.agent).toBe("claude");
    expect(codexMeta?.agent).toBe("codex");
    expect(claudeMeta?.baseBranch).toBe("main");
    expect(codexMeta?.baseBranch).toBe("main");
    expect(runtime.getWorktreeByBranch(claudeBranch)?.session.exists).toBe(true);
    expect(runtime.getWorktreeByBranch(codexBranch)?.session.exists).toBe(true);
    expect(tmux.listWindows().map((window) => window.windowName).sort()).toEqual([
      buildWorktreeWindowName(claudeBranch),
      buildWorktreeWindowName(codexBranch),
    ]);
  });

  it("rolls back the first paired worktree when the second branch cannot be created", async () => {
    const repoRoot = await initRepo();
    const runtime = new ProjectRuntime();
    const tmux = new FakeTmuxGateway();
    const lifecycle = makeLifecycleService(repoRoot, tmux, runtime);
    const git = new BunGitGateway();

    run(["git", "branch", "codex-feature/search", "main"], repoRoot);

    await expect(lifecycle.createWorktrees({
      branch: "feature/search",
      agent: "both",
    })).rejects.toThrow("Branch already exists: codex-feature/search");

    expect(run(["git", "branch", "--list", "codex-feature/search"], repoRoot)).toContain("codex-feature/search");
    expect(git.listWorktrees(repoRoot).some((entry) => entry.branch === "claude-feature/search")).toBe(false);
    expect(runtime.getWorktreeByBranch("claude-feature/search")).toBeNull();
    expect(tmux.hasWindow(
      buildProjectSessionName(repoRoot),
      buildWorktreeWindowName("claude-feature/search"),
    )).toBe(false);
  });

  it("refreshes runtime env after postCreate so system prompts see .env.local values", async () => {
    const repoRoot = await initRepo();
    const runtime = new ProjectRuntime();
    const tmux = new FakeTmuxGateway();
    const databaseUrl = "postgres://postgres:changeme@127.0.0.1:5432/windmill_feature_prompt?sslmode=disable";
    const hooks = new FakeHookRunner(async (input) => {
      await Bun.write(join(input.cwd, ".env.local"), `DATABASE_URL=${databaseUrl}\n`);
    });
    const lifecycle = makeLifecycleService(
      repoRoot,
      tmux,
      runtime,
      new FakeDockerGateway(),
      hooks,
      {
        ...TEST_CONFIG,
        profiles: {
          ...TEST_CONFIG.profiles,
          default: {
            ...TEST_CONFIG.profiles.default,
            systemPrompt: "Database: ${DATABASE_URL}",
          },
        },
      },
    );

    await lifecycle.createWorktree({
      branch: "feature/prompt-env",
    });

    const worktreePath = join(repoRoot, "__worktrees", "feature", "prompt-env");
    const gitDir = new BunGitGateway().resolveWorktreeGitDir(worktreePath);
    const runtimeEnvText = await Bun.file(getWorktreeStoragePaths(gitDir).runtimeEnvPath).text();
    const agentCommand = tmux.commands.find(({ target }) =>
      target === `${buildProjectSessionName(repoRoot)}:${buildWorktreeWindowName("feature/prompt-env")}.0`
    )?.command;

    expect(runtimeEnvText).toContain(databaseUrl);
    expect(agentCommand).toContain(`Database: ${databaseUrl}`);
  });

  it("reinstalls Claude runtime hooks after postCreate rewrites settings.local.json", async () => {
    const repoRoot = await initRepo();
    const runtime = new ProjectRuntime();
    const tmux = new FakeTmuxGateway();
    const additionalDirectory = "../windmill-ee-private__worktrees/hook-settings";
    const hooks = new FakeHookRunner(async (input) => {
      const claudeDir = join(input.cwd, ".claude");
      await mkdir(claudeDir, { recursive: true });
      await Bun.write(
        join(claudeDir, "settings.local.json"),
        `${JSON.stringify({
          permissions: {
            additionalDirectories: [additionalDirectory],
          },
        }, null, 2)}\n`,
      );
    });
    const lifecycle = makeLifecycleService(repoRoot, tmux, runtime, new FakeDockerGateway(), hooks);

    await lifecycle.createWorktree({
      branch: "feature/hook-settings",
    });

    const settingsText = await Bun.file(
      join(repoRoot, "__worktrees", "feature", "hook-settings", ".claude", "settings.local.json"),
    ).text();

    expect(settingsText).toContain(additionalDirectory);
    expect(settingsText).toContain("webmux-agentctl");
    expect(settingsText).toContain("claude-user-prompt-submit");
    expect(settingsText).toContain("status-changed --lifecycle idle");
  });

  it("creates a managed worktree under an absolute worktree root", async () => {
    const repoRoot = await initRepo();
    const absoluteWorktreeRoot = await mkdtemp(join(tmpdir(), "webmux-absolute-worktrees-"));
    tempDirs.push(absoluteWorktreeRoot);
    const runtime = new ProjectRuntime();
    const tmux = new FakeTmuxGateway();
    const lifecycle = makeLifecycleService(
      repoRoot,
      tmux,
      runtime,
      new FakeDockerGateway(),
      new FakeHookRunner(),
      {
        ...TEST_CONFIG,
        workspace: {
          ...TEST_CONFIG.workspace,
          worktreeRoot: absoluteWorktreeRoot,
        },
      },
    );

    await lifecycle.createWorktree({ branch: "feature/absolute-root" });

    const worktreePath = join(absoluteWorktreeRoot, "feature", "absolute-root");
    const worktrees = new BunGitGateway().listWorktrees(repoRoot);

    expect(worktrees.some((entry) => entry.branch === "feature/absolute-root" && entry.path === worktreePath)).toBe(true);
    expect(await Bun.file(join(worktreePath, "README.md")).exists()).toBe(true);
  });

  it("creates a managed worktree for an existing local branch", async () => {
    const repoRoot = await initRepo();
    const runtime = new ProjectRuntime();
    const tmux = new FakeTmuxGateway();
    const lifecycle = makeLifecycleService(repoRoot, tmux, runtime);

    run(["git", "checkout", "-b", "feature-follow"], repoRoot);
    run(["git", "checkout", "main"], repoRoot);

    const created = await lifecycle.createWorktree({
      mode: "existing",
      branch: "feature-follow",
    });

    const worktreePath = join(repoRoot, "__worktrees", "feature-follow");
    const gitDir = new BunGitGateway().resolveWorktreeGitDir(worktreePath);

    expect(created.branch).toBe("feature-follow");
    expect(new BunGitGateway().listWorktrees(repoRoot).some((entry) =>
      entry.branch === "feature-follow" && entry.path === worktreePath
    )).toBe(true);
    expect((await readWorktreeMeta(gitDir))?.branch).toBe("feature-follow");
    expect(run(["git", "branch", "--show-current"], worktreePath)).toBe("feature-follow");
  });

  it("lists available branches excluding branches already checked out", async () => {
    const repoRoot = await initRepo();
    const runtime = new ProjectRuntime();
    const tmux = new FakeTmuxGateway();
    const lifecycle = makeLifecycleService(repoRoot, tmux, runtime);
    const git = new BunGitGateway();

    run(["git", "branch", "feature-available", "main"], repoRoot);
    run(["git", "branch", "feature-in-use", "main"], repoRoot);
    git.createWorktree({
      repoRoot,
      worktreePath: join(repoRoot, "__worktrees", "feature-in-use"),
      branch: "feature-in-use",
      mode: "existing",
    });

    expect(lifecycle.listAvailableBranches()).toEqual([
      { name: "feature-available" },
    ]);
  });

  it("lists local branches by default and includes remote branches when requested", async () => {
    const repoRoot = await initRepo();
    const remoteRoot = await mkdtemp(join(tmpdir(), "webmux-lifecycle-remote-"));
    const cloneRoot = await mkdtemp(join(tmpdir(), "webmux-lifecycle-clone-"));
    tempDirs.push(remoteRoot, cloneRoot);

    run(["git", "init", "--bare"], remoteRoot);
    run(["git", "symbolic-ref", "HEAD", "refs/heads/main"], remoteRoot);
    run(["git", "remote", "add", "origin", remoteRoot], repoRoot);
    run(["git", "push", "-u", "origin", "main"], repoRoot);

    run(["git", "clone", remoteRoot, cloneRoot], repoRoot);
    run(["git", "config", "user.name", "Remote User"], cloneRoot);
    run(["git", "config", "user.email", "remote@example.com"], cloneRoot);
    run(["git", "checkout", "-b", "feature-remote-only"], cloneRoot);
    await Bun.write(join(cloneRoot, "remote.txt"), "remote branch\n");
    run(["git", "add", "remote.txt"], cloneRoot);
    run(["git", "commit", "-m", "remote branch"], cloneRoot);
    run(["git", "push", "-u", "origin", "feature-remote-only"], cloneRoot);

    const runtime = new ProjectRuntime();
    const tmux = new FakeTmuxGateway();
    const lifecycle = makeLifecycleService(repoRoot, tmux, runtime);
    const git = new BunGitGateway();

    run(["git", "branch", "feature-local-only", "main"], repoRoot);
    run(["git", "branch", "feature-in-use", "main"], repoRoot);
    git.createWorktree({
      repoRoot,
      worktreePath: join(repoRoot, "__worktrees", "feature-in-use"),
      branch: "feature-in-use",
      mode: "existing",
    });

    expect(lifecycle.listAvailableBranches()).toEqual([
      { name: "feature-local-only" },
    ]);

    expect(lifecycle.listAvailableBranches({ includeRemote: true })).toEqual([
      { name: "feature-local-only" },
      { name: "feature-remote-only" },
    ]);
  });

  it("creates a managed worktree from an existing remote-only branch", async () => {
    const repoRoot = await initRepo();
    const remoteRoot = await mkdtemp(join(tmpdir(), "webmux-lifecycle-remote-existing-"));
    const cloneRoot = await mkdtemp(join(tmpdir(), "webmux-lifecycle-clone-existing-"));
    tempDirs.push(remoteRoot, cloneRoot);

    run(["git", "init", "--bare"], remoteRoot);
    run(["git", "symbolic-ref", "HEAD", "refs/heads/main"], remoteRoot);
    run(["git", "remote", "add", "origin", remoteRoot], repoRoot);
    run(["git", "push", "-u", "origin", "main"], repoRoot);

    run(["git", "clone", remoteRoot, cloneRoot], repoRoot);
    run(["git", "config", "user.name", "Remote User"], cloneRoot);
    run(["git", "config", "user.email", "remote@example.com"], cloneRoot);
    run(["git", "checkout", "-b", "feature-remote-existing"], cloneRoot);
    await Bun.write(join(cloneRoot, "remote.txt"), "remote branch\n");
    run(["git", "add", "remote.txt"], cloneRoot);
    run(["git", "commit", "-m", "remote branch"], cloneRoot);
    run(["git", "push", "-u", "origin", "feature-remote-existing"], cloneRoot);

    const runtime = new ProjectRuntime();
    const tmux = new FakeTmuxGateway();
    const lifecycle = makeLifecycleService(repoRoot, tmux, runtime);

    const created = await lifecycle.createWorktree({
      mode: "existing",
      branch: "feature-remote-existing",
    });

    const worktreePath = join(repoRoot, "__worktrees", "feature-remote-existing");
    expect(created.branch).toBe("feature-remote-existing");
    expect(new BunGitGateway().listWorktrees(repoRoot).some((entry) =>
      entry.branch === "feature-remote-existing" && entry.path === worktreePath
    )).toBe(true);
    expect(run(["git", "branch", "--show-current"], worktreePath)).toBe("feature-remote-existing");
    expect(
      run(["git", "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], worktreePath),
    ).toBe("origin/feature-remote-existing");
  });

  it("removes the temporary local branch when remote-only worktree creation fails", async () => {
    const repoRoot = await initRepo();
    const remoteRoot = await mkdtemp(join(tmpdir(), "webmux-lifecycle-remote-rollback-"));
    const cloneRoot = await mkdtemp(join(tmpdir(), "webmux-lifecycle-clone-rollback-"));
    tempDirs.push(remoteRoot, cloneRoot);

    run(["git", "init", "--bare"], remoteRoot);
    run(["git", "symbolic-ref", "HEAD", "refs/heads/main"], remoteRoot);
    run(["git", "remote", "add", "origin", remoteRoot], repoRoot);
    run(["git", "push", "-u", "origin", "main"], repoRoot);

    run(["git", "clone", remoteRoot, cloneRoot], repoRoot);
    run(["git", "config", "user.name", "Remote User"], cloneRoot);
    run(["git", "config", "user.email", "remote@example.com"], cloneRoot);
    run(["git", "checkout", "-b", "feature-remote-rollback"], cloneRoot);
    await Bun.write(join(cloneRoot, "remote.txt"), "remote branch\n");
    run(["git", "add", "remote.txt"], cloneRoot);
    run(["git", "commit", "-m", "remote branch"], cloneRoot);
    run(["git", "push", "-u", "origin", "feature-remote-rollback"], cloneRoot);

    const runtime = new ProjectRuntime();
    const tmux = new FakeTmuxGateway();
    const hooks = new FakeHookRunner(() => {
      throw new Error("post-create failed");
    });
    const lifecycle = makeLifecycleService(repoRoot, tmux, runtime, new FakeDockerGateway(), hooks);

    await expect(
      lifecycle.createWorktree({
        mode: "existing",
        branch: "feature-remote-rollback",
      }),
    ).rejects.toThrow("post-create failed");

    const worktreePath = join(repoRoot, "__worktrees", "feature-remote-rollback");
    expect(new BunGitGateway().listWorktrees(repoRoot).some((entry) => entry.path === worktreePath)).toBe(false);
    expect(run(["git", "branch", "--list", "feature-remote-rollback"], repoRoot)).toBe("");
    expect(run(["git", "branch", "--remotes", "--list", "origin/feature-remote-rollback"], repoRoot)).toContain(
      "origin/feature-remote-rollback",
    );
  });

  it("keeps an existing branch when creation fails after the worktree is created", async () => {
    const repoRoot = await initRepo();
    const runtime = new ProjectRuntime();
    const tmux = new FakeTmuxGateway();
    const hooks = new FakeHookRunner(() => {
      throw new Error("post-create failed");
    });
    const lifecycle = makeLifecycleService(repoRoot, tmux, runtime, new FakeDockerGateway(), hooks);

    run(["git", "checkout", "-b", "feature-existing-rollback"], repoRoot);
    run(["git", "checkout", "main"], repoRoot);

    await expect(
      lifecycle.createWorktree({
        mode: "existing",
        branch: "feature-existing-rollback",
      }),
    ).rejects.toThrow("post-create failed");

    const worktreePath = join(repoRoot, "__worktrees", "feature-existing-rollback");

    expect(new BunGitGateway().listWorktrees(repoRoot).some((entry) => entry.path === worktreePath)).toBe(false);
    expect(run(["git", "branch", "--list", "feature-existing-rollback"], repoRoot)).toContain("feature-existing-rollback");
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
      mode: "new",
      baseBranch: "main",
    });

    const opened = await lifecycle.openWorktree("feature-open");
    const gitDir = git.resolveWorktreeGitDir(worktreePath);
    const meta = await readWorktreeMeta(gitDir);

    expect(opened.branch).toBe("feature-open");
    expect(meta).not.toBeNull();
    expect(meta?.branch).toBe("feature-open");
    expect(tmux.listWindows()[0]?.windowName).toBe(buildWorktreeWindowName("feature-open"));
    expect(tmux.commands[0]?.command).toContain("claude");
    expect(tmux.commands[0]?.command).not.toContain("--continue");
    expect(runtime.getWorktreeByBranch("feature-open")?.worktreeId).toBe(opened.worktreeId);
  });

  it("creates a managed worktree from an explicit base branch", async () => {
    const repoRoot = await initRepo();
    run(["git", "checkout", "-b", "release/base"], repoRoot);
    await Bun.write(join(repoRoot, "README.md"), "# release base\n");
    run(["git", "add", "README.md"], repoRoot);
    run(["git", "commit", "-m", "release base"], repoRoot);
    run(["git", "checkout", "main"], repoRoot);

    const runtime = new ProjectRuntime();
    const tmux = new FakeTmuxGateway();
    const lifecycle = makeLifecycleService(repoRoot, tmux, runtime);

    await lifecycle.createWorktree({
      branch: "feature/from-release",
      baseBranch: "release/base",
    });

    const worktreePath = join(repoRoot, "__worktrees", "feature", "from-release");
    const gitDir = new BunGitGateway().resolveWorktreeGitDir(worktreePath);

    expect((await readWorktreeMeta(gitDir))?.baseBranch).toBe("release/base");
    expect(await Bun.file(join(worktreePath, "README.md")).text()).toBe("# release base\n");
  });

  it("rejects invalid base branch names before creating a worktree", async () => {
    const repoRoot = await initRepo();
    const runtime = new ProjectRuntime();
    const tmux = new FakeTmuxGateway();
    const lifecycle = makeLifecycleService(repoRoot, tmux, runtime);
    const worktreePath = join(repoRoot, "__worktrees", "feature", "invalid-base");

    try {
      await lifecycle.createWorktree({
        branch: "feature/invalid-base",
        baseBranch: "release base",
      });
      throw new Error("expected createWorktree to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(LifecycleError);
      if (!(error instanceof LifecycleError)) throw error;
      expect(error.message).toBe("Invalid base branch name");
      expect(error.status).toBe(400);
    }

    expect(new BunGitGateway().listWorktrees(repoRoot).some((entry) => entry.path === worktreePath)).toBe(false);
    expect(tmux.listWindows()).toEqual([]);
  });

  it("rejects self-referencing base branches before creating a worktree", async () => {
    const repoRoot = await initRepo();
    const runtime = new ProjectRuntime();
    const tmux = new FakeTmuxGateway();
    const lifecycle = makeLifecycleService(repoRoot, tmux, runtime);
    const worktreePath = join(repoRoot, "__worktrees", "feature", "loop");

    try {
      await lifecycle.createWorktree({
        branch: "feature/loop",
        baseBranch: "feature/loop",
      });
      throw new Error("expected createWorktree to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(LifecycleError);
      if (!(error instanceof LifecycleError)) throw error;
      expect(error.message).toBe("Base branch must differ from branch name");
      expect(error.status).toBe(400);
    }

    expect(new BunGitGateway().listWorktrees(repoRoot).some((entry) => entry.path === worktreePath)).toBe(false);
    expect(tmux.listWindows()).toEqual([]);
  });

  it("reopens a managed claude worktree with claude continue", async () => {
    const repoRoot = await initRepo();
    const runtime = new ProjectRuntime();
    const tmux = new FakeTmuxGateway();
    const lifecycle = makeLifecycleService(
      repoRoot,
      tmux,
      runtime,
      new FakeDockerGateway(),
      new FakeHookRunner(),
      {
        ...TEST_CONFIG,
        profiles: {
          ...TEST_CONFIG.profiles,
          default: {
            ...TEST_CONFIG.profiles.default,
            systemPrompt: "Database: ${FRONTEND_PORT}",
          },
        },
      },
    );

    await lifecycle.createWorktree({
      branch: "feature-continue",
      prompt: "fix the tests",
    });

    tmux.commands.length = 0;
    await lifecycle.closeWorktree("feature-continue");
    await lifecycle.openWorktree("feature-continue");

    const agentCommand = tmux.commands.at(-1)?.command;

    expect(agentCommand).toContain("claude --continue");
    expect(agentCommand).not.toContain("--append-system-prompt");
    expect(agentCommand).not.toContain("Database:");
    expect(agentCommand).not.toContain("fix the tests");
  });

  it("reopens a managed codex worktree with codex resume --last", async () => {
    const repoRoot = await initRepo();
    const runtime = new ProjectRuntime();
    const tmux = new FakeTmuxGateway();
    const lifecycle = makeLifecycleService(
      repoRoot,
      tmux,
      runtime,
      new FakeDockerGateway(),
      new FakeHookRunner(),
      {
        ...TEST_CONFIG,
        workspace: {
          ...TEST_CONFIG.workspace,
          defaultAgent: "codex",
        },
        profiles: {
          ...TEST_CONFIG.profiles,
          default: {
            ...TEST_CONFIG.profiles.default,
            yolo: true,
            systemPrompt: "Database: ${FRONTEND_PORT}",
          },
        },
      },
    );

    await lifecycle.createWorktree({
      branch: "feature-codex-resume",
      prompt: "ship the fix",
    });

    tmux.commands.length = 0;
    await lifecycle.closeWorktree("feature-codex-resume");
    await lifecycle.openWorktree("feature-codex-resume");

    const agentCommand = tmux.commands.at(-1)?.command;

    expect(agentCommand).toContain("codex --yolo resume --last");
    expect(agentCommand).not.toContain("developer_instructions=");
    expect(agentCommand).not.toContain("Database:");
    expect(agentCommand).not.toContain("ship the fix");
  });

  it("closes the tmux window without removing the worktree or branch", async () => {
    const repoRoot = await initRepo();
    const runtime = new ProjectRuntime();
    const tmux = new FakeTmuxGateway();
    const lifecycle = makeLifecycleService(repoRoot, tmux, runtime);

    await lifecycle.createWorktree({ branch: "feature-close" });
    await lifecycle.closeWorktree("feature-close");

    expect(tmux.listWindows()).toEqual([]);
    expect(new BunGitGateway().listWorktrees(repoRoot).some((entry) => entry.branch === "feature-close")).toBe(true);
    expect(run(["git", "branch", "--list", "feature-close"], repoRoot)).toContain("feature-close");
    expect(runtime.getWorktreeByBranch("feature-close")?.session.exists).toBe(false);
  });

  it("closes a worktree before archiving it", async () => {
    const repoRoot = await initRepo();
    const runtime = new ProjectRuntime();
    const tmux = new FakeTmuxGateway();
    const lifecycle = makeLifecycleService(repoRoot, tmux, runtime);

    await lifecycle.createWorktree({ branch: "feature-archive" });
    await lifecycle.setWorktreeArchived("feature-archive", true);

    expect(tmux.listWindows()).toEqual([]);
    expect(runtime.getWorktreeByBranch("feature-archive")?.session.exists).toBe(false);

    const archiveState = await readWorktreeArchiveState(join(repoRoot, ".git"));

    expect(archiveState.entries).toHaveLength(1);
    expect(archiveState.entries[0]?.path).toBe(join(repoRoot, "__worktrees", "feature-archive"));
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

    const worktreePath = join(repoRoot, "__worktrees", "feature-sandbox");
    const gitDir = new BunGitGateway().resolveWorktreeGitDir(worktreePath);
    const controlEnvText = await Bun.file(getWorktreeStoragePaths(gitDir).controlEnvPath).text();

    expect(tmux.listWindows()).toEqual([
      {
        sessionName: buildProjectSessionName(repoRoot),
        windowName: buildWorktreeWindowName("feature-sandbox"),
        paneCount: 1,
      },
    ]);

    expect(controlEnvText).toContain("WEBMUX_CONTROL_URL=http://host.docker.internal:5111/api/runtime/events");

    const state = runtime.getWorktreeByBranch("feature-sandbox");
    expect(state?.agent.runtime).toBe("docker");
    expect(state?.session.exists).toBe(true);
  });

  it("starts one-pane docker agent sessions without nesting docker exec inside the container shell", async () => {
    const repoRoot = await initRepo();
    const runtime = new ProjectRuntime();
    const tmux = new FakeTmuxGateway();
    const docker = new FakeDockerGateway();
    const lifecycle = makeLifecycleService(repoRoot, tmux, runtime, docker);

    await lifecycle.createWorktree({
      branch: "feature-sandbox-agent",
      profile: "sandbox",
    });

    const windowCommand = tmux.createdWindows[0]?.command;
    const agentCommand = tmux.commands[0]?.command;

    expect(windowCommand).toContain("docker exec -it");
    expect(windowCommand).toContain("wm-feature-sandbox-agent-container");
    expect(agentCommand).toContain("claude");
    expect(agentCommand).not.toContain("docker exec");
  });

  it("refreshes docker control env with a host-reachable callback when reopening", async () => {
    const repoRoot = await initRepo();
    const runtime = new ProjectRuntime();
    const tmux = new FakeTmuxGateway();
    const docker = new FakeDockerGateway();
    const lifecycle = makeLifecycleService(repoRoot, tmux, runtime, docker);

    await lifecycle.createWorktree({
      branch: "feature-sandbox-reopen",
      profile: "sandbox",
    });

    const worktreePath = join(repoRoot, "__worktrees", "feature-sandbox-reopen");
    const gitDir = new BunGitGateway().resolveWorktreeGitDir(worktreePath);
    const paths = getWorktreeStoragePaths(gitDir);
    const staleControlEnvText = (await Bun.file(paths.controlEnvPath).text()).replace(
      "http://host.docker.internal:5111/api/runtime/events",
      "http://127.0.0.1:5111/api/runtime/events",
    );
    await Bun.write(paths.controlEnvPath, staleControlEnvText);

    await lifecycle.closeWorktree("feature-sandbox-reopen");
    await lifecycle.openWorktree("feature-sandbox-reopen");

    const refreshedControlEnvText = await Bun.file(paths.controlEnvPath).text();

    expect(refreshedControlEnvText).toContain("WEBMUX_CONTROL_URL=http://host.docker.internal:5111/api/runtime/events");
  });

  it("reports backend creation phases in order until the worktree is ready", async () => {
    const repoRoot = await initRepo();
    const runtime = new ProjectRuntime();
    const tmux = new FakeTmuxGateway();
    const phases: string[] = [];
    const activeBranches = new Set<string>();
    const lifecycle = makeLifecycleService(
      repoRoot,
      tmux,
      runtime,
      new FakeDockerGateway(),
      new FakeHookRunner(),
      TEST_CONFIG,
      new BunGitGateway(),
      new FakeAutoNameService(),
      {
        onProgress: (progress) => {
          activeBranches.add(progress.branch);
          phases.push(`${progress.branch}:${progress.phase}`);
        },
        onFinished: (branch) => {
          activeBranches.delete(branch);
          phases.push(`${branch}:finished`);
        },
      },
    );

    await lifecycle.createWorktree({ branch: "feature/progress" });

    expect(phases).toEqual([
      "feature/progress:creating_worktree",
      "feature/progress:running_post_create_hook",
      "feature/progress:preparing_runtime",
      "feature/progress:starting_session",
      "feature/progress:reconciling",
      "feature/progress:finished",
    ]);
    expect(activeBranches.has("feature/progress")).toBe(false);
  });

  it("clears creation progress when the first phase callback fails", async () => {
    const repoRoot = await initRepo();
    const runtime = new ProjectRuntime();
    const tmux = new FakeTmuxGateway();
    const finishedBranches: string[] = [];
    const lifecycle = makeLifecycleService(
      repoRoot,
      tmux,
      runtime,
      new FakeDockerGateway(),
      new FakeHookRunner(),
      TEST_CONFIG,
      new BunGitGateway(),
      new FakeAutoNameService(),
      {
        onProgress: (progress) => {
          if (progress.phase === "creating_worktree") {
            throw new Error("progress failed");
          }
        },
        onFinished: (branch) => {
          finishedBranches.push(branch);
        },
      },
    );

    await expect(
      lifecycle.createWorktree({ branch: "feature/progress-failure" }),
    ).rejects.toThrow("progress failed");
    expect(finishedBranches).toEqual(["feature/progress-failure"]);
  });

  it("uses auto_name to generate the branch when the prompt is present and no branch was provided", async () => {
    const repoRoot = await initRepo();
    const runtime = new ProjectRuntime();
    const tmux = new FakeTmuxGateway();
    const autoName = new FakeAutoNameService("fix-login-flow");
    const lifecycle = makeLifecycleService(
      repoRoot,
      tmux,
      runtime,
      new FakeDockerGateway(),
      new FakeHookRunner(),
      {
        ...TEST_CONFIG,
        autoName: {
          provider: "claude" as const,
          systemPrompt: "Generate a branch name",
        },
      },
      new BunGitGateway(),
      autoName,
    );

    const created = await lifecycle.createWorktree({
      prompt: "Fix the login flow for OAuth redirects",
    });

    expect(created.branch).toBe("fix-login-flow");
    expect(autoName.calls).toEqual([
      {
        config: {
          provider: "claude",
          systemPrompt: "Generate a branch name",
        },
        task: "Fix the login flow for OAuth redirects",
      },
    ]);
  });

  it("uses auto_name once when creating paired worktrees without an explicit branch", async () => {
    const repoRoot = await initRepo();
    const runtime = new ProjectRuntime();
    const tmux = new FakeTmuxGateway();
    const autoName = new FakeAutoNameService("fix-login-flow");
    const lifecycle = makeLifecycleService(
      repoRoot,
      tmux,
      runtime,
      new FakeDockerGateway(),
      new FakeHookRunner(),
      {
        ...TEST_CONFIG,
        autoName: {
          provider: "claude" as const,
          systemPrompt: "Generate a branch name",
        },
      },
      new BunGitGateway(),
      autoName,
    );

    const created = await lifecycle.createWorktrees({
      prompt: "Fix the login flow for OAuth redirects",
      agent: "both",
    });

    expect(created).toEqual({
      primaryBranch: "claude-fix-login-flow",
      branches: ["claude-fix-login-flow", "codex-fix-login-flow"],
    });
    expect(autoName.calls).toEqual([
      {
        config: {
          provider: "claude",
          systemPrompt: "Generate a branch name",
        },
        task: "Fix the login flow for OAuth redirects",
      },
    ]);
  });

  it("force removes a dirty worktree", async () => {
    const repoRoot = await initRepo();
    const runtime = new ProjectRuntime();
    const tmux = new FakeTmuxGateway();
    const hooks = new FakeHookRunner();
    const lifecycle = makeLifecycleService(repoRoot, tmux, runtime, new FakeDockerGateway(), hooks);

    await lifecycle.createWorktree({ branch: "feature-dirty" });

    const worktreePath = join(repoRoot, "__worktrees", "feature-dirty");
    await Bun.write(join(worktreePath, "README.md"), "# dirty\n");

    await lifecycle.removeWorktree("feature-dirty");

    expect(hooks.calls.filter((call) => call.name === "preRemove")).toHaveLength(1);
    expect(new BunGitGateway().listWorktrees(repoRoot).some((entry) => entry.path === worktreePath)).toBe(false);
    expect(run(["git", "branch", "--list", "feature-dirty"], repoRoot)).toBe("");
  });

  it("force removes a worktree that is ahead of its upstream", async () => {
    const repoRoot = await initRepo();
    const runtime = new ProjectRuntime();
    const tmux = new FakeTmuxGateway();
    const hooks = new FakeHookRunner();
    const git = new AheadTrackingGitGateway(new Set(["feature-ahead"]));
    const lifecycle = makeLifecycleService(
      repoRoot,
      tmux,
      runtime,
      new FakeDockerGateway(),
      hooks,
      TEST_CONFIG,
      git,
    );

    await lifecycle.createWorktree({ branch: "feature-ahead" });

    await lifecycle.removeWorktree("feature-ahead");

    expect(hooks.calls.filter((call) => call.name === "preRemove")).toHaveLength(1);
    expect(run(["git", "branch", "--list", "feature-ahead"], repoRoot)).toBe("");
  });

  it("prunes all project worktrees", async () => {
    const repoRoot = await initRepo();
    const runtime = new ProjectRuntime();
    const tmux = new FakeTmuxGateway();
    const docker = new FakeDockerGateway();
    const hooks = new FakeHookRunner();
    const lifecycle = makeLifecycleService(repoRoot, tmux, runtime, docker, hooks);

    await lifecycle.createWorktree({ branch: "feature-prune-host" });
    await lifecycle.createWorktree({ branch: "feature-prune-docker", profile: "sandbox" });
    await lifecycle.closeWorktree("feature-prune-host");

    const result = await lifecycle.pruneWorktrees();

    expect(result.removedBranches).toEqual([
      "feature-prune-docker",
      "feature-prune-host",
    ]);
    expect(hooks.calls.filter((call) => call.name === "preRemove").map((call) => call.cwd).sort()).toEqual([
      join(repoRoot, "__worktrees", "feature-prune-docker"),
      join(repoRoot, "__worktrees", "feature-prune-host"),
    ]);
    expect(docker.removed).toEqual(["feature-prune-docker"]);
    expect(new BunGitGateway().listWorktrees(repoRoot).filter((entry) => entry.path !== repoRoot)).toEqual([]);
    expect(run(["git", "branch", "--list", "feature-prune-host"], repoRoot)).toBe("");
    expect(run(["git", "branch", "--list", "feature-prune-docker"], repoRoot)).toBe("");
    expect(tmux.listWindows()).toEqual([]);
    expect(runtime.listWorktrees()).toEqual([]);
  });

  it("removes the sandbox container before deleting a docker worktree", async () => {
    const repoRoot = await initRepo();
    const runtime = new ProjectRuntime();
    const tmux = new FakeTmuxGateway();
    const docker = new FakeDockerGateway();
    const hooks = new FakeHookRunner();
    const lifecycle = makeLifecycleService(repoRoot, tmux, runtime, docker, hooks);

    await lifecycle.createWorktree({
      branch: "feature-remove-docker",
      profile: "sandbox",
    });

    await lifecycle.removeWorktree("feature-remove-docker");

    expect(hooks.calls.some((call) =>
      call.name === "preRemove"
        && call.cwd === join(repoRoot, "__worktrees", "feature-remove-docker")
        && call.env.WEBMUX_RUNTIME === "docker"
    )).toBe(true);
    expect(docker.removed).toContain("feature-remove-docker");
    expect(new BunGitGateway().listWorktrees(repoRoot).some((entry) => entry.branch === "feature-remove-docker")).toBe(false);
  });

  it("falls back to the first configured profile when no default profile exists", async () => {
    const repoRoot = await initRepo();
    const runtime = new ProjectRuntime();
    const tmux = new FakeTmuxGateway();
    const lifecycle = makeLifecycleService(
      repoRoot,
      tmux,
      runtime,
      new FakeDockerGateway(),
      new FakeHookRunner(),
      NO_DEFAULT_PROFILE_CONFIG,
    );

    await lifecycle.createWorktree({ branch: "feature-no-default-create" });

    const createdGitDir = new BunGitGateway().resolveWorktreeGitDir(
      join(repoRoot, "__worktrees", "feature-no-default-create"),
    );
    expect((await readWorktreeMeta(createdGitDir))?.profile).toBe("slim");

    const unmanagedPath = join(repoRoot, "__worktrees", "feature-no-default-open");
    new BunGitGateway().createWorktree({
      repoRoot,
      worktreePath: unmanagedPath,
      branch: "feature-no-default-open",
      mode: "new",
      baseBranch: "main",
    });

    await lifecycle.openWorktree("feature-no-default-open");

    const openedGitDir = new BunGitGateway().resolveWorktreeGitDir(unmanagedPath);
    expect((await readWorktreeMeta(openedGitDir))?.profile).toBe("slim");
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

  it("merges and cleans up a worktree even when the source branch is ahead", async () => {
    const repoRoot = await initRepo();
    const runtime = new ProjectRuntime();
    const tmux = new FakeTmuxGateway();
    const hooks = new FakeHookRunner();
    const git = new AheadTrackingGitGateway(new Set(["feature-merge-ahead"]));
    const lifecycle = makeLifecycleService(
      repoRoot,
      tmux,
      runtime,
      new FakeDockerGateway(),
      hooks,
      TEST_CONFIG,
      git,
    );

    await lifecycle.createWorktree({ branch: "feature-merge-ahead" });

    const worktreePath = join(repoRoot, "__worktrees", "feature-merge-ahead");
    await Bun.write(join(worktreePath, "README.md"), "# merged ahead change\n");
    run(["git", "add", "README.md"], worktreePath);
    run(["git", "commit", "-m", "feature ahead change"], worktreePath);

    await lifecycle.mergeWorktree("feature-merge-ahead");

    expect(hooks.calls.some((call) => call.name === "preRemove" && call.cwd === worktreePath)).toBe(true);
    expect(new BunGitGateway().listWorktrees(repoRoot).some((entry) => entry.path === worktreePath)).toBe(false);
    expect(run(["git", "branch", "--list", "feature-merge-ahead"], repoRoot)).toBe("");
    expect(await Bun.file(join(repoRoot, "README.md")).text()).toContain("merged ahead change");
  });
});
