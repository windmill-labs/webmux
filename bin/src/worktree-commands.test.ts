import { afterEach, describe, expect, it } from "bun:test";
import { buildProjectSessionName, buildWorktreeWindowName } from "../../backend/src/adapters/tmux";
import type { CreateLifecycleWorktreeInput, CreateLifecycleWorktreesInput } from "../../backend/src/services/lifecycle-service";
import {
  parseAddCommandArgs,
  parseBranchCommandArgs,
  parseListCommandArgs,
  parseSendCommandArgs,
  runWorktreeCommand,
  type ParsedAddCommand,
  type ParsedSendCommand,
} from "./worktree-commands";

function stubLifecycleService(calls: Array<{ method: string; value: unknown }>) {
  return {
    async createWorktree(input: CreateLifecycleWorktreeInput): Promise<{ branch: string; worktreeId: string }> {
      calls.push({ method: "createWorktree", value: input });
      return { branch: input.branch ?? "generated-branch", worktreeId: "wt-1" };
    },
    async createWorktrees(input: CreateLifecycleWorktreesInput): Promise<{ primaryBranch: string; branches: string[] }> {
      calls.push({ method: "createWorktrees", value: input });
      const branch = input.branch ?? "generated-branch";
      const selectedAgents = input.agents ?? (input.agent ? [input.agent] : ["claude"]);
      const branches = selectedAgents.length > 1
        ? selectedAgents.map((agent) => `${agent}/${branch}`)
        : [branch];
      return { primaryBranch: branches[0] ?? branch, branches };
    },
    async openWorktree(branch: string): Promise<{ branch: string; worktreeId: string }> {
      calls.push({ method: "openWorktree", value: branch });
      return { branch, worktreeId: "wt-2" };
    },
    async closeWorktree(branch: string): Promise<void> {
      calls.push({ method: "closeWorktree", value: branch });
    },
    async setWorktreeArchived(branch: string, archived: boolean): Promise<void> {
      calls.push({ method: "setWorktreeArchived", value: { branch, archived } });
    },
    async removeWorktree(branch: string): Promise<void> {
      calls.push({ method: "removeWorktree", value: branch });
    },
    async mergeWorktree(branch: string): Promise<void> {
      calls.push({ method: "mergeWorktree", value: branch });
    },
    async pruneWorktrees(): Promise<{ removedBranches: string[] }> {
      calls.push({ method: "pruneWorktrees", value: null });
      return { removedBranches: ["feature/search", "feature/api"] };
    },
  };
}

function stubGit(worktrees: Array<{ path: string; branch: string | null; bare: boolean }> = []) {
  return {
    listWorktrees: () => worktrees,
    resolveWorktreeGitDir: (cwd: string) => `${cwd}/.git`,
  };
}

function stubTmux(windows: Array<{ sessionName: string; windowName: string }> = []) {
  return { listWindows: () => windows };
}

function makeRuntime() {
  const calls: Array<{ method: string; value: unknown }> = [];

  return {
    calls,
    runtime: {
      projectDir: "/repo",
      config: {
        workspace: {
          mainBranch: "develop",
        },
      },
      git: stubGit(),
      tmux: stubTmux(),
      lifecycleService: stubLifecycleService(calls),
    },
  };
}

