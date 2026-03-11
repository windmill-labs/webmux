import { describe, expect, it } from "bun:test";
import { extractBranches, filterBranches, handleCompletions, listWorktreeBranches, runCompletionCommand } from "./completions";

describe("extractBranches", () => {
  const porcelain = [
    "worktree /repo",
    "HEAD abc123",
    "branch refs/heads/main",
    "",
    "worktree /repo/.worktrees/fix-bug",
    "HEAD def456",
    "branch refs/heads/fix-bug",
    "",
    "worktree /repo/.worktrees/feature-auth",
    "HEAD 789abc",
    "branch refs/heads/feature-auth",
    "",
  ].join("\n");

  it("returns non-main, non-bare branches", () => {
    expect(extractBranches(porcelain, "/repo")).toEqual([
      "fix-bug",
      "feature-auth",
    ]);
  });

  it("returns all branches when mainWorktreePath is null", () => {
    expect(extractBranches(porcelain, null)).toEqual([
      "main",
      "fix-bug",
      "feature-auth",
    ]);
  });

  it("falls back to basename when branch is missing", () => {
    const detached = [
      "worktree /repo",
      "HEAD abc123",
      "branch refs/heads/main",
      "",
      "worktree /repo/.worktrees/orphan-wt",
      "HEAD def456",
      "detached",
      "",
    ].join("\n");

    expect(extractBranches(detached, "/repo")).toEqual(["orphan-wt"]);
  });
});

describe("filterBranches", () => {
  const branches = ["fix-bug", "feature-auth", "feature-search"];

  it("returns all branches when partial is empty", () => {
    expect(filterBranches(branches, "")).toEqual(branches);
  });

  it("filters by prefix", () => {
    expect(filterBranches(branches, "feature")).toEqual([
      "feature-auth",
      "feature-search",
    ]);
  });

  it("returns empty when no match", () => {
    expect(filterBranches(branches, "xyz")).toEqual([]);
  });
});

describe("listWorktreeBranches", () => {
  it("returns branches using injected git", () => {
    const porcelain = [
      "worktree /repo",
      "HEAD abc123",
      "branch refs/heads/main",
      "",
      "worktree /repo/.worktrees/fix-bug",
      "HEAD def456",
      "branch refs/heads/fix-bug",
      "",
    ].join("\n");

    const branches = listWorktreeBranches({
      runGit: (args: string[]) => {
        if (args[0] === "worktree") {
          return { exitCode: 0, stdout: porcelain };
        }
        if (args[0] === "rev-parse") {
          return { exitCode: 0, stdout: "/repo/.git" };
        }
        return { exitCode: 1, stdout: "" };
      },
    });

    expect(branches).toEqual(["fix-bug"]);
  });

  it("returns empty array when git fails", () => {
    const branches = listWorktreeBranches({
      runGit: () => ({ exitCode: 1, stdout: "" }),
    });

    expect(branches).toEqual([]);
  });
});

describe("handleCompletions", () => {
  it("outputs nothing for unknown subcommands", () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (msg: string) => logs.push(msg);

    handleCompletions(["add"]);

    console.log = originalLog;
    expect(logs).toEqual([]);
  });
});

describe("runCompletionCommand", () => {
  it("prints usage for --help", () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (msg: string) => logs.push(msg);

    const code = runCompletionCommand(["--help"]);

    console.log = originalLog;
    expect(code).toBe(0);
    expect(logs[0]).toContain("Usage:");
  });

  it("rejects unknown shells", () => {
    const errors: string[] = [];
    const originalError = console.error;
    console.error = (msg: string) => errors.push(msg);

    const code = runCompletionCommand(["fish"]);

    console.error = originalError;
    expect(code).toBe(1);
    expect(errors[0]).toContain("Unknown shell");
  });

  it("outputs zsh completion script", () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (msg: string) => logs.push(msg);

    const code = runCompletionCommand(["zsh"]);

    console.log = originalLog;
    expect(code).toBe(0);
    expect(logs[0]).toContain("#compdef webmux");
    expect(logs[0]).toContain("_webmux");
  });

  it("outputs bash completion script", () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (msg: string) => logs.push(msg);

    const code = runCompletionCommand(["bash"]);

    console.log = originalLog;
    expect(code).toBe(0);
    expect(logs[0]).toContain("complete -F _webmux webmux");
  });
});
