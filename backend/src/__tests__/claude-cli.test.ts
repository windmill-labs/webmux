import { describe, expect, it } from "bun:test";
import { buildClaudeSessionFromText, encodeClaudeProjectDir, parseClaudeStreamLine } from "../adapters/claude-cli";

describe("claude-cli adapter", () => {
  it("encodes Claude project directories from cwd", () => {
    expect(encodeClaudeProjectDir("/tmp/worktrees/feature.one")).toBe("-tmp-worktrees-feature-one");
  });

  it("parses text deltas from Claude stream-json output", () => {
    expect(parseClaudeStreamLine(JSON.stringify({
      type: "stream_event",
      session_id: "session-1",
      event: {
        type: "content_block_delta",
        index: 2,
        delta: {
          type: "text_delta",
          text: "hello",
        },
      },
    }))).toEqual({
      sessionId: "session-1",
      assistantDelta: {
        delta: "hello",
        blockIndex: 2,
      },
      messages: [],
      completeSessionId: null,
      error: null,
    });
  });

  it("parses finalized text and tool messages from Claude stream-json output", () => {
    expect(parseClaudeStreamLine(JSON.stringify({
      type: "assistant",
      session_id: "session-1",
      uuid: "assistant-1",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Reading the file." },
          { type: "tool_use", id: "tool-1", name: "Read", input: { file_path: "/tmp/foo.txt" } },
        ],
      },
    }))?.messages).toEqual([
      {
        uuid: "assistant-1",
        role: "assistant",
        kind: "text",
        text: "Reading the file.",
        createdAt: null,
      },
      {
        uuid: "assistant-1",
        role: "assistant",
        kind: "toolUse",
        toolName: "Read",
        toolCallId: "tool-1",
        text: `{"file_path":"/tmp/foo.txt"}`,
        createdAt: null,
      },
    ]);

    expect(parseClaudeStreamLine(JSON.stringify({
      type: "user",
      session_id: "session-1",
      uuid: "tool-result-1",
      timestamp: "2026-04-14T15:00:02.000Z",
      message: {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "tool-1", content: "hello world" },
        ],
      },
    }))?.messages).toEqual([
      {
        uuid: "tool-result-1",
        role: "user",
        kind: "toolResult",
        toolCallId: "tool-1",
        text: "hello world",
        createdAt: "2026-04-14T15:00:02.000Z",
      },
    ]);
  });

  it("parses errored result lines without completing the session", () => {
    expect(parseClaudeStreamLine(JSON.stringify({
      type: "result",
      session_id: "session-1",
      is_error: true,
      result: "API key is invalid",
    }))).toEqual({
      sessionId: "session-1",
      assistantDelta: null,
      messages: [],
      completeSessionId: null,
      error: "API key is invalid",
    });
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
          kind: "text",
          text: "Inspect the failing tests",
          createdAt: "2026-04-14T15:00:00.000Z",
        },
        {
          id: "assistant-thinking:1",
          turnId: "user-1",
          role: "assistant",
          kind: "text",
          text: "Let me inspect that.",
          createdAt: "2026-04-14T15:00:01.000Z",
        },
        {
          id: "assistant-1:2",
          turnId: "user-1",
          role: "assistant",
          kind: "text",
          text: "The failure comes from the stale snapshot.",
          createdAt: "2026-04-14T15:00:05.000Z",
        },
      ],
    });
  });

  it("surfaces tool_use and tool_result blocks as intermediate messages", () => {
    const session = buildClaudeSessionFromText({
      path: "/tmp/session.jsonl",
      sessionId: "session-2",
      text: [
        JSON.stringify({
          type: "user",
          uuid: "user-1",
          timestamp: "2026-04-14T15:00:00.000Z",
          cwd: "/tmp",
          message: { role: "user", content: "Read foo.txt" },
        }),
        JSON.stringify({
          type: "assistant",
          uuid: "assistant-1",
          timestamp: "2026-04-14T15:00:01.000Z",
          message: {
            role: "assistant",
            stop_reason: "tool_use",
            content: [
              { type: "text", text: "Reading the file." },
              { type: "tool_use", id: "tool-1", name: "Read", input: { file_path: "/tmp/foo.txt" } },
            ],
          },
        }),
        JSON.stringify({
          type: "user",
          uuid: "tool-result-1",
          timestamp: "2026-04-14T15:00:02.000Z",
          message: {
            role: "user",
            content: [
              { type: "tool_result", tool_use_id: "tool-1", content: "hello world" },
            ],
          },
        }),
        JSON.stringify({
          type: "assistant",
          uuid: "assistant-2",
          timestamp: "2026-04-14T15:00:03.000Z",
          message: {
            role: "assistant",
            stop_reason: "end_turn",
            content: [{ type: "text", text: "It says hello world." }],
          },
        }),
      ].join("\n"),
    });

    expect(session.messages).toEqual([
      {
        id: "user-1",
        turnId: "user-1",
        role: "user",
        kind: "text",
        text: "Read foo.txt",
        createdAt: "2026-04-14T15:00:00.000Z",
      },
      {
        id: "assistant-1:1",
        turnId: "user-1",
        role: "assistant",
        kind: "text",
        text: "Reading the file.",
        createdAt: "2026-04-14T15:00:01.000Z",
      },
      {
        id: "assistant-1:2",
        turnId: "user-1",
        role: "assistant",
        kind: "toolUse",
        toolName: "Read",
        toolCallId: "tool-1",
        text: `{"file_path":"/tmp/foo.txt"}`,
        createdAt: "2026-04-14T15:00:01.000Z",
      },
      {
        id: "tool-result-1:3",
        turnId: "user-1",
        role: "user",
        kind: "toolResult",
        toolCallId: "tool-1",
        text: "hello world",
        createdAt: "2026-04-14T15:00:02.000Z",
      },
      {
        id: "assistant-2:4",
        turnId: "user-1",
        role: "assistant",
        kind: "text",
        text: "It says hello world.",
        createdAt: "2026-04-14T15:00:03.000Z",
      },
    ]);
  });
});