describe("parseAddCommandArgs", () => {
  it("parses the CLI add contract into lifecycle input", () => {
    expect(parseAddCommandArgs([
      "feature/search",
      "--base",
      "release/2026.03",
      "--profile",
      "sandbox",
      "--agent=codex",
      "--prompt",
      "Fix the search ranking",
      "--env",
      "FOO=bar",
      "--env=BAR=baz",
    ])).toEqual({
      input: {
        branch: "feature/search",
        baseBranch: "release/2026.03",
        profile: "sandbox",
        agents: ["codex"],
        prompt: "Fix the search ranking",
        envOverrides: {
          FOO: "bar",
          BAR: "baz",
        },
      },
      detach: false,
    } satisfies ParsedAddCommand);
  });

  it("parses --existing flag", () => {
    expect(parseAddCommandArgs(["feature/search", "--existing"])).toEqual({
      input: { branch: "feature/search", mode: "existing" },
      detach: false,
    });
  });

  it("parses --existing with other flags", () => {
    expect(parseAddCommandArgs(["feature/search", "--existing", "--agent", "claude", "--detach"])).toEqual({
      input: { branch: "feature/search", mode: "existing", agents: ["claude"] },
      detach: true,
    });
  });

  it("parses --detach flag", () => {
    expect(parseAddCommandArgs(["feature/search", "--detach"])).toEqual({
      input: { branch: "feature/search" },
      detach: true,
    });
  });

  it("parses -d shorthand", () => {
    expect(parseAddCommandArgs(["-d", "feature/search"])).toEqual({
      input: { branch: "feature/search" },
      detach: true,
    });
  });

  it("parses repeated --agent flags", () => {
    expect(parseAddCommandArgs(["feature/search", "--agent=claude", "--agent", "gemini"])).toEqual({
      input: { branch: "feature/search", agents: ["claude", "gemini"] },
      detach: false,
    });
  });

  it("rejects empty agent ids", () => {
    expect(() => parseAddCommandArgs(["feature/search", "--agent", "   "])).toThrow("Agent id cannot be empty");
  });

  it("returns null for help", () => {
    expect(parseAddCommandArgs(["--help"])).toBeNull();
  });
});

describe("parseBranchCommandArgs", () => {
  it("parses the required branch argument", () => {
    expect(parseBranchCommandArgs(["feature/search"])).toBe("feature/search");
  });

  it("returns null for help", () => {
    expect(parseBranchCommandArgs(["--help"])).toBeNull();
  });

  it("rejects invalid worktree names", () => {
    expect(() => parseBranchCommandArgs(["feature..search"])).toThrow("Invalid worktree name");
  });
});

describe("parseListCommandArgs", () => {
  it("parses list filters", () => {
    expect(parseListCommandArgs(["--all", "--search", "search"])).toEqual({
      mode: "all",
      search: "search",
    });
  });

  it("returns null for help", () => {
    expect(parseListCommandArgs(["--help"])).toBeNull();
  });

  it("rejects conflicting archive filters", () => {
    expect(() => parseListCommandArgs(["--all", "--archived"])).toThrow("Cannot use --archived with --all");
  });
});

describe("parseSendCommandArgs", () => {
  it("parses positional branch and prompt", () => {
    expect(parseSendCommandArgs(["feature/search", "Fix the bug"])).toEqual({
      branch: "feature/search",
      text: "Fix the bug",
    } satisfies ParsedSendCommand);
  });

  it("parses --prompt flag instead of positional", () => {
    expect(parseSendCommandArgs(["feature/search", "--prompt", "Fix the bug"])).toEqual({
      branch: "feature/search",
      text: "Fix the bug",
    });
  });

  it("parses --preamble flag", () => {
    expect(parseSendCommandArgs(["feature/search", "Fix the bug", "--preamble", "You are a helpful assistant"])).toEqual({
      branch: "feature/search",
      text: "Fix the bug",
      preamble: "You are a helpful assistant",
    });
  });

  it("returns null for help", () => {
    expect(parseSendCommandArgs(["--help"])).toBeNull();
  });

  it("throws on missing branch", () => {
    expect(() => parseSendCommandArgs([])).toThrow("Missing required argument: <branch>");
  });

  it("throws on missing prompt", () => {
    expect(() => parseSendCommandArgs(["feature/search"])).toThrow("Missing required argument: <prompt>");
  });

  it("throws on invalid branch name", () => {
    expect(() => parseSendCommandArgs(["feature..search", "Fix it"])).toThrow("Invalid worktree name");
  });

  it("rejects --prompt when positional prompt is already set", () => {
    expect(() => parseSendCommandArgs(["feature/search", "Fix the bug", "--prompt", "other"])).toThrow("Cannot use --prompt with a positional prompt argument");
  });
});

