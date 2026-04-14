import { describe, expect, it } from "bun:test";
import { buildAgentsUiBootstrap } from "../services/agents-ui-service";

describe("buildAgentsUiBootstrap", () => {
  it("maps project snapshots into agents-ui bootstrap data with conversation metadata", () => {
    const bootstrap = buildAgentsUiBootstrap({
      snapshot: {
        project: {
          name: "Project",
          mainBranch: "main",
        },
        worktrees: [
          {
            branch: "feature/search",
            baseBranch: "main",
            path: "/repo/__worktrees/feature-search",
            dir: "/repo/__worktrees/feature-search",
            archived: false,
            profile: "default",
            agentName: "codex",
            mux: true,
            dirty: true,
            unpushed: false,
            paneCount: 2,
            status: "running",
            elapsed: "4m",
            services: [
              { name: "frontend", port: 3010, running: true, url: "http://127.0.0.1:3010" },
            ],
            prs: [],
            linearIssue: null,
            creation: {
              phase: "starting_session",
            },
          },
        ],
        notifications: [],
      },
      conversations: new Map([
        [
          "feature/search",
          {
            provider: "codexAppServer",
            conversationId: "thr_123",
            threadId: "thr_123",
            cwd: "/repo/__worktrees/feature-search",
            lastSeenAt: "2026-04-14T10:00:00.000Z",
          },
        ],
      ]),
    });

    expect(bootstrap).toEqual({
      project: {
        name: "Project",
        mainBranch: "main",
      },
      capabilities: {
        codexWorktreeChat: true,
        claudeWorktreeChat: true,
      },
      worktrees: [
        {
          branch: "feature/search",
          baseBranch: "main",
          path: "/repo/__worktrees/feature-search",
          archived: false,
          profile: "default",
          agentName: "codex",
          status: "running",
          dirty: true,
          unpushed: false,
          services: [
            { name: "frontend", port: 3010, running: true, url: "http://127.0.0.1:3010" },
          ],
          creating: true,
          creationPhase: "starting_session",
          conversation: {
            provider: "codexAppServer",
            conversationId: "thr_123",
            threadId: "thr_123",
            cwd: "/repo/__worktrees/feature-search",
            lastSeenAt: "2026-04-14T10:00:00.000Z",
          },
        },
      ],
    });
  });

  it("defaults missing conversation metadata to null", () => {
    const bootstrap = buildAgentsUiBootstrap({
      snapshot: {
        project: {
          name: "Project",
          mainBranch: "main",
        },
        worktrees: [
          {
            branch: "feature/idle",
            path: "/repo/__worktrees/feature-idle",
            dir: "/repo/__worktrees/feature-idle",
            archived: false,
            profile: null,
            agentName: null,
            mux: false,
            dirty: false,
            unpushed: false,
            paneCount: 0,
            status: "closed",
            elapsed: "",
            services: [],
            prs: [],
            linearIssue: null,
            creation: null,
          },
        ],
        notifications: [],
      },
      conversations: new Map(),
    });

    expect(bootstrap.worktrees[0]?.conversation).toBeNull();
    expect(bootstrap.worktrees[0]?.creating).toBe(false);
    expect(bootstrap.worktrees[0]?.creationPhase).toBeNull();
  });
});
