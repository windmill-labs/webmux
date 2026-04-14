import { describe, expect, it } from "bun:test";
import { buildClaudeSessionFromText, encodeClaudeProjectDir } from "../adapters/claude-cli";

describe("claude-cli adapter", () => {
  it("encodes Claude project directories from cwd", () => {
    expect(encodeClaudeProjectDir("/tmp/worktrees/feature.one")).toBe("-tmp-worktrees-feature-one");
  });

  it("builds a transcript from Claude session jsonl text", () => {
    const session = buildClaudeSessionFromText({
      path: "/tmp/session.jsonl",
      sessionId: "session-1",
      text: [
        JSON.stringify({
          type: "user",
          uuid: "user-1",
          timestamp: "2026-04-14T15:00:00.000Z",
          cwd: "/tmp/worktrees/claude-feature",
          gitBranch: "claude-feature",
          message: {
            role: "user",
            content: "Inspect the failing tests\n",
          },
        }),
        JSON.stringify({
          type: "assistant",
          uuid: "assistant-thinking",
          timestamp: "2026-04-14T15:00:01.000Z",
          message: {
            role: "assistant",
            stop_reason: null,
            content: [{ type: "text", text: "Let me inspect that." }],
          },
        }),
        JSON.stringify({
          type: "assistant",
          uuid: "assistant-1",
          timestamp: "2026-04-14T15:00:05.000Z",
          message: {
            role: "assistant",
            stop_reason: "end_turn",
            content: [{ type: "text", text: "The failure comes from the stale snapshot." }],
          },
        }),
      ].join("\n"),
    });

    expect(session).toEqual({
      sessionId: "session-1",
      cwd: "/tmp/worktrees/claude-feature",
      path: "/tmp/session.jsonl",
      gitBranch: "claude-feature",
      createdAt: "2026-04-14T15:00:00.000Z",
      lastSeenAt: "2026-04-14T15:00:05.000Z",
      messages: [
        {
          id: "user-1",
          turnId: "user-1",
          role: "user",
          text: "Inspect the failing tests",
          createdAt: "2026-04-14T15:00:00.000Z",
        },
        {
          id: "assistant-1",
          turnId: "user-1",
          role: "assistant",
          text: "The failure comes from the stale snapshot.",
          createdAt: "2026-04-14T15:00:05.000Z",
        },
      ],
    });
  });
});
