import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import WorktreeList from "./WorktreeList.svelte";
import type { WorktreeInfo, WorktreeListRow } from "./types";

function createWorktree(branch: string): WorktreeInfo {
  return {
    branch,
    archived: false,
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
        archiving: new Set<string>(),
        notifiedBranches: new Set<string>(),
        onselect: vi.fn(),
        onclose: vi.fn(),
        onarchive: vi.fn(),
        onmerge: vi.fn(),
        onremove: vi.fn(),
      },
    });

    expect(screen.getByText("ENG-42")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "ENG-42" }),
    ).not.toBeInTheDocument();
  });

  it("shows a three-dot menu with row actions", async () => {
    const onarchive = vi.fn();

    render(WorktreeList, {
      props: {
        rows: [createRow(createWorktree("feature/menu-actions"))],
        selected: null,
        removing: new Set<string>(),
        initializing: new Set<string>(),
        archiving: new Set<string>(),
        notifiedBranches: new Set<string>(),
        onselect: vi.fn(),
        onclose: vi.fn(),
        onarchive,
        onmerge: vi.fn(),
        onremove: vi.fn(),
      },
    });

    await fireEvent.click(screen.getByRole("button", { name: /actions for feature\/menu-actions/i }));

    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Merge" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(onarchive).toHaveBeenCalledWith("feature/menu-actions");
  });

  it("disables the archive action while the row is archiving", async () => {
    render(WorktreeList, {
      props: {
        rows: [createRow(createWorktree("feature/archiving"))],
        selected: null,
        removing: new Set<string>(),
        initializing: new Set<string>(),
        archiving: new Set<string>(["feature/archiving"]),
        notifiedBranches: new Set<string>(),
        onselect: vi.fn(),
        onclose: vi.fn(),
        onarchive: vi.fn(),
        onmerge: vi.fn(),
        onremove: vi.fn(),
      },
    });

    await fireEvent.click(screen.getByRole("button", { name: /actions for feature\/archiving/i }));

    expect(screen.getByRole("button", { name: "Archive" })).toBeDisabled();
  });
});
