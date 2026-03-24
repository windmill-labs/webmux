import { render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import WorktreeList from "./WorktreeList.svelte";
import type { WorktreeInfo, WorktreeListRow } from "./types";

function createWorktree(branch: string): WorktreeInfo {
  return {
    branch,
    agent: "claude",
    mux: "✓",
    path: `/tmp/${branch}`,
    dir: `/tmp/${branch}`,
    dirty: false,
    unpushed: false,
    status: "running",
    elapsed: "1m",
    profile: null,
    agentName: null,
    services: [],
    paneCount: 1,
    prs: [],
    linearIssue: {
      identifier: "ENG-42",
      url: "https://linear.app/example/issue/ENG-42",
      state: {
        name: "In Progress",
        color: "#5e6ad2",
        type: "started",
      },
    },
    creating: false,
    creationPhase: null,
  };
}

function createRow(worktree: WorktreeInfo, depth = 0): WorktreeListRow {
  return { worktree, depth };
}

describe("WorktreeList", () => {
  it("renders the Linear badge as static text in the list", () => {
    render(WorktreeList, {
      props: {
        rows: [createRow(createWorktree("feature/list-linear"))],
        selected: null,
        removing: new Set<string>(),
        initializing: new Set<string>(),
        notifiedBranches: new Set<string>(),
        onselect: vi.fn(),
        onremove: vi.fn(),
      },
    });

    expect(screen.getByText("ENG-42")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "ENG-42" }),
    ).not.toBeInTheDocument();
  });
});
