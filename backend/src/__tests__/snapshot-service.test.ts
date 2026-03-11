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
      creatingWorktrees: [
        {
          branch: "feature/search",
          path: "/repo/__worktrees/feature-search",
          profile: "default",
          agentName: "claude",
          phase: "starting_session",
        },
      ],
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
        status: "creating",
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
        creation: {
          phase: "starting_session",
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
    expect(snapshot.worktrees[0]?.creation).toBeNull();
  });

  it("includes placeholder snapshots for worktrees that are still being created", () => {
    const runtime = new ProjectRuntime();

    const snapshot = buildProjectSnapshot({
      projectName: "Project",
      mainBranch: "main",
      runtime,
      notifications: [],
      creatingWorktrees: [
        {
          branch: "feature/new-flow",
          path: "/repo/__worktrees/feature/new-flow",
          profile: "default",
          agentName: "codex",
          phase: "creating_worktree",
        },
      ],
      findLinearIssue: (branch) =>
        branch === "feature/new-flow"
          ? {
              identifier: "ENG-999",
              url: "https://linear.app/acme/issue/ENG-999",
              state: {
                name: "Todo",
                color: "#64748b",
                type: "unstarted",
              },
            }
          : null,
    });

    expect(snapshot.worktrees).toEqual([
      {
        branch: "feature/new-flow",
        path: "/repo/__worktrees/feature/new-flow",
        dir: "/repo/__worktrees/feature/new-flow",
        profile: "default",
        agentName: "codex",
        mux: false,
        dirty: false,
        paneCount: 0,
        status: "creating",
        elapsed: "",
        services: [],
        prs: [],
        linearIssue: {
          identifier: "ENG-999",
          url: "https://linear.app/acme/issue/ENG-999",
          state: {
            name: "Todo",
            color: "#64748b",
            type: "unstarted",
          },
        },
        creation: {
          phase: "creating_worktree",
        },
      },
    ]);
  });

  it("keeps merged runtime and creating worktrees sorted by branch", () => {
    const runtime = new ProjectRuntime();
    runtime.upsertWorktree({
      worktreeId: "wt_zebra",
      branch: "feature/zebra",
      path: "/repo/__worktrees/feature-zebra",
      runtime: "host",
    });
    runtime.upsertWorktree({
      worktreeId: "wt_middle",
      branch: "feature/middle",
      path: "/repo/__worktrees/feature-middle",
      runtime: "host",
    });

    const snapshot = buildProjectSnapshot({
      projectName: "Project",
      mainBranch: "main",
      runtime,
      notifications: [],
      creatingWorktrees: [
        {
          branch: "feature/alpha",
          path: "/repo/__worktrees/feature-alpha",
          profile: "default",
          agentName: "claude",
          phase: "creating_worktree",
        },
      ],
    });

    expect(snapshot.worktrees.map((worktree) => worktree.branch)).toEqual([
      "feature/alpha",
      "feature/middle",
      "feature/zebra",
    ]);
  });
});
