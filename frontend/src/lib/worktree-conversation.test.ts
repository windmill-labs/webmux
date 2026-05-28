import { describe, expect, it } from "vitest";
import {
  applyConversationMessageDelta,
  applyConversationMessageUpsert,
  buildConversationProgressSignature,
  markConversationTurnStarted,
  mergeConversationSnapshot,
} from "./worktree-conversation";
import type { AgentsUiConversationState } from "./types";

function makeConversation(): AgentsUiConversationState {
  return {
    provider: "codexAppServer",
    conversationId: "thread-1",
    cwd: "/tmp/worktree",
    running: false,
    activeTurnId: null,
    messages: [
      {
        id: "user-1",
        turnId: "turn-1",
        role: "user",
        text: "Inspect the diff",
        status: "completed",
        createdAt: "2026-04-15T10:00:00.000Z",
      },
    ],
  };
}

describe("worktree conversation helpers", () => {
  it("adds optimistic user messages when a turn starts", () => {
    expect(markConversationTurnStarted(makeConversation(), "turn-2", "Ship it")?.messages.at(-1)).toEqual({
      id: "pending-user:turn-2",
      turnId: "turn-2",
      role: "user",
      text: "Ship it",
      status: "completed",
      createdAt: expect.any(String),
    });
  });

  it("appends assistant deltas to an in-progress message", () => {
    const started = applyConversationMessageDelta(makeConversation(), {
      type: "messageDelta",
      conversationId: "thread-1",
      turnId: "turn-2",
      itemId: "assistant-2",
      delta: "Looking",
    });

    const updated = applyConversationMessageDelta(started, {
      type: "messageDelta",
      conversationId: "thread-1",
      turnId: "turn-2",
      itemId: "assistant-2",
      delta: " good",
    });

    expect(updated?.messages.at(-1)).toEqual({
      id: "assistant-2",
      turnId: "turn-2",
      role: "assistant",
      text: "Looking good",
      status: "inProgress",
      createdAt: null,
    });
    expect(updated?.running).toBe(true);
    expect(updated?.activeTurnId).toBe("turn-2");
  });

  it("captures progress when the latest message grows", () => {
    const started = applyConversationMessageDelta(makeConversation(), {
      type: "messageDelta",
      conversationId: "thread-1",
      turnId: "turn-2",
      itemId: "assistant-2",
      delta: "Looking",
    });

    const updated = applyConversationMessageDelta(started, {
      type: "messageDelta",
      conversationId: "thread-1",
      turnId: "turn-2",
      itemId: "assistant-2",
      delta: " better",
    });

    expect(buildConversationProgressSignature(started)).not.toBe(buildConversationProgressSignature(updated));
  });

  it("upserts streamed tool messages", () => {
    const started = applyConversationMessageUpsert(makeConversation(), {
      type: "messageUpsert",
      conversationId: "thread-1",
      message: {
        id: "call-1",
        turnId: "turn-2",
        role: "assistant",
        kind: "toolUse",
        toolName: "shell",
        toolCallId: "call-1",
        text: "ls",
        status: "inProgress",
        createdAt: "2026-05-28T10:00:00.000Z",
      },
    });

    const completed = applyConversationMessageUpsert(started, {
      type: "messageUpsert",
      conversationId: "thread-1",
      message: {
        id: "call-1",
        turnId: "turn-2",
        role: "assistant",
        kind: "toolUse",
        toolName: "shell",
        toolCallId: "call-1",
        text: "ls",
        status: "completed",
        createdAt: "2026-05-28T10:00:01.000Z",
        exitCode: 0,
        durationMs: 8,
      },
    });

    expect(completed?.messages.at(-1)).toEqual({
      id: "call-1",
      turnId: "turn-2",
      role: "assistant",
      kind: "toolUse",
      toolName: "shell",
      toolCallId: "call-1",
      text: "ls",
      status: "completed",
      createdAt: "2026-05-28T10:00:01.000Z",
      exitCode: 0,
      durationMs: 8,
    });
  });

  it("preserves streamed assistant messages when a stale snapshot arrives", () => {
    const current = applyConversationMessageDelta(makeConversation(), {
      type: "messageDelta",
      conversationId: "thread-1",
      turnId: "turn-2",
      itemId: "assistant-2",
      delta: "Still working",
    });

    const merged = mergeConversationSnapshot(current, {
      ...makeConversation(),
      running: false,
      activeTurnId: null,
    });

    expect(merged.messages.at(-1)).toEqual({
      id: "assistant-2",
      turnId: "turn-2",
      role: "assistant",
      text: "Still working",
      status: "completed",
      createdAt: null,
    });
  });

  it("does not preserve optimistic user messages when the snapshot is stale", () => {
    const current = markConversationTurnStarted(makeConversation(), "turn-2", "Ship it");

    const merged = mergeConversationSnapshot(current, {
      ...makeConversation(),
      running: false,
      activeTurnId: null,
    });

    expect(merged.messages.some((message) => message.id === "pending-user:turn-2")).toBe(false);
  });

  it("keeps the longer streamed text when a snapshot has a shorter version of the same message", () => {
    const current = applyConversationMessageDelta(makeConversation(), {
      type: "messageDelta",
      conversationId: "thread-1",
      turnId: "turn-2",
      itemId: "assistant-2",
      delta: "Still working on it",
    });

    const merged = mergeConversationSnapshot(current, {
      provider: "codexAppServer",
      conversationId: "thread-1",
      cwd: "/tmp/worktree",
      running: false,
      activeTurnId: null,
      messages: [
        ...makeConversation().messages,
        {
          id: "assistant-2",
          turnId: "turn-2",
          role: "assistant",
          text: "Still",
          status: "completed",
          createdAt: "2026-05-28T13:00:00.000Z",
        },
      ],
    });

    expect(merged.messages.at(-1)).toEqual({
      id: "assistant-2",
      turnId: "turn-2",
      role: "assistant",
      text: "Still working on it",
      status: "completed",
      createdAt: "2026-05-28T13:00:00.000Z",
    });
  });
});
