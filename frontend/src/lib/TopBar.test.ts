import { render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import TopBar from "./TopBar.svelte";
import type { WorktreeInfo } from "./types";

function createWorktree(
  branch: string,
  overrides: Partial<WorktreeInfo> = {},
): WorktreeInfo {
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
    agentLabel: null,
    services: [],
    paneCount: 1,
    prs: [],
    linearIssue: null,
    creating: false,
    creationPhase: null,
    ...overrides,
  };
}

function renderTopBar(
  branch: string,
  overrides: Partial<WorktreeInfo> = {},
): ReturnType<typeof render> {
  return render(TopBar, {
    props: {
      name: branch,
      worktree: createWorktree(branch, overrides),
      sshHost: "",
      linkedRepos: [],
      notificationHistory: [],
      unreadCount: 0,
      onclose: vi.fn(),
      onarchive: vi.fn(),
      onmerge: vi.fn(),
      onremove: vi.fn(),
      onsettings: vi.fn(),
      onCiClick: vi.fn(),
      onReviewsClick: vi.fn(),
    },
  });
}

describe("TopBar", () => {
  it("truncates worktree names longer than 30 characters in the header", () => {
    const branch = "feature/abcdefghijklmnopqrstuvwxyz-1234567890";

    renderTopBar(branch);

    const truncated = `${branch.slice(0, 27)}...`;
    const header = screen.getByText(truncated);

    expect(truncated).toHaveLength(30);
    expect(header).toHaveAttribute("title", branch);
  });

  it("shows short worktree names without truncation", () => {
    const branch = "feature/short-name";

    renderTopBar(branch);

    const header = screen.getByText(branch);

    expect(header).toHaveAttribute("title", branch);
  });

  it("renders the Linear badge as a link in the header", () => {
    const branch = "feature/linear-link";
    const linearIssue = {
      identifier: "ENG-42",
      url: "https://linear.app/example/issue/ENG-42",
      state: {
        name: "In Progress",
        color: "#5e6ad2",
        type: "started",
      },
    };

    renderTopBar(branch, { linearIssue });

    expect(screen.getByRole("link", { name: "ENG-42" })).toHaveAttribute(
      "href",
      linearIssue.url,
    );
  });

  it("keeps desktop PR badges inside a wrapping header container", () => {
    const branch = "feature/header-wrap";
    const { container } = renderTopBar(branch, {
      prs: [
        {
          repo: "origin",
          number: 42,
          state: "open",
          url: "https://github.com/example/repo/pull/42",
          updatedAt: "2026-03-23T12:00:00.000Z",
          ciStatus: "success",
          ciChecks: [],
          comments: [],
        },
      ],
    });

    const badgeContainer = container.querySelector(".topbar-main-prs");
    const repoGroup = badgeContainer?.querySelector(".repo-group");

    expect(badgeContainer).not.toBeNull();
    expect(badgeContainer?.className).toContain("flex-1");
    expect(repoGroup).not.toBeNull();
    expect(repoGroup?.className).toContain("flex-wrap");
  });
});
