import { render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import TopBar from "./TopBar.svelte";
import type { WorktreeInfo } from "./types";

function createWorktree(branch: string): WorktreeInfo {
  return {
    branch,
    agent: "claude",
    mux: "✓",
    path: `/tmp/${branch}`,
    dir: `/tmp/${branch}`,
    dirty: false,
    status: "running",
    elapsed: "1m",
    profile: null,
    agentName: null,
    services: [],
    paneCount: 1,
    prs: [],
    linearIssue: null,
    creating: false,
    creationPhase: null,
  };
}

function renderTopBar(branch: string): void {
  render(TopBar, {
    props: {
      name: branch,
      worktree: createWorktree(branch),
      sshHost: "",
      linkedRepos: [],
      notificationHistory: [],
      unreadCount: 0,
      onclose: vi.fn(),
      onmerge: vi.fn(),
      onremove: vi.fn(),
      onsettings: vi.fn(),
      onCiClick: vi.fn(),
      onReviewsClick: vi.fn(),
    },
  });
}

describe("TopBar", () => {
  it("truncates worktree names longer than 40 characters in the header", () => {
    const branch = "feature/abcdefghijklmnopqrstuvwxyz-1234567890";

    renderTopBar(branch);

    const truncated = `${branch.slice(0, 37)}...`;
    const header = screen.getByText(truncated);

    expect(truncated).toHaveLength(40);
    expect(header).toHaveAttribute("title", branch);
  });

  it("shows short worktree names without truncation", () => {
    const branch = "feature/short-name";

    renderTopBar(branch);

    const header = screen.getByText(branch);

    expect(header).toHaveAttribute("title", branch);
  });
});
