import { describe, expect, it } from "vitest";
import { buildWorktreeListRows, countArchivedMatches, filterWorktrees } from "./worktree-list";
import type { WorktreeInfo } from "./types";

function createWorktree(branch: string, overrides: Partial<WorktreeInfo> = {}): WorktreeInfo {
  return {
    branch,
    archived: false,
    agent: "waiting",
    mux: "",
    path: `/repo/__worktrees/${branch}`,
    dir: `/repo/__worktrees/${branch}`,
    dirty: false,
    unpushed: false,
    status: "idle",
    elapsed: "",
    profile: null,
    agentName: null,
    services: [],
    paneCount: 1,
    prs: [],
    linearIssue: null,
    creating: false,
    creationPhase: null,
    ...overrides,
  };
}

describe("buildWorktreeListRows", () => {
  it("nests child worktrees under their base worktree when it exists", () => {
    const rows = buildWorktreeListRows([
      createWorktree("feature/base"),
      createWorktree("feature/child-a", { baseBranch: "feature/base" }),
      createWorktree("feature/grandchild", { baseBranch: "feature/child-a" }),
      createWorktree("feature/child-b", { baseBranch: "feature/base" }),
    ]);

    expect(rows.map((row) => [row.worktree.branch, row.depth])).toEqual([
      ["feature/base", 0],
      ["feature/child-a", 1],
      ["feature/grandchild", 2],
      ["feature/child-b", 1],
    ]);
  });

  it("keeps a worktree at the top level when its base worktree is not visible", () => {
    const rows = buildWorktreeListRows([
      createWorktree("feature/child", { baseBranch: "feature/missing-base" }),
      createWorktree("feature/other"),
    ]);

    expect(rows.map((row) => [row.worktree.branch, row.depth])).toEqual([
      ["feature/child", 0],
      ["feature/other", 0],
    ]);
  });

  it("filters archived worktrees out by default and matches profile text", () => {
    const worktrees = filterWorktrees([
      createWorktree("feature/active", { profile: "sandbox" }),
      createWorktree("feature/archived", { archived: true, profile: "default" }),
    ], {
      query: "sand",
      showArchived: false,
    });

    expect(worktrees.map((worktree) => worktree.branch)).toEqual(["feature/active"]);
  });

  it("counts archived matches separately from visible rows", () => {
    const count = countArchivedMatches([
      createWorktree("feature/alpha", { archived: true }),
      createWorktree("feature/beta", { archived: true }),
      createWorktree("feature/gamma"),
    ], "beta");

    expect(count).toBe(1);
  });
});
