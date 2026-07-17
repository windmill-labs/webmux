import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildProjectSessionName, buildWorktreeWindowName } from "../../backend/src/adapters/tmux";
import type { CreateLifecycleWorktreeInput, CreateLifecycleWorktreesInput } from "../../backend/src/services/lifecycle-service";
import {
  parseAddCommandArgs,
  parseBranchCommandArgs,
  parseLabelCommandArgs,
  parseListCommandArgs,
  parseSendCommandArgs,
  parseTabCommandArgs,
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
    async refreshAgentTerminal(branch: string): Promise<{ branch: string; worktreeId: string }> {
      calls.push({ method: "refreshAgentTerminal", value: branch });
      return { branch, worktreeId: "wt-3" };
    },
    async setWorktreeArchived(branch: string, archived: boolean): Promise<void> {
      calls.push({ method: "setWorktreeArchived", value: { branch, archived } });
    },
    async setWorktreeLabel(branch: string, label: string | null): Promise<{ label: string | null }> {
      calls.push({ method: "setWorktreeLabel", value: { branch, label } });
      return { label };
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
      fromLinearIssueId: null,
      branchExplicit: true,
    } satisfies ParsedAddCommand);
  });

  it("parses --existing flag", () => {
    expect(parseAddCommandArgs(["feature/search", "--existing"])).toEqual({
      input: { branch: "feature/search", mode: "existing" },
      detach: false,
      fromLinearIssueId: null,
      branchExplicit: true,
    });
  });

  it("parses --existing with other flags", () => {
    expect(parseAddCommandArgs(["feature/search", "--existing", "--agent", "claude", "--detach"])).toEqual({
      input: { branch: "feature/search", mode: "existing", agents: ["claude"] },
      detach: true,
      fromLinearIssueId: null,
      branchExplicit: true,
    });
  });

  it("parses --detach flag", () => {
    expect(parseAddCommandArgs(["feature/search", "--detach"])).toEqual({
      input: { branch: "feature/search" },
      detach: true,
      fromLinearIssueId: null,
      branchExplicit: true,
    });
  });

  it("parses -d shorthand", () => {
    expect(parseAddCommandArgs(["-d", "feature/search"])).toEqual({
      input: { branch: "feature/search" },
      detach: true,
      fromLinearIssueId: null,
      branchExplicit: true,
    });
  });

  it("parses repeated --agent flags", () => {
    expect(parseAddCommandArgs(["feature/search", "--agent=claude", "--agent", "gemini"])).toEqual({
      input: { branch: "feature/search", agents: ["claude", "gemini"] },
      detach: false,
      fromLinearIssueId: null,
      branchExplicit: true,
    });
  });

  it("rejects empty agent ids", () => {
    expect(() => parseAddCommandArgs(["feature/search", "--agent", "   "])).toThrow("Agent id cannot be empty");
  });

  it("returns null for help", () => {
    expect(parseAddCommandArgs(["--help"])).toBeNull();
  });

  it("parses --from-linear", () => {
    expect(parseAddCommandArgs(["--from-linear", "ENG-12"])).toEqual({
      input: {},
      detach: false,
      fromLinearIssueId: "ENG-12",
      branchExplicit: false,
    });
  });

  it("rejects malformed --from-linear values", () => {
    expect(() => parseAddCommandArgs(["--from-linear", "eng-1"]))
      .toThrow("--from-linear expects an issue id like ENG-123");
  });

  it("accepts --branch override alongside --from-linear", () => {
    const parsed = parseAddCommandArgs(["--from-linear", "ENG-12", "--branch", "feat/override"]);
    expect(parsed?.input.branch).toBe("feat/override");
    expect(parsed?.branchExplicit).toBe(true);
    expect(parsed?.fromLinearIssueId).toBe("ENG-12");
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

describe("parseTabCommandArgs", () => {
  it("defaults to the list action", () => {
    expect(parseTabCommandArgs(["feature"])).toEqual({ branch: "feature", action: "list" });
  });

  it("parses the new action", () => {
    expect(parseTabCommandArgs(["feature", "new"])).toEqual({ branch: "feature", action: "new" });
  });

  it("parses switch and close with a tab id", () => {
    expect(parseTabCommandArgs(["feature", "switch", "fork-2"])).toEqual({ branch: "feature", action: "switch", tabId: "fork-2" });
    expect(parseTabCommandArgs(["feature", "close", "fork-2"])).toEqual({ branch: "feature", action: "close", tabId: "fork-2" });
  });

  it("requires a tab id for switch and close", () => {
    expect(() => parseTabCommandArgs(["feature", "switch"])).toThrow("requires a <tabId>");
    expect(() => parseTabCommandArgs(["feature", "close"])).toThrow("requires a <tabId>");
  });

  it("rejects unknown actions and missing branch", () => {
    expect(() => parseTabCommandArgs(["feature", "bogus"])).toThrow("Unknown tab action");
    expect(() => parseTabCommandArgs([])).toThrow("Missing required argument");
  });

  it("returns null for help", () => {
    expect(parseTabCommandArgs(["--help"])).toBeNull();
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

describe("parseLabelCommandArgs", () => {
  it("parses branch and label text", () => {
    expect(parseLabelCommandArgs(["feature/search", "Search", "ranking"])).toEqual({
      branch: "feature/search",
      label: "Search ranking",
    });
  });

  it("parses --clear", () => {
    expect(parseLabelCommandArgs(["feature/search", "--clear"])).toEqual({
      branch: "feature/search",
      label: null,
    });
  });

  it("parses --label", () => {
    expect(parseLabelCommandArgs(["feature/search", "--label", "Search ranking"])).toEqual({
      branch: "feature/search",
      label: "Search ranking",
    });
  });

  it("returns null for help", () => {
    expect(parseLabelCommandArgs(["--help"])).toBeNull();
  });

  it("rejects --clear with label text", () => {
    expect(() => parseLabelCommandArgs(["feature/search", "--clear", "Search"])).toThrow("Cannot use --clear with a label");
  });

  it("rejects --label with positional label text", () => {
    expect(() => parseLabelCommandArgs(["feature/search", "--label", "Search", "extra"]))
      .toThrow("Cannot use --label with a positional label");
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

  it("passes the server-resolved project prefix to the runtime so control.env carries it", async () => {
    const { runtime } = makeRuntime();
    const createdWith: Array<{ prefix?: string }> = [];

    const exitCode = await runWorktreeCommand(
      {
        command: "add",
        args: ["feature/search", "--detach"],
        projectDir: "/repo",
        port: 5111,
      },
      {
        createRuntime: (options) => {
          createdWith.push({ prefix: options.prefix });
          return runtime;
        },
        resolveProjectPrefix: async () => "myproject",
        stdout: () => {},
        switchToTmuxWindow: () => {},
      },
    );

    expect(exitCode).toBe(0);
    expect(createdWith).toEqual([{ prefix: "myproject" }]);
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

  it("dispatches refresh through the lifecycle service", async () => {
    const { runtime, calls } = makeRuntime();
    const stdout: string[] = [];

    const exitCode = await runWorktreeCommand(
      {
        command: "refresh",
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
    expect(calls).toEqual([{ method: "refreshAgentTerminal", value: "feature/search" }]);
    expect(stdout).toEqual(["Refreshed agent terminal for feature/search"]);
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

  it("dispatches label updates through the lifecycle service", async () => {
    const { runtime, calls } = makeRuntime();
    const stdout: string[] = [];

    const exitCode = await runWorktreeCommand(
      {
        command: "label",
        args: ["feature/search", "Search", "ranking"],
        projectDir: "/repo",
        port: 5111,
      },
      {
        createRuntime: () => runtime,
        stdout: (message) => stdout.push(message),
      },
    );

    expect(exitCode).toBe(0);
    expect(calls).toEqual([{ method: "setWorktreeLabel", value: { branch: "feature/search", label: "Search ranking" } }]);
    expect(stdout).toEqual(['Labeled worktree feature/search as "Search ranking"']);
  });

  it("dispatches label clears through the lifecycle service", async () => {
    const { runtime, calls } = makeRuntime();
    const stdout: string[] = [];

    const exitCode = await runWorktreeCommand(
      {
        command: "label",
        args: ["feature/search", "--clear"],
        projectDir: "/repo",
        port: 5111,
      },
      {
        createRuntime: () => runtime,
        stdout: (message) => stdout.push(message),
      },
    );

    expect(exitCode).toBe(0);
    expect(calls).toEqual([{ method: "setWorktreeLabel", value: { branch: "feature/search", label: null } }]);
    expect(stdout).toEqual(["Cleared label for feature/search"]);
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

  it("prunes closed worktrees after confirmation", async () => {
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

  it("counts only closed worktrees toward the prune confirmation", async () => {
    const { runtime, calls } = makeRuntime();
    runtime.git = stubGit([
      { path: "/repo", branch: "main", bare: false },
      { path: "/repo/.worktrees/feature-search", branch: "feature/search", bare: false },
      { path: "/repo/.worktrees/feature-api", branch: "feature/api", bare: false },
    ]);
    runtime.tmux = stubTmux([
      { sessionName: buildProjectSessionName("/repo"), windowName: buildWorktreeWindowName("feature/api") },
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
    expect(confirmCalls).toEqual([1]);
    expect(calls).toEqual([{ method: "pruneWorktrees", value: null }]);
  });

  it("does not prune when every worktree is open", async () => {
    const { runtime, calls } = makeRuntime();
    runtime.git = stubGit([
      { path: "/repo", branch: "main", bare: false },
      { path: "/repo/.worktrees/feature-search", branch: "feature/search", bare: false },
    ]);
    runtime.tmux = stubTmux([
      { sessionName: buildProjectSessionName("/repo"), windowName: buildWorktreeWindowName("feature/search") },
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
        confirmPrune: async () => true,
        stdout: (message) => stdout.push(message),
      },
    );

    expect(exitCode).toBe(0);
    expect(calls).toEqual([]);
    expect(stdout).toEqual(["No closed worktrees to prune."]);
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
            async setWorktreeArchived(): Promise<void> {
              throw new Error("not used");
            },
            async setWorktreeLabel(): Promise<{ label: string | null }> {
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
    expect(stdout[0]).toContain("my-feature");
    expect(stdout[0]).toContain("open");
    expect(stdout[1]).toContain("fix-bug");
    expect(stdout[1]).toContain("closed");
  });

  it("lists and searches workspace labels", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "webmux-cli-labels-"));
    try {
      const projectDir = join(tempDir, "repo");
      const worktreePath = join(projectDir, ".worktrees", "random-name");
      const metaDir = join(worktreePath, ".git", "webmux");
      await mkdir(metaDir, { recursive: true });
      await Bun.write(join(metaDir, "meta.json"), JSON.stringify({
        schemaVersion: 1,
        worktreeId: "wt_random",
        branch: "random-name",
        label: "Search ranking",
        createdAt: "2026-05-12T00:00:00.000Z",
        profile: "default",
        agent: "codex",
        runtime: "host",
        startupEnvValues: {},
        allocatedPorts: {},
      }));
      const stdout: string[] = [];

      const exitCode = await runWorktreeCommand(
        { command: "list", args: ["--search", "ranking"], projectDir, port: 5111 },
        {
          createRuntime: () => ({
            projectDir,
            config: { workspace: { mainBranch: "main" } },
            git: stubGit([
              { path: projectDir, branch: "main", bare: false },
              { path: worktreePath, branch: "random-name", bare: false },
            ]),
            tmux: stubTmux(),
            lifecycleService: stubLifecycleService([]),
          }),
          stdout: (msg) => stdout.push(msg),
        },
      );

      expect(exitCode).toBe(0);
      expect(stdout).toHaveLength(1);
      expect(stdout[0]).toContain("Search ranking (random-name)");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
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
          resolveBaseUrl: async () => "http://localhost:5111/myproject",
          stdout: (msg) => stdout.push(msg),
        },
      );

      expect(exitCode).toBe(0);
      expect(stdout).toEqual(["Sent prompt to feature/search"]);
      expect(fetchCalls).toHaveLength(1);
      expect(fetchCalls[0].url).toBe("http://localhost:5111/myproject/api/worktrees/feature%2Fsearch/send");
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
          resolveBaseUrl: async () => "http://localhost:5111/myproject",
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
          resolveBaseUrl: async () => "http://localhost:9999/myproject",
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

describe("runWorktreeCommand restore", () => {
  const SESSION = buildProjectSessionName("/repo");

  function makeRestoreRuntime(options: {
    worktrees?: Array<{ path: string; branch: string | null; bare: boolean }>;
    windows?: Array<{ sessionName: string; windowName: string }>;
    openWorktree?: (branch: string) => Promise<{ branch: string; worktreeId: string }>;
  }) {
    const opened: string[] = [];
    return {
      opened,
      runtime: {
        projectDir: "/repo",
        config: { workspace: { mainBranch: "main" } },
        git: {
          listWorktrees: () => options.worktrees ?? [],
          resolveWorktreeGitDir: (cwd: string) => `${cwd}/.git`,
        },
        tmux: { listWindows: () => options.windows ?? [] },
        lifecycleService: {
          async openWorktree(branch: string): Promise<{ branch: string; worktreeId: string }> {
            if (options.openWorktree) return options.openWorktree(branch);
            opened.push(branch);
            return { branch, worktreeId: `wt-${branch}` };
          },
        },
      },
    };
  }

  it("re-opens saved sessions that are not already open", async () => {
    const { runtime, opened } = makeRestoreRuntime({
      worktrees: [
        { path: "/repo", branch: "main", bare: false },
        { path: "/repo/wt/feature-a", branch: "feature-a", bare: false },
        { path: "/repo/wt/feature-b", branch: "feature-b", bare: false },
      ],
      windows: [{ sessionName: SESSION, windowName: buildWorktreeWindowName("feature-b") }],
    });
    const stdout: string[] = [];
    const stderr: string[] = [];
    const switchCalls: Array<{ projectDir: string; branch: string }> = [];

    const exitCode = await runWorktreeCommand(
      { command: "restore", args: [], projectDir: "/repo", port: 5111 },
      {
        createRuntime: () => runtime,
        stdout: (m) => stdout.push(m),
        stderr: (m) => stderr.push(m),
        switchToTmuxWindow: (projectDir, branch) => switchCalls.push({ projectDir, branch }),
        readOpenSessions: async () => ({
          schemaVersion: 1,
          savedAt: "2026-06-27T12:00:00.000Z",
          branches: ["feature-a", "feature-b"],
        }),
      },
    );

    expect(exitCode).toBe(0);
    expect(opened).toEqual(["feature-a"]);
    expect(stdout).toEqual([
      "Restored feature-a",
      "Already open: feature-b",
      "Restored 1 session, skipped 1.",
    ]);
    expect(stderr).toEqual([]);
    expect(switchCalls).toEqual([{ projectDir: "/repo", branch: "feature-a" }]);
  });

  it("reports when there are no saved sessions", async () => {
    const { runtime } = makeRestoreRuntime({});
    const stdout: string[] = [];

    const exitCode = await runWorktreeCommand(
      { command: "restore", args: [], projectDir: "/repo", port: 5111 },
      {
        createRuntime: () => runtime,
        stdout: (m) => stdout.push(m),
        switchToTmuxWindow: () => {},
        readOpenSessions: async () => ({ schemaVersion: 1, savedAt: "", branches: [] }),
      },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toEqual(["No saved sessions to restore."]);
  });

  it("skips saved branches whose worktree no longer exists", async () => {
    const { runtime, opened } = makeRestoreRuntime({
      worktrees: [{ path: "/repo", branch: "main", bare: false }],
    });
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = await runWorktreeCommand(
      { command: "restore", args: [], projectDir: "/repo", port: 5111 },
      {
        createRuntime: () => runtime,
        stdout: (m) => stdout.push(m),
        stderr: (m) => stderr.push(m),
        switchToTmuxWindow: () => {},
        readOpenSessions: async () => ({ schemaVersion: 1, savedAt: "x", branches: ["gone"] }),
      },
    );

    expect(exitCode).toBe(0);
    expect(opened).toEqual([]);
    expect(stderr).toEqual(["Skipping gone: worktree no longer exists"]);
    expect(stdout).toEqual(["Restored 0 sessions, skipped 1."]);
  });

  it("returns exit code 1 and reports when a restore fails", async () => {
    const { runtime } = makeRestoreRuntime({
      worktrees: [
        { path: "/repo", branch: "main", bare: false },
        { path: "/repo/wt/feature-a", branch: "feature-a", bare: false },
      ],
      openWorktree: async (branch) => { throw new Error(`boom ${branch}`); },
    });
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = await runWorktreeCommand(
      { command: "restore", args: [], projectDir: "/repo", port: 5111 },
      {
        createRuntime: () => runtime,
        stdout: (m) => stdout.push(m),
        stderr: (m) => stderr.push(m),
        switchToTmuxWindow: () => {},
        readOpenSessions: async () => ({ schemaVersion: 1, savedAt: "x", branches: ["feature-a"] }),
      },
    );

    expect(exitCode).toBe(1);
    expect(stderr).toEqual(["Failed to restore feature-a: boom feature-a"]);
    expect(stdout).toEqual(["Restored 0 sessions, 1 failed."]);
  });

  it("prints restore help with --help", async () => {
    const stdout: string[] = [];
    const exitCode = await runWorktreeCommand(
      { command: "restore", args: ["--help"], projectDir: "/repo", port: 5111 },
      {
        createRuntime: () => { throw new Error("unexpected"); },
        stdout: (m) => stdout.push(m),
      },
    );

    expect(exitCode).toBe(0);
    expect(stdout[0]).toContain("webmux restore");
  });
});
