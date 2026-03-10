import { describe, expect, it } from "bun:test";
import type { CreateLifecycleWorktreeInput } from "../../backend/src/services/lifecycle-service";
import { parseAddCommandArgs, parseBranchCommandArgs, runWorktreeCommand } from "./worktree-commands";

function makeRuntime() {
  const calls: Array<{ method: string; value: unknown }> = [];

  return {
    calls,
    runtime: {
      config: {
        workspace: {
          mainBranch: "develop",
        },
      },
      lifecycleService: {
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
      },
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
  it("dispatches add through the lifecycle service", async () => {
    const { runtime, calls } = makeRuntime();
    const stdout: string[] = [];
    const stderr: string[] = [];

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
          config: {
            workspace: {
              mainBranch: "main",
            },
          },
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
});
