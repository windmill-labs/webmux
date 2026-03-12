import { describe, expect, it } from "bun:test";
import { buildProjectSessionName, buildWorktreeWindowName } from "../../backend/src/adapters/tmux";
import type { CreateLifecycleWorktreeInput } from "../../backend/src/services/lifecycle-service";
import { parseAddCommandArgs, parseBranchCommandArgs, runWorktreeCommand } from "./worktree-commands";

function stubLifecycleService(calls: Array<{ method: string; value: unknown }>) {
  return {
    async createWorktree(input: CreateLifecycleWorktreeInput): Promise<{ branch: string; worktreeId: string }> {
      calls.push({ method: "createWorktree", value: input });
      return { branch: input.branch ?? "generated-branch", worktreeId: "wt-1" };
    },
    async openWorktree(branch: string): Promise<{ branch: string; worktreeId: string }> {
      calls.push({ method: "openWorktree", value: branch });
      return { branch, worktreeId: "wt-2" };
    },
    async closeWorktree(branch: string): Promise<void> {
      calls.push({ method: "closeWorktree", value: branch });
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
      "--profile",
      "sandbox",
      "--agent=codex",
      "--prompt",
      "Fix the search ranking",
      "--env",
      "FOO=bar",
      "--env=BAR=baz",
    ])).toEqual({
      branch: "feature/search",
      profile: "sandbox",
      agent: "codex",
      prompt: "Fix the search ranking",
      envOverrides: {
        FOO: "bar",
        BAR: "baz",
      },
    });
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

describe("runWorktreeCommand", () => {
  it("dispatches add through the lifecycle service and switches to tmux", async () => {
    const { runtime, calls } = makeRuntime();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const switchCalls: Array<{ projectDir: string; branch: string }> = [];

    const exitCode = await runWorktreeCommand(
      {
        command: "add",
        args: ["feature/search", "--agent", "codex", "--env", "FOO=bar"],
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
        method: "createWorktree",
        value: {
          branch: "feature/search",
          agent: "codex",
          envOverrides: { FOO: "bar" },
        },
      },
    ]);
    expect(stdout).toEqual(["Created worktree feature/search"]);
    expect(stderr).toEqual([]);
    expect(switchCalls).toEqual([{ projectDir: "/repo", branch: "feature/search" }]);
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
    expect(stdout).toEqual(["Usage:\n  webmux list"]);
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
});
