import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectConfig } from "../domain/config";
import { BunGitGateway, type GitGateway } from "../adapters/git";
import type { LifecycleHookRunner, RunLifecycleHookInput } from "../adapters/hooks";
import type { PortProbe } from "../adapters/port-probe";
import { buildProjectSessionName, buildWorktreeParkingWindowName, buildWorktreeWindowName, type TmuxGateway, type TmuxWindowSummary } from "../adapters/tmux";
import { getWorktreeStoragePaths, readWorktreeArchiveState, readWorktreeMeta, writeWorktreeMeta } from "../adapters/fs";
import type { DockerGateway, LaunchContainerOpts } from "../adapters/docker";
import type { SessionDiscoveryGateway } from "../adapters/session-discovery";
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
  readonly swaps: Array<{ source: string; destination: string }> = [];
  readonly killedPanes: string[] = [];
  private paneCounter = 0;

  // Each resolution yields a fresh id so a code path that reads the same slot twice gets two
  // different values — surfacing any double-read where a single captured id is expected.
  getPaneId(_target: string): string {
    return `%pane-${this.paneCounter++}`;
  }

  createParkedPane(opts: { sessionName: string; parkingWindow: string; cwd: string; command: string }): string {
    const window = this.windows.get(this.key(opts.sessionName, opts.parkingWindow));
    if (window) {
      window.paneCount += 1;
    } else {
      this.windows.set(this.key(opts.sessionName, opts.parkingWindow), {
        sessionName: opts.sessionName,
        windowName: opts.parkingWindow,
        paneCount: 1,
      });
    }
    return `%parked-${this.paneCounter++}`;
  }

  swapPanes(source: string, destination: string): void {
    this.swaps.push({ source, destination });
  }

  killPane(target: string): void {
    this.killedPanes.push(target);
  }

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
  agents: {},
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
  oneshot: { systemPrompt: "be autonomous" },
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
  sessionDiscovery: SessionDiscoveryGateway = { listSessionIds: async () => [] },
  // `null` explicitly configures no control reporting (passing `undefined` would
  // fall back to the default below).
  controlBaseUrl: string | null = "http://127.0.0.1:5111",
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
    controlBaseUrl: controlBaseUrl ?? undefined,
    getControlToken: async () => "secret-token",
    config,
    archiveState: new ArchiveStateService(git.resolveWorktreeGitDir(repoRoot)),
    git,
    tmux,
    sessionDiscovery,
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

  it("builds original and agent-prefixed targets from selected agents", () => {
    expect(buildCreateWorktreeTargets("feature/search", ["claude"])).toEqual([
      { branch: "feature/search", agent: "claude" },
    ]);
    expect(buildCreateWorktreeTargets("feature/search", ["claude", "codex", "gemini"])).toEqual([
      { branch: "claude-feature/search", agent: "claude" },
      { branch: "codex-feature/search", agent: "codex" },
      { branch: "gemini-feature/search", agent: "gemini" },
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

  it("writes no control.env when no control base URL is configured", async () => {
    const repoRoot = await initRepo();
    const runtime = new ProjectRuntime();
    const tmux = new FakeTmuxGateway();
    // The CLI leaves controlBaseUrl undefined when it can't resolve the project
    // prefix (no server running). We'd rather write no control.env than one with
    // a wrong (unrouted) URL — the dashboard rewrites it on next open/refresh.
    const lifecycle = makeLifecycleService(
      repoRoot,
      tmux,
      runtime,
      new FakeDockerGateway(),
      new FakeHookRunner(),
      TEST_CONFIG,
      new BunGitGateway(),
      new FakeAutoNameService(),
      {},
      { listSessionIds: async () => [] },
      null,
    );

    await lifecycle.createWorktree({ branch: "feature/search" });

    const worktreePath = join(repoRoot, "__worktrees", "feature", "search");
    const gitDir = new BunGitGateway().resolveWorktreeGitDir(worktreePath);
    const paths = getWorktreeStoragePaths(gitDir);

    expect(await Bun.file(paths.controlEnvPath).exists()).toBe(false);
    // The runtime env (unrelated to control reporting) is still written.
    expect(await Bun.file(paths.runtimeEnvPath).exists()).toBe(true);
  });

  it("creates one managed worktree per selected agent from one task branch", async () => {
    const repoRoot = await initRepo();
    const runtime = new ProjectRuntime();
    const tmux = new FakeTmuxGateway();
    const lifecycle = makeLifecycleService(repoRoot, tmux, runtime);
    const git = new BunGitGateway();

    const created = await lifecycle.createWorktrees({
      branch: "feature/search",
      prompt: "fix the search flow",
      agents: ["claude", "codex"],
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
      agents: ["claude", "codex"],
    })).rejects.toThrow("Branch already exists: codex-feature/search");

    expect(run(["git", "branch", "--list", "codex-feature/search"], repoRoot)).toContain("codex-feature/search");
    expect(git.listWorktrees(repoRoot).some((entry) => entry.branch === "claude-feature/search")).toBe(false);
    expect(runtime.getWorktreeByBranch("claude-feature/search")).toBeNull();
    expect(tmux.hasWindow(
      buildProjectSessionName(repoRoot),
      buildWorktreeWindowName("claude-feature/search"),
    )).toBe(false);
  });

  it("rejects invalid multi-agent selections", async () => {
    const repoRoot = await initRepo();
    const runtime = new ProjectRuntime();
    const tmux = new FakeTmuxGateway();
    const lifecycle = makeLifecycleService(repoRoot, tmux, runtime);

    await expect(lifecycle.createWorktrees({
      branch: "main",
      mode: "existing",
      agents: ["claude", "codex"],
    })).rejects.toThrow("Creating multiple agents is only supported for new worktrees");

    await expect(lifecycle.createWorktrees({
      branch: "feature/search",
      agents: ["", "   "],
    })).rejects.toThrow("At least one agent must be selected");

    await expect(lifecycle.createWorktrees({
      branch: "feature/search",
      agents: ["missing"],
    })).rejects.toThrow("Unknown agent: missing");
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

  it("appends the oneshot system prompt to fresh launches when source is oneshot", async () => {
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
            systemPrompt: "base profile prompt",
          },
        },
        oneshot: { systemPrompt: "complete the task autonomously" },
      },
    );

    await lifecycle.createWorktree({
      branch: "feature/oneshot-prompt",
      source: "oneshot",
    });

    const agentCommand = tmux.commands.find(({ target }) =>
      target === `${buildProjectSessionName(repoRoot)}:${buildWorktreeWindowName("feature/oneshot-prompt")}.0`
    )?.command;

    expect(agentCommand).toContain("base profile prompt");
    expect(agentCommand).toContain("complete the task autonomously");
  });

  it("does not append the oneshot system prompt for ui-sourced worktrees", async () => {
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
            systemPrompt: "base profile prompt",
          },
        },
        oneshot: { systemPrompt: "complete the task autonomously" },
      },
    );

    await lifecycle.createWorktree({
      branch: "feature/ui-prompt",
    });

    const agentCommand = tmux.commands.find(({ target }) =>
      target === `${buildProjectSessionName(repoRoot)}:${buildWorktreeWindowName("feature/ui-prompt")}.0`
    )?.command;

    expect(agentCommand).toContain("base profile prompt");
    expect(agentCommand).not.toContain("complete the task autonomously");
  });

  it("launches custom agents through interpolated command templates", async () => {
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
        agents: {
          gemini: {
            label: "Gemini CLI",
            startCommand: 'gemini --task "${PROMPT}" --cwd "${WORKTREE_PATH}" --repo "${REPO_PATH}" --branch "${BRANCH}" --profile "${PROFILE}"',
            resumeCommand: 'gemini resume --branch "${BRANCH}"',
          },
        },
      },
    );

    await lifecycle.createWorktree({
      branch: "feature/custom-agent",
      prompt: "fix the search flow",
      agent: "gemini",
    });

    const agentCommand = tmux.commands.at(-1)?.command;
    const meta = await readWorktreeMeta(
      new BunGitGateway().resolveWorktreeGitDir(join(repoRoot, "__worktrees", "feature", "custom-agent")),
    );

    expect(meta?.agent).toBe("gemini");
    expect(agentCommand).toContain("export WEBMUX_AGENT_PROMPT='fix the search flow'");
    expect(agentCommand).toContain(`export WEBMUX_AGENT_REPO_PATH='${repoRoot}'`);
    expect(agentCommand).toContain('gemini --task "$WEBMUX_AGENT_PROMPT" --cwd "$WEBMUX_AGENT_WORKTREE_PATH" --repo "$WEBMUX_AGENT_REPO_PATH" --branch "$WEBMUX_AGENT_BRANCH" --profile "$WEBMUX_AGENT_PROFILE"');

    tmux.commands.length = 0;
    await lifecycle.closeWorktree("feature/custom-agent");
    await lifecycle.openWorktree("feature/custom-agent");

    const reopenCommand = tmux.commands.at(-1)?.command;
    expect(reopenCommand).toContain('gemini resume --branch "$WEBMUX_AGENT_BRANCH"');
  });

  it("reopens custom agents without resume support in fresh mode", async () => {
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
        agents: {
          gemini: {
            label: "Gemini CLI",
            startCommand: 'gemini --system "${SYSTEM_PROMPT}" --task "${PROMPT}" --branch "${BRANCH}"',
          },
        },
      },
    );

    await lifecycle.createWorktree({
      branch: "feature/custom-fresh-reopen",
      prompt: "fix the search flow",
      agent: "gemini",
    });

    tmux.commands.length = 0;
    await lifecycle.closeWorktree("feature/custom-fresh-reopen");
    await lifecycle.openWorktree("feature/custom-fresh-reopen");

    const reopenCommand = tmux.commands.at(-1)?.command;
    expect(reopenCommand).toContain('gemini --system "$WEBMUX_AGENT_SYSTEM_PROMPT" --task "$WEBMUX_AGENT_PROMPT" --branch "$WEBMUX_AGENT_BRANCH"');
    expect(reopenCommand).toContain("export WEBMUX_AGENT_SYSTEM_PROMPT='Database: ");
    expect(reopenCommand).not.toContain("export WEBMUX_AGENT_SYSTEM_PROMPT=''");
    expect(reopenCommand).not.toContain("gemini resume");
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

    expect(agentCommand).toContain("codex --enable hooks --yolo resume --last");
    expect(agentCommand).not.toContain("developer_instructions=");
    expect(agentCommand).not.toContain("Database:");
    expect(agentCommand).not.toContain("ship the fix");
  });

  it("forwards an explicit follow-up prompt through openWorktree to claude --continue", async () => {
    const repoRoot = await initRepo();
    const runtime = new ProjectRuntime();
    const tmux = new FakeTmuxGateway();
    const lifecycle = makeLifecycleService(repoRoot, tmux, runtime);

    await lifecycle.createWorktree({
      branch: "feature-follow-up",
      prompt: "initial task",
    });

    tmux.commands.length = 0;
    await lifecycle.closeWorktree("feature-follow-up");
    await lifecycle.openWorktree("feature-follow-up", { prompt: "now do the follow-up" });

    const agentCommand = tmux.commands.at(-1)?.command;

    expect(agentCommand).toContain("claude");
    expect(agentCommand).toContain("--continue");
    expect(agentCommand).toContain("now do the follow-up");
    // The original creation prompt must NOT replay even though a different
    // follow-up is supplied (defense-in-depth from PR #116).
    expect(agentCommand).not.toContain("initial task");
  });

  it("reopens a stale managed codex terminal from its saved app-server thread", async () => {
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
          },
        },
      },
    );

    await lifecycle.createWorktree({
      branch: "feature-codex-open-refresh",
      prompt: "ship the fix",
    });

    const worktreePath = join(repoRoot, "__worktrees", "feature-codex-open-refresh");
    const gitDir = new BunGitGateway().resolveWorktreeGitDir(worktreePath);
    const meta = await readWorktreeMeta(gitDir);
    if (!meta) throw new Error("Expected worktree metadata");
    await writeWorktreeMeta(gitDir, {
      ...meta,
      agentTerminalStale: true,
      conversation: {
        provider: "codexAppServer",
        conversationId: "thread-open-refresh",
        threadId: "thread-open-refresh",
        cwd: worktreePath,
        lastSeenAt: "2026-04-15T10:00:00.000Z",
      },
    });

    tmux.commands.length = 0;
    await lifecycle.closeWorktree("feature-codex-open-refresh");
    await lifecycle.openWorktree("feature-codex-open-refresh");

    const agentCommand = tmux.commands.at(-1)?.command;
    expect(agentCommand).toContain("codex --enable hooks --yolo resume 'thread-open-refresh'");
    expect(agentCommand).not.toContain("resume --last");

    const refreshedMeta = await readWorktreeMeta(gitDir);
    expect(refreshedMeta?.agentTerminalStale).toBe(false);
    expect(runtime.getWorktreeByBranch("feature-codex-open-refresh")?.agentTerminalStale).toBe(false);
  });

  it("refreshes a managed codex terminal from its saved app-server thread", async () => {
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
          },
        },
      },
    );

    await lifecycle.createWorktree({
      branch: "feature-codex-refresh",
      prompt: "ship the fix",
    });

    const worktreePath = join(repoRoot, "__worktrees", "feature-codex-refresh");
    const gitDir = new BunGitGateway().resolveWorktreeGitDir(worktreePath);
    const meta = await readWorktreeMeta(gitDir);
    if (!meta) throw new Error("Expected worktree metadata");
    await writeWorktreeMeta(gitDir, {
      ...meta,
      agentTerminalStale: true,
      conversation: {
        provider: "codexAppServer",
        conversationId: "thread-refresh",
        threadId: "thread-refresh",
        cwd: worktreePath,
        lastSeenAt: "2026-04-15T10:00:00.000Z",
      },
    });

    tmux.commands.length = 0;
    await lifecycle.refreshAgentTerminal("feature-codex-refresh");

    const agentCommand = tmux.commands.at(-1)?.command;
    expect(agentCommand).toContain("codex --enable hooks --yolo resume 'thread-refresh'");
    expect(agentCommand).not.toContain("resume --last");

    const refreshedMeta = await readWorktreeMeta(gitDir);
    expect(refreshedMeta?.agentTerminalStale).toBe(false);
    expect(runtime.getWorktreeByBranch("feature-codex-refresh")?.agentTerminalStale).toBe(false);
  });

  it("refreshes a managed claude terminal from its saved session", async () => {
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
            yolo: true,
          },
        },
      },
    );

    await lifecycle.createWorktree({
      branch: "feature-claude-refresh",
      prompt: "ship the fix",
    });

    const worktreePath = join(repoRoot, "__worktrees", "feature-claude-refresh");
    const gitDir = new BunGitGateway().resolveWorktreeGitDir(worktreePath);
    const meta = await readWorktreeMeta(gitDir);
    if (!meta) throw new Error("Expected worktree metadata");
    await writeWorktreeMeta(gitDir, {
      ...meta,
      agentTerminalStale: true,
      conversation: {
        provider: "claudeCode",
        conversationId: "session-refresh",
        sessionId: "session-refresh",
        cwd: worktreePath,
        lastSeenAt: "2026-04-15T10:00:00.000Z",
      },
    });

    tmux.commands.length = 0;
    await lifecycle.refreshAgentTerminal("feature-claude-refresh");

    const agentCommand = tmux.commands.at(-1)?.command;
    expect(agentCommand).toContain("claude --dangerously-skip-permissions --resume 'session-refresh'");
    expect(agentCommand).not.toContain("--continue");

    const refreshedMeta = await readWorktreeMeta(gitDir);
    expect(refreshedMeta?.agentTerminalStale).toBe(false);
    expect(runtime.getWorktreeByBranch("feature-claude-refresh")?.agentTerminalStale).toBe(false);
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

  it("updates and clears a worktree label in metadata and runtime state", async () => {
    const repoRoot = await initRepo();
    const runtime = new ProjectRuntime();
    const tmux = new FakeTmuxGateway();
    const lifecycle = makeLifecycleService(repoRoot, tmux, runtime);

    const worktreePath = join(repoRoot, "__worktrees", "feature-label");
    await lifecycle.createWorktree({ branch: "feature-label" });
    const gitDir = new BunGitGateway().resolveWorktreeGitDir(worktreePath);
    const paths = getWorktreeStoragePaths(gitDir);
    await Bun.write(paths.runtimeEnvPath, "runtime-marker\n");
    await Bun.write(paths.controlEnvPath, "control-marker\n");
    const allocatedPorts = { ...(await readWorktreeMeta(gitDir))?.allocatedPorts };
    const labeled = await lifecycle.setWorktreeLabel("feature-label", "  Search ranking  ");

    expect(labeled).toEqual({ label: "Search ranking" });
    expect((await readWorktreeMeta(gitDir))?.label).toBe("Search ranking");
    expect(runtime.getWorktreeByBranch("feature-label")?.label).toBe("Search ranking");
    expect(await Bun.file(paths.runtimeEnvPath).text()).toBe("runtime-marker\n");
    expect(await Bun.file(paths.controlEnvPath).text()).toBe("control-marker\n");
    expect((await readWorktreeMeta(gitDir))?.allocatedPorts).toEqual(allocatedPorts);

    const cleared = await lifecycle.setWorktreeLabel("feature-label", "");

    expect(cleared).toEqual({ label: null });
    expect((await readWorktreeMeta(gitDir))?.label).toBeUndefined();
    expect(runtime.getWorktreeByBranch("feature-label")?.label).toBeNull();
    expect(await Bun.file(paths.runtimeEnvPath).text()).toBe("runtime-marker\n");
    expect(await Bun.file(paths.controlEnvPath).text()).toBe("control-marker\n");
    expect((await readWorktreeMeta(gitDir))?.allocatedPorts).toEqual(allocatedPorts);
  });

  it("rejects labeling unmanaged worktrees without creating metadata", async () => {
    const repoRoot = await initRepo();
    const runtime = new ProjectRuntime();
    const tmux = new FakeTmuxGateway();
    const lifecycle = makeLifecycleService(repoRoot, tmux, runtime);
    const git = new BunGitGateway();
    const worktreePath = join(repoRoot, "__worktrees", "feature-unmanaged-label");

    git.createWorktree({
      repoRoot,
      worktreePath,
      branch: "feature-unmanaged-label",
      mode: "new",
      baseBranch: "main",
    });
    const gitDir = git.resolveWorktreeGitDir(worktreePath);
    const paths = getWorktreeStoragePaths(gitDir);

    await expect(lifecycle.setWorktreeLabel("feature-unmanaged-label", "Search ranking"))
      .rejects.toMatchObject({
        status: 409,
        message: "Worktree feature-unmanaged-label has no managed metadata to label",
      });
    expect(await Bun.file(paths.metaPath).exists()).toBe(false);
    expect(await Bun.file(paths.runtimeEnvPath).exists()).toBe(false);
    expect(await Bun.file(paths.controlEnvPath).exists()).toBe(false);
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
      agents: ["claude", "codex"],
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

  it("prunes only closed worktrees, leaving open ones untouched", async () => {
    const repoRoot = await initRepo();
    const runtime = new ProjectRuntime();
    const tmux = new FakeTmuxGateway();
    const docker = new FakeDockerGateway();
    const hooks = new FakeHookRunner();
    const lifecycle = makeLifecycleService(repoRoot, tmux, runtime, docker, hooks);

    await lifecycle.createWorktree({ branch: "feature-prune-host" });
    await lifecycle.createWorktree({ branch: "feature-prune-docker", profile: "sandbox" });
    // feature-prune-host is closed (no tmux window); feature-prune-docker stays open.
    await lifecycle.closeWorktree("feature-prune-host");

    const result = await lifecycle.pruneWorktrees();

    expect(result.removedBranches).toEqual(["feature-prune-host"]);
    expect(hooks.calls.filter((call) => call.name === "preRemove").map((call) => call.cwd)).toEqual([
      join(repoRoot, "__worktrees", "feature-prune-host"),
    ]);
    expect(docker.removed).toEqual([]);
    expect(new BunGitGateway().listWorktrees(repoRoot).filter((entry) => entry.path !== repoRoot).map((entry) => entry.branch)).toEqual([
      "feature-prune-docker",
    ]);
    expect(run(["git", "branch", "--list", "feature-prune-host"], repoRoot)).toBe("");
    expect(run(["git", "branch", "--list", "feature-prune-docker"], repoRoot)).not.toBe("");
    expect(runtime.listWorktrees().map((entry) => entry.branch)).toEqual(["feature-prune-docker"]);
  });

  it("prunes nothing when all worktrees are open", async () => {
    const repoRoot = await initRepo();
    const runtime = new ProjectRuntime();
    const tmux = new FakeTmuxGateway();
    const docker = new FakeDockerGateway();
    const hooks = new FakeHookRunner();
    const lifecycle = makeLifecycleService(repoRoot, tmux, runtime, docker, hooks);

    await lifecycle.createWorktree({ branch: "feature-open" });

    const result = await lifecycle.pruneWorktrees();

    expect(result.removedBranches).toEqual([]);
    expect(runtime.listWorktrees().map((entry) => entry.branch)).toEqual(["feature-open"]);
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

  it("disarmOneshot clears the oneshot block from meta and preserves other fields", async () => {
    const repoRoot = await initRepo();
    const lifecycle = makeLifecycleService(
      repoRoot,
      new FakeTmuxGateway(),
      new ProjectRuntime(),
      new FakeDockerGateway(),
    );
    await lifecycle.createWorktree({ branch: "feature/disarm" });
    const worktreePath = join(repoRoot, "__worktrees", "feature", "disarm");
    const gitDir = new BunGitGateway().resolveWorktreeGitDir(worktreePath);

    const baseMeta = await readWorktreeMeta(gitDir);
    if (!baseMeta) throw new Error("expected meta after createWorktree");
    await writeWorktreeMeta(gitDir, {
      ...baseMeta,
      oneshot: {
        autoCloseOnDone: true,
        postToLinearOnDone: { kind: "issue", issueId: "ENG-9" },
      },
    });
    expect((await readWorktreeMeta(gitDir))?.oneshot).toBeDefined();

    const disarmed = await lifecycle.disarmOneshot("feature/disarm");

    expect(disarmed).toBe(true);
    const after = await readWorktreeMeta(gitDir);
    expect(after?.oneshot).toBeUndefined();
    expect(after?.branch).toBe(baseMeta.branch);
    expect(after?.profile).toBe(baseMeta.profile);
    expect(after?.allocatedPorts).toEqual(baseMeta.allocatedPorts);
    expect(after?.startupEnvValues).toEqual(baseMeta.startupEnvValues);

    // Idempotent: a second call returns false because there is nothing to clear.
    expect(await lifecycle.disarmOneshot("feature/disarm")).toBe(false);
  });

  function makeTabLifecycle(
    repoRoot: string,
    tmux: FakeTmuxGateway,
    runtime: ProjectRuntime,
    rootSessionIds: string[] = ["root-session"],
  ): LifecycleService {
    return makeLifecycleService(
      repoRoot,
      tmux,
      runtime,
      new FakeDockerGateway(),
      new FakeHookRunner(),
      TEST_CONFIG,
      new BunGitGateway(),
      new FakeAutoNameService(),
      {},
      { listSessionIds: async () => rootSessionIds },
    );
  }

  it("forks a tab into a parked pane and swaps it into the visible agent slot", async () => {
    const repoRoot = await initRepo();
    const runtime = new ProjectRuntime();
    const tmux = new FakeTmuxGateway();
    const lifecycle = makeTabLifecycle(repoRoot, tmux, runtime);

    await lifecycle.createWorktree({ branch: "feature-fork" });
    const { tab } = await lifecycle.createWorktreeTab("feature-fork");

    expect(tab.kind).toBe("fork");
    expect(tab.tabId).toBe("fork-1");
    expect(tab.label).toBe("Fork 1");
    expect(tab.sessionId).not.toBeNull();
    if (!tab.paneId) throw new Error("expected fork pane id");

    const session = buildProjectSessionName(repoRoot);
    expect(tmux.hasWindow(session, buildWorktreeParkingWindowName("feature-fork"))).toBe(true);

    // The new fork is brought on-screen by swapping its parked pane into the visible slot.
    expect(tmux.swaps).toHaveLength(1);
    expect(tmux.swaps[0]?.source).toBe(tab.paneId);

    const gitDir = new BunGitGateway().resolveWorktreeGitDir(join(repoRoot, "__worktrees", "feature-fork"));
    const meta = await readWorktreeMeta(gitDir);
    expect(meta?.tabs?.map((entry) => entry.tabId)).toEqual(["root", "fork-1"]);
    expect(meta?.activeTabId).toBe("fork-1");
    // The outgoing root tab records the pane it was parked into, and its discovered session id.
    const rootEntry = meta?.tabs?.find((entry) => entry.tabId === "root");
    expect(rootEntry?.paneId).toBeTruthy();
    expect(rootEntry?.sessionId).toBe("root-session");
  });

  it("selects another tab by swapping its parked pane back into the visible slot", async () => {
    const repoRoot = await initRepo();
    const runtime = new ProjectRuntime();
    const tmux = new FakeTmuxGateway();
    const lifecycle = makeTabLifecycle(repoRoot, tmux, runtime);

    await lifecycle.createWorktree({ branch: "feature-select" });
    await lifecycle.createWorktreeTab("feature-select");

    const gitDir = new BunGitGateway().resolveWorktreeGitDir(join(repoRoot, "__worktrees", "feature-select"));
    const beforeRootPaneId = (await readWorktreeMeta(gitDir))?.tabs?.find((entry) => entry.tabId === "root")?.paneId;
    if (!beforeRootPaneId) throw new Error("expected root pane id after fork");

    tmux.swaps.length = 0;
    await lifecycle.selectWorktreeTab("feature-select", "root");

    expect(tmux.swaps).toHaveLength(1);
    expect(tmux.swaps[0]?.source).toBe(beforeRootPaneId);

    const meta = await readWorktreeMeta(gitDir);
    expect(meta?.activeTabId).toBe("root");
  });

  it("deletes a fork tab, swapping the root back on-screen and killing the fork pane", async () => {
    const repoRoot = await initRepo();
    const runtime = new ProjectRuntime();
    const tmux = new FakeTmuxGateway();
    const lifecycle = makeTabLifecycle(repoRoot, tmux, runtime);

    await lifecycle.createWorktree({ branch: "feature-del" });
    const { tab } = await lifecycle.createWorktreeTab("feature-del");
    if (!tab.paneId) throw new Error("expected fork pane id");

    const gitDir = new BunGitGateway().resolveWorktreeGitDir(join(repoRoot, "__worktrees", "feature-del"));
    const rootPaneId = (await readWorktreeMeta(gitDir))?.tabs?.find((entry) => entry.tabId === "root")?.paneId;
    if (!rootPaneId) throw new Error("expected root pane id after fork");

    tmux.swaps.length = 0;
    await lifecycle.deleteWorktreeTab("feature-del", "fork-1");

    // The deleted fork was active/on-screen, so the root is swapped back before its pane is killed.
    expect(tmux.swaps).toHaveLength(1);
    expect(tmux.swaps[0]?.source).toBe(rootPaneId);
    expect(tmux.killedPanes).toContain(tab.paneId);

    const meta = await readWorktreeMeta(gitDir);
    expect(meta?.tabs?.map((entry) => entry.tabId)).toEqual(["root"]);
    expect(meta?.activeTabId).toBe("root");
  });

  it("rejects deleting the root tab", async () => {
    const repoRoot = await initRepo();
    const runtime = new ProjectRuntime();
    const tmux = new FakeTmuxGateway();
    const lifecycle = makeTabLifecycle(repoRoot, tmux, runtime);

    await lifecycle.createWorktree({ branch: "feature-root-del" });

    await expect(lifecycle.deleteWorktreeTab("feature-root-del", "root")).rejects.toMatchObject({
      status: 400,
      message: "The root tab cannot be deleted",
    });
  });

  it("rebuilds parked fork panes and re-activates the previous tab on reopen", async () => {
    const repoRoot = await initRepo();
    const runtime = new ProjectRuntime();
    const tmux = new FakeTmuxGateway();
    const lifecycle = makeTabLifecycle(repoRoot, tmux, runtime);

    await lifecycle.createWorktree({ branch: "feature-restore" });
    await lifecycle.createWorktreeTab("feature-restore");

    const session = buildProjectSessionName(repoRoot);
    const parkingWindow = buildWorktreeParkingWindowName("feature-restore");

    await lifecycle.closeWorktree("feature-restore");
    // Closing must tear down the parking window, not just the main agent window.
    expect(tmux.hasWindow(session, parkingWindow)).toBe(false);

    tmux.swaps.length = 0;
    await lifecycle.openWorktree("feature-restore");

    // The parking window is rebuilt and the previously active fork is restored on-screen.
    expect(tmux.hasWindow(session, parkingWindow)).toBe(true);
    const gitDir = new BunGitGateway().resolveWorktreeGitDir(join(repoRoot, "__worktrees", "feature-restore"));
    const meta = await readWorktreeMeta(gitDir);
    expect(meta?.activeTabId).toBe("fork-1");

    // The restore captures the visible-slot pane id once: the root tab's stored pane and the
    // swap destination must be the same value (a regression guard against a double read).
    expect(tmux.swaps).toHaveLength(1);
    const restoredRootPaneId = meta?.tabs?.find((entry) => entry.tabId === "root")?.paneId;
    if (!restoredRootPaneId) throw new Error("expected restored root pane id");
    expect(tmux.swaps[0]?.destination).toBe(restoredRootPaneId);
  });

  it("rebuilds parked fork panes when the codex agent terminal is refreshed", async () => {
    const repoRoot = await initRepo();
    const runtime = new ProjectRuntime();
    const tmux = new FakeTmuxGateway();
    // ensureRootSessionId + the pre-fork snapshot (calls 1-2) see only the root session;
    // once the fork pane is launched its session id becomes discoverable (call 3+), so a
    // Codex fork captures a non-null id and survives the restore on refresh.
    let listCalls = 0;
    const lifecycle = makeLifecycleService(
      repoRoot,
      tmux,
      runtime,
      new FakeDockerGateway(),
      new FakeHookRunner(),
      {
        ...TEST_CONFIG,
        workspace: { ...TEST_CONFIG.workspace, defaultAgent: "codex" },
        profiles: {
          ...TEST_CONFIG.profiles,
          default: { ...TEST_CONFIG.profiles.default, yolo: true },
        },
      },
      new BunGitGateway(),
      new FakeAutoNameService(),
      {},
      {
        listSessionIds: async () => {
          listCalls += 1;
          return listCalls <= 2 ? ["root-session"] : ["fork-session-1", "root-session"];
        },
      },
    );

    await lifecycle.createWorktree({ branch: "feature-codex-tab-refresh" });
    await lifecycle.createWorktreeTab("feature-codex-tab-refresh");

    const session = buildProjectSessionName(repoRoot);
    const parkingWindow = buildWorktreeParkingWindowName("feature-codex-tab-refresh");
    const gitDir = new BunGitGateway().resolveWorktreeGitDir(
      join(repoRoot, "__worktrees", "feature-codex-tab-refresh"),
    );

    const beforeMeta = await readWorktreeMeta(gitDir);
    if (!beforeMeta) throw new Error("expected worktree metadata");
    const rootPaneBefore = beforeMeta.tabs?.find((entry) => entry.tabId === "root")?.paneId;
    const forkPaneBefore = beforeMeta.tabs?.find((entry) => entry.tabId === "fork-1")?.paneId;
    if (!rootPaneBefore || !forkPaneBefore) throw new Error("expected pane ids after fork");

    await writeWorktreeMeta(gitDir, {
      ...beforeMeta,
      agentTerminalStale: true,
      conversation: {
        provider: "codexAppServer",
        conversationId: "thread-refresh",
        threadId: "thread-refresh",
        cwd: join(repoRoot, "__worktrees", "feature-codex-tab-refresh"),
        lastSeenAt: "2026-04-15T10:00:00.000Z",
      },
    });

    tmux.swaps.length = 0;
    tmux.commands.length = 0;
    await lifecycle.refreshAgentTerminal("feature-codex-tab-refresh");

    // The parking window is rebuilt from a clean slate — exactly one fork pane, not a
    // duplicate stacked on top of the pre-refresh pane.
    const parking = tmux.listWindows().find((window) => window.windowName === parkingWindow);
    expect(parking?.paneCount).toBe(1);
    // The fork's codex session is resumed into the rebuilt parked pane.
    expect(tmux.commands.some((entry) => entry.command.includes("resume 'fork-session-1'"))).toBe(true);

    const meta = await readWorktreeMeta(gitDir);
    expect(meta?.activeTabId).toBe("fork-1");
    const rootAfter = meta?.tabs?.find((entry) => entry.tabId === "root");
    const forkAfter = meta?.tabs?.find((entry) => entry.tabId === "fork-1");
    // Pane ids are recaptured: the window was recreated, so the stale pre-refresh ids in
    // meta would otherwise make a later swap target a dead pane.
    expect(rootAfter?.paneId).not.toBe(rootPaneBefore);
    expect(forkAfter?.paneId).not.toBe(forkPaneBefore);
    expect(forkAfter?.sessionId).toBe("fork-session-1");

    // The previously active fork is brought back on-screen, and a subsequent select against
    // the refreshed (live) pane ids resolves instead of throwing on a stale pane.
    expect(tmux.swaps.length).toBeGreaterThan(0);
    await lifecycle.selectWorktreeTab("feature-codex-tab-refresh", "root");
    expect((await readWorktreeMeta(gitDir))?.activeTabId).toBe("root");
  });

  it("kills the parking window when removing a worktree with fork tabs", async () => {
    const repoRoot = await initRepo();
    const runtime = new ProjectRuntime();
    const tmux = new FakeTmuxGateway();
    const lifecycle = makeTabLifecycle(repoRoot, tmux, runtime);

    await lifecycle.createWorktree({ branch: "feature-remove" });
    await lifecycle.createWorktreeTab("feature-remove");

    const session = buildProjectSessionName(repoRoot);
    expect(tmux.hasWindow(session, buildWorktreeParkingWindowName("feature-remove"))).toBe(true);

    await lifecycle.removeWorktree("feature-remove");

    // Both the main agent window and the parking window must be gone — no orphaned panes left
    // running against the deleted worktree directory.
    expect(tmux.listWindows()).toEqual([]);
  });
});
