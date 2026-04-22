import { describe, expect, it } from "bun:test";
import { buildAgentsUiWorktreeSummary } from "../services/agents-ui-service";

describe("buildAgentsUiWorktreeSummary", () => {
  it("maps worktree snapshots into conversation-aware summary data", () => {
    const summary = buildAgentsUiWorktreeSummary({
      branch: "feature/search",
      baseBranch: "main",
      path: "/repo/__worktrees/feature-search",
      dir: "/repo/__worktrees/feature-search",
      archived: false,
      profile: "default",
      agentName: "codex",
      agentLabel: "Codex",
      mux: true,
      dirty: true,
      unpushed: false,
      paneCount: 2,
      status: "running",
      elapsed: "4m",
      services: [
        { name: "frontend", port: 3010, running: true, url: "http://127.0.0.1:3010" },
      ],
      prs: [
        {
          repo: "webmux",
          number: 216,
          state: "open",
          url: "https://github.com/windmill-labs/webmux/pull/216",
          updatedAt: "2026-04-15T10:00:00.000Z",
          ciStatus: "pending",
          ciChecks: [],
          comments: [],
        },
      ],
      linearIssue: null,
      creation: {
        phase: "starting_session",
      },
    }, {
      provider: "codexAppServer",
      conversationId: "thr_123",
      threadId: "thr_123",
      cwd: "/repo/__worktrees/feature-search",
      lastSeenAt: "2026-04-14T10:00:00.000Z",
    });

    expect(summary).toEqual({
      branch: "feature/search",
      baseBranch: "main",
      path: "/repo/__worktrees/feature-search",
      archived: false,
      profile: "default",
      agentName: "codex",
      agentLabel: "Codex",
      mux: true,
      status: "running",
      dirty: true,
      unpushed: false,
      services: [
        { name: "frontend", port: 3010, running: true, url: "http://127.0.0.1:3010" },
      ],
      prs: [
        {
          repo: "webmux",
          number: 216,
          state: "open",
          url: "https://github.com/windmill-labs/webmux/pull/216",
          updatedAt: "2026-04-15T10:00:00.000Z",
          ciStatus: "pending",
          ciChecks: [],
          comments: [],
        },
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
    });
  });

  it("defaults missing conversation metadata to null", () => {
    const summary = buildAgentsUiWorktreeSummary({
      branch: "feature/idle",
      path: "/repo/__worktrees/feature-idle",
      dir: "/repo/__worktrees/feature-idle",
      archived: false,
      profile: null,
      agentName: null,
      agentLabel: null,
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
    }, null);

    expect(summary.conversation).toBeNull();
    expect(summary.creating).toBe(false);
    expect(summary.creationPhase).toBeNull();
    expect(summary.mux).toBe(false);
  });
});