describe("runWorktreeCommand", () => {
  it("dispatches add through the lifecycle service and switches to tmux", async () => {
    const { runtime, calls } = makeRuntime();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const switchCalls: Array<{ projectDir: string; branch: string }> = [];

    const exitCode = await runWorktreeCommand(
      {
        command: "add",
        args: ["feature/search", "--base", "release/base", "--agent", "codex", "--env", "FOO=bar"],
        projectDir: "/repo",
        port: 5111,
      },
      {
        createRuntime: () => runtime,
        stdout: (message) => stdout.push(message),
        stderr: (message) => stderr.push(message),
        switchToTmuxWindow: (projectDir, branch) => switchCalls.push({ projectDir, branch }),
      },
    );

    expect(exitCode).toBe(0);
    expect(calls).toEqual([
      {
        method: "createWorktrees",
        value: {
          branch: "feature/search",
          baseBranch: "release/base",
          agents: ["codex"],
          envOverrides: { FOO: "bar" },
        },
      },
    ]);
    expect(stdout).toEqual(["Created worktree feature/search"]);
    expect(stderr).toEqual([]);
    expect(switchCalls).toEqual([{ projectDir: "/repo", branch: "feature/search" }]);
  });

  it("dispatches add --existing with mode existing", async () => {
    const { runtime, calls } = makeRuntime();
    const stdout: string[] = [];

    const exitCode = await runWorktreeCommand(
      {
        command: "add",
        args: ["feature/remote-branch", "--existing"],
        projectDir: "/repo",
        port: 5111,
      },
      {
        createRuntime: () => runtime,
        stdout: (message) => stdout.push(message),
        switchToTmuxWindow: () => {},
      },
    );

    expect(exitCode).toBe(0);
    expect(calls).toEqual([
      {
        method: "createWorktrees",
        value: {
          branch: "feature/remote-branch",
          mode: "existing",
        },
      },
    ]);
    expect(stdout).toEqual(["Created worktree feature/remote-branch"]);
  });

  it("skips tmux switch when --detach is passed to add", async () => {
    const { runtime } = makeRuntime();
    const stdout: string[] = [];
    const switchCalls: Array<{ projectDir: string; branch: string }> = [];

    const exitCode = await runWorktreeCommand(
      {
        command: "add",
        args: ["feature/search", "--detach"],
        projectDir: "/repo",
        port: 5111,
      },
      {
        createRuntime: () => runtime,
        stdout: (message) => stdout.push(message),
        switchToTmuxWindow: (projectDir, branch) => switchCalls.push({ projectDir, branch }),
      },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toEqual(["Created worktree feature/search"]);
    expect(switchCalls).toEqual([]);
  });

  it("dispatches repeated --agent flags through createWorktrees and switches to primary branch", async () => {
    const { runtime, calls } = makeRuntime();
    const stdout: string[] = [];
    const switchCalls: Array<{ projectDir: string; branch: string }> = [];

    const exitCode = await runWorktreeCommand(
      {
        command: "add",
        args: ["feature/search", "--agent=claude", "--agent=codex"],
        projectDir: "/repo",
        port: 5111,
      },
      {
        createRuntime: () => runtime,
        stdout: (message) => stdout.push(message),
        switchToTmuxWindow: (projectDir, branch) => switchCalls.push({ projectDir, branch }),
      },
    );

    expect(exitCode).toBe(0);
    expect(calls).toEqual([
      {
        method: "createWorktrees",
        value: {
          branch: "feature/search",
          agents: ["claude", "codex"],
        },
      },
    ]);
    expect(stdout).toEqual([
      "Created worktree claude/feature/search",
      "Created worktree codex/feature/search",
    ]);
    expect(switchCalls).toEqual([{ projectDir: "/repo", branch: "claude/feature/search" }]);
  });

  it("dispatches open through the lifecycle service and switches to tmux", async () => {
    const { runtime, calls } = makeRuntime();
    const stdout: string[] = [];
    const switchCalls: Array<{ projectDir: string; branch: string }> = [];

    const exitCode = await runWorktreeCommand(
      {
        command: "open",
        args: ["feature/search"],
        projectDir: "/repo",
        port: 5111,
      },
      {
        createRuntime: () => runtime,
        stdout: (message) => stdout.push(message),
        switchToTmuxWindow: (projectDir, branch) => switchCalls.push({ projectDir, branch }),
      },
    );

    expect(exitCode).toBe(0);
    expect(calls).toEqual([{ method: "openWorktree", value: "feature/search" }]);
    expect(stdout).toEqual(["Opened worktree feature/search"]);
    expect(switchCalls).toEqual([{ projectDir: "/repo", branch: "feature/search" }]);
  });

  it("dispatches archive through the lifecycle service", async () => {
    const { runtime, calls } = makeRuntime();
    const stdout: string[] = [];

    const exitCode = await runWorktreeCommand(
      {
        command: "archive",
        args: ["feature/search"],
        projectDir: "/repo",
        port: 5111,
      },
      {
        createRuntime: () => runtime,
        stdout: (message) => stdout.push(message),
      },
    );

    expect(exitCode).toBe(0);
    expect(calls).toEqual([{ method: "setWorktreeArchived", value: { branch: "feature/search", archived: true } }]);
    expect(stdout).toEqual(["Archived worktree feature/search"]);
  });

  it("prints subcommand help without creating a runtime", async () => {
    let createRuntimeCalled = false;
    const stdout: string[] = [];

    const exitCode = await runWorktreeCommand(
      {
        command: "merge",
        args: ["--help"],
        projectDir: "/repo",
        port: 5111,
      },
      {
        createRuntime: () => {
          createRuntimeCalled = true;
          throw new Error("unexpected");
        },
        stdout: (message) => stdout.push(message),
      },
    );

    expect(exitCode).toBe(0);
    expect(createRuntimeCalled).toBe(false);
    expect(stdout).toEqual(["Usage:\n  webmux merge <branch>"]);
  });

  it("prints the configured merge target on success", async () => {
    const { runtime, calls } = makeRuntime();
    const stdout: string[] = [];

    const exitCode = await runWorktreeCommand(
      {
        command: "merge",
        args: ["feature/search"],
        projectDir: "/repo",
        port: 5111,
      },
      {
        createRuntime: () => runtime,
        stdout: (message) => stdout.push(message),
      },
    );

    expect(exitCode).toBe(0);
    expect(calls).toEqual([{ method: "mergeWorktree", value: "feature/search" }]);
    expect(stdout).toEqual(["Merged feature/search into develop"]);
  });

  it("prunes all worktrees after confirmation", async () => {
    const { runtime, calls } = makeRuntime();
    runtime.git = stubGit([
      { path: "/repo", branch: "main", bare: false },
      { path: "/repo/.worktrees/feature-search", branch: "feature/search", bare: false },
      { path: "/repo/.worktrees/feature-api", branch: "feature/api", bare: false },
    ]);
    const stdout: string[] = [];
    const confirmCalls: number[] = [];

    const exitCode = await runWorktreeCommand(
      {
        command: "prune",
        args: [],
        projectDir: "/repo",
        port: 5111,
      },
      {
        createRuntime: () => runtime,
        confirmPrune: async (count) => {
          confirmCalls.push(count);
          return true;
        },
        stdout: (message) => stdout.push(message),
      },
    );

    expect(exitCode).toBe(0);
    expect(confirmCalls).toEqual([2]);
    expect(calls).toEqual([{ method: "pruneWorktrees", value: null }]);
    expect(stdout).toEqual(["Pruned 2 worktrees: feature/search, feature/api"]);
  });

  it("aborts prune when confirmation is declined", async () => {
    const { runtime, calls } = makeRuntime();
    runtime.git = stubGit([
      { path: "/repo", branch: "main", bare: false },
      { path: "/repo/.worktrees/feature-search", branch: "feature/search", bare: false },
    ]);
    const stdout: string[] = [];

    const exitCode = await runWorktreeCommand(
      {
        command: "prune",
        args: [],
        projectDir: "/repo",
        port: 5111,
      },
      {
        createRuntime: () => runtime,
        confirmPrune: async () => false,
        stdout: (message) => stdout.push(message),
      },
    );

    expect(exitCode).toBe(0);
    expect(calls).toEqual([]);
    expect(stdout).toEqual(["Aborted."]);
  });

  it("returns a failing exit code when lifecycle execution fails", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = await runWorktreeCommand(
      {
        command: "remove",
        args: ["feature/search"],
        projectDir: "/repo",
        port: 5111,
      },
      {
        createRuntime: () => ({
          projectDir: "/repo",
          config: {
            workspace: {
              mainBranch: "main",
            },
          },
          git: stubGit(),
          tmux: stubTmux(),
          lifecycleService: {
            async createWorktree(): Promise<{ branch: string; worktreeId: string }> {
              throw new Error("not used");
            },
            async createWorktrees(): Promise<{ primaryBranch: string; branches: string[] }> {
              throw new Error("not used");
            },
            async openWorktree(): Promise<{ branch: string; worktreeId: string }> {
              throw new Error("not used");
            },
            async closeWorktree(): Promise<void> {
              throw new Error("not used");
            },
            async removeWorktree(): Promise<void> {
              throw new Error("Worktree has uncommitted changes: feature/search");
            },
            async mergeWorktree(): Promise<void> {
              throw new Error("not used");
            },
            async pruneWorktrees(): Promise<{ removedBranches: string[] }> {
              throw new Error("not used");
            },
          },
        }),
        stdout: (message) => stdout.push(message),
        stderr: (message) => stderr.push(message),
      },
    );

    expect(exitCode).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr).toEqual(["Error: Worktree has uncommitted changes: feature/search"]);
  });

  it("rejects invalid branch arguments before creating a runtime", async () => {
    let createRuntimeCalled = false;
    const stderr: string[] = [];

    const exitCode = await runWorktreeCommand(
      {
        command: "open",
        args: ["feature..search"],
        projectDir: "/repo",
        port: 5111,
      },
      {
        createRuntime: () => {
          createRuntimeCalled = true;
          throw new Error("unexpected");
        },
        stderr: (message) => stderr.push(message),
      },
    );

    expect(exitCode).toBe(1);
    expect(createRuntimeCalled).toBe(false);
    expect(stderr).toEqual(["Error: Invalid worktree name"]);
  });

  it("lists worktrees with open/closed status", async () => {
    const sessionName = buildProjectSessionName("/repo");
    const stdout: string[] = [];

    const exitCode = await runWorktreeCommand(
      { command: "list", args: [], projectDir: "/repo", port: 5111 },
      {
        createRuntime: () => ({
          projectDir: "/repo",
          config: { workspace: { mainBranch: "main" } },
          git: stubGit([
            { path: "/repo", branch: "main", bare: false },
            { path: "/repo/.worktrees/fix-bug", branch: "fix-bug", bare: false },
            { path: "/repo/.worktrees/my-feature", branch: "my-feature", bare: false },
          ]),
          tmux: stubTmux([
            { sessionName, windowName: buildWorktreeWindowName("my-feature") },
          ]),
          lifecycleService: stubLifecycleService([]),
        }),
        stdout: (msg) => stdout.push(msg),
      },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toHaveLength(2);
    expect(stdout[0]).toContain("fix-bug");
    expect(stdout[0]).toContain("closed");
    expect(stdout[1]).toContain("my-feature");
    expect(stdout[1]).toContain("open");
  });

  it("prints empty message when no worktrees exist", async () => {
    const stdout: string[] = [];

    const exitCode = await runWorktreeCommand(
      { command: "list", args: [], projectDir: "/repo", port: 5111 },
      {
        createRuntime: () => ({
          projectDir: "/repo",
          config: { workspace: { mainBranch: "main" } },
          git: stubGit([{ path: "/repo", branch: "main", bare: false }]),
          tmux: stubTmux(),
          lifecycleService: stubLifecycleService([]),
        }),
        stdout: (msg) => stdout.push(msg),
      },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toEqual(["No worktrees found."]);
  });

  it("prints list help without creating a runtime", async () => {
    let createRuntimeCalled = false;
    const stdout: string[] = [];

    const exitCode = await runWorktreeCommand(
      { command: "list", args: ["--help"], projectDir: "/repo", port: 5111 },
      {
        createRuntime: () => {
          createRuntimeCalled = true;
          throw new Error("unexpected");
        },
        stdout: (msg) => stdout.push(msg),
      },
    );

    expect(exitCode).toBe(0);
    expect(createRuntimeCalled).toBe(false);
    expect(stdout).toHaveLength(1);
    expect(stdout[0]).toContain("webmux list [--all|--archived] [--search <text>]");
  });

  it("prints prune help without creating a runtime", async () => {
    let createRuntimeCalled = false;
    const stdout: string[] = [];

    const exitCode = await runWorktreeCommand(
      { command: "prune", args: ["--help"], projectDir: "/repo", port: 5111 },
      {
        createRuntime: () => {
          createRuntimeCalled = true;
          throw new Error("unexpected");
        },
        stdout: (msg) => stdout.push(msg),
      },
    );

    expect(exitCode).toBe(0);
    expect(createRuntimeCalled).toBe(false);
    expect(stdout).toEqual(["Usage:\n  webmux prune"]);
  });

  describe("send", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("sends the correct HTTP request to the server", async () => {
      const fetchCalls: Array<{ url: string; init: RequestInit }> = [];
      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        fetchCalls.push({ url: String(input), init: init! });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as typeof fetch;

      const stdout: string[] = [];
      const exitCode = await runWorktreeCommand(
        {
          command: "send",
          args: ["feature/search", "Fix the bug", "--preamble", "Be concise"],
          projectDir: "/repo",
          port: 5111,
        },
        {
          createRuntime: () => { throw new Error("unexpected"); },
          stdout: (msg) => stdout.push(msg),
        },
      );

      expect(exitCode).toBe(0);
      expect(stdout).toEqual(["Sent prompt to feature/search"]);
      expect(fetchCalls).toHaveLength(1);
      expect(fetchCalls[0].url).toBe("http://localhost:5111/api/worktrees/feature%2Fsearch/send");
      expect(fetchCalls[0].init.method).toBe("POST");
      expect(JSON.parse(fetchCalls[0].init.body as string)).toEqual({
        text: "Fix the bug",
        preamble: "Be concise",
      });
    });

    it("reports server errors with the error message", async () => {
      globalThis.fetch = (async () => {
        return new Response(JSON.stringify({ error: "Worktree not found: no-such" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch;

      const stderr: string[] = [];
      const exitCode = await runWorktreeCommand(
        {
          command: "send",
          args: ["no-such", "Fix it"],
          projectDir: "/repo",
          port: 5111,
        },
        {
          createRuntime: () => { throw new Error("unexpected"); },
          stderr: (msg) => stderr.push(msg),
        },
      );

      expect(exitCode).toBe(1);
      expect(stderr).toEqual(["Error: Worktree not found: no-such"]);
    });

    it("shows a friendly message when the server is unreachable", async () => {
      globalThis.fetch = (async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch;

      const stderr: string[] = [];
      const exitCode = await runWorktreeCommand(
        {
          command: "send",
          args: ["feature/search", "Fix it"],
          projectDir: "/repo",
          port: 9999,
        },
        {
          createRuntime: () => { throw new Error("unexpected"); },
          stderr: (msg) => stderr.push(msg),
        },
      );

      expect(exitCode).toBe(1);
      expect(stderr).toEqual(["Error: Could not connect to webmux server on port 9999. Is it running?"]);
    });

    it("prints send help without making a request", async () => {
      let fetchCalled = false;
      globalThis.fetch = (async () => {
        fetchCalled = true;
        return new Response("", { status: 200 });
      }) as typeof fetch;

      const stdout: string[] = [];
      const exitCode = await runWorktreeCommand(
        {
          command: "send",
          args: ["--help"],
          projectDir: "/repo",
          port: 5111,
        },
        {
          createRuntime: () => { throw new Error("unexpected"); },
          stdout: (msg) => stdout.push(msg),
        },
      );

      expect(exitCode).toBe(0);
      expect(fetchCalled).toBe(false);
      expect(stdout[0]).toContain("webmux send");
    });
  });
});
