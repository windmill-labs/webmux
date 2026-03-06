import { describe, expect, it } from "bun:test";
import { NotificationService } from "../services/notification-service";
import { ProjectRuntime } from "../services/project-runtime";
import { buildProjectSnapshot } from "../services/snapshot-service";

describe("buildProjectSnapshot", () => {
  it("projects runtime worktrees into frontend-facing snapshot state", () => {
    const runtime = new ProjectRuntime();
    runtime.upsertWorktree({
      worktreeId: "wt_search",
      branch: "feature/search",
      path: "/repo/__worktrees/feature-search",
      profile: "default",
      agentName: "claude",
      runtime: "host",
    });
    runtime.setGitState("wt_search", {
      dirty: true,
      aheadCount: 1,
    });
    runtime.setSessionState("wt_search", {
      exists: true,
      sessionName: "wm-project-12345678",
      paneCount: 2,
    });
    runtime.setServices("wt_search", [
      { name: "frontend", port: 3010, running: true, url: "http://127.0.0.1:3010" },
    ]);
    runtime.setPrs("wt_search", [
      {
        repo: "org/repo",
        number: 77,
        state: "open",
        url: "https://github.com/org/repo/pull/77",
        updatedAt: "2026-03-06T10:02:00.000Z",
        ciStatus: "pending",
        ciChecks: [
          {
            name: "build",
            status: "pending",
            url: "https://github.com/org/repo/actions/runs/123",
            runId: 123,
          },
        ],
        comments: [
          {
            type: "comment",
            author: "reviewer",
            body: "Needs changes",
            createdAt: "2026-03-06T10:03:00.000Z",
          },
        ],
      },
    ]);
    runtime.applyEvent(
      { worktreeId: "wt_search", branch: "feature/search", type: "agent_status_changed", lifecycle: "running" },
      () => new Date("2026-03-06T10:00:00.000Z"),
    );

    const notifications = new NotificationService();
    notifications.recordEvent(
      { worktreeId: "wt_search", branch: "feature/search", type: "pr_opened", url: "https://github.com/org/repo/pull/123" },
      () => new Date("2026-03-06T10:02:00.000Z"),
    );

    const snapshot = buildProjectSnapshot({
      projectName: "Project",
      mainBranch: "main",
      runtime,
      notifications: notifications.list(),
      findLinearIssue: (branch) =>
        branch === "feature/search"
          ? {
              identifier: "ENG-123",
              url: "https://linear.app/acme/issue/ENG-123",
              state: {
                name: "In Progress",
                color: "#f59e0b",
                type: "started",
              },
            }
          : null,
      now: () => new Date("2026-03-06T10:05:00.000Z"),
    });

    expect(snapshot.project).toEqual({
      name: "Project",
      mainBranch: "main",
    });
    expect(snapshot.worktrees).toEqual([
      {
        branch: "feature/search",
        path: "/repo/__worktrees/feature-search",
        dir: "/repo/__worktrees/feature-search",
        profile: "default",
        agentName: "claude",
        mux: true,
        dirty: true,
        paneCount: 2,
        status: "running",
        elapsed: "5m",
        services: [
          { name: "frontend", port: 3010, running: true, url: "http://127.0.0.1:3010" },
        ],
        prs: [
          {
            repo: "org/repo",
            number: 77,
            state: "open",
            url: "https://github.com/org/repo/pull/77",
            updatedAt: "2026-03-06T10:02:00.000Z",
            ciStatus: "pending",
            ciChecks: [
              {
                name: "build",
                status: "pending",
                url: "https://github.com/org/repo/actions/runs/123",
                runId: 123,
              },
            ],
            comments: [
              {
                type: "comment",
                author: "reviewer",
                body: "Needs changes",
                createdAt: "2026-03-06T10:03:00.000Z",
              },
            ],
          },
        ],
        linearIssue: {
          identifier: "ENG-123",
          url: "https://linear.app/acme/issue/ENG-123",
          state: {
            name: "In Progress",
            color: "#f59e0b",
            type: "started",
          },
        },
      },
    ]);
    expect(snapshot.notifications).toHaveLength(1);
    expect(snapshot.notifications[0]?.type).toBe("pr_opened");
  });

  it("returns blank elapsed for worktrees that never started", () => {
    const runtime = new ProjectRuntime();
    runtime.upsertWorktree({
      worktreeId: "wt_idle",
      branch: "feature/idle",
      path: "/repo/__worktrees/feature-idle",
      runtime: "host",
    });

    const snapshot = buildProjectSnapshot({
      projectName: "Project",
      mainBranch: "main",
      runtime,
      notifications: [],
    });

    expect(snapshot.worktrees[0]?.elapsed).toBe("");
    expect(snapshot.worktrees[0]?.status).toBe("closed");
    expect(snapshot.worktrees[0]?.prs).toEqual([]);
    expect(snapshot.worktrees[0]?.linearIssue).toBeNull();
  });
});
