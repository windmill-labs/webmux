import { describe, expect, it, spyOn } from "bun:test";
import { extractBranches, handleCompletions, listWorktreeBranches, runCompletionCommand } from "./completions";

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
    const spy = spyOn(console, "log").mockImplementation(() => {});
    handleCompletions(["add"]);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("runCompletionCommand", () => {
  it("prints usage for --help", () => {
    const spy = spyOn(console, "log").mockImplementation(() => {});
    const code = runCompletionCommand(["--help"]);
    expect(code).toBe(0);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("Usage:"));
    spy.mockRestore();
  });

  it("rejects unknown shells", () => {
    const spy = spyOn(console, "error").mockImplementation(() => {});
    const code = runCompletionCommand(["fish"]);
    expect(code).toBe(1);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("Unknown shell"));
    spy.mockRestore();
  });

  it("outputs zsh completion script", () => {
    const spy = spyOn(console, "log").mockImplementation(() => {});
    const code = runCompletionCommand(["zsh"]);
    expect(code).toBe(0);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("#compdef webmux"));
    spy.mockRestore();
  });

  it("outputs bash completion script", () => {
    const spy = spyOn(console, "log").mockImplementation(() => {});
    const code = runCompletionCommand(["bash"]);
    expect(code).toBe(0);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("complete -F _webmux webmux"));
    spy.mockRestore();
  });
});
