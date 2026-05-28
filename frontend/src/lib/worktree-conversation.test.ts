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
      revision: 1,
      conversationId: "thread-1",
      turnId: "turn-2",
      itemId: "assistant-2",
      delta: "Looking",
    });

    const updated = applyConversationMessageDelta(started, {
      type: "messageDelta",
      revision: 2,
      conversationId: "thread-1",
      turnId: "turn-2",
      itemId: "assistant-2",
      delta: " good",
    });

    expect(updated?.messages.at(-1)).toEqual({
      id: "assistant-2",
      turnId: "turn-2",
      role: "assistant",
      kind: "text",
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
      revision: 1,
      conversationId: "thread-1",
      turnId: "turn-2",
      itemId: "assistant-2",
      delta: "Looking",
    });

    const updated = applyConversationMessageDelta(started, {
      type: "messageDelta",
      revision: 2,
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
      revision: 1,
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
      revision: 2,
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

  it("replaces optimistic user messages with streamed server user messages", () => {
    const current = markConversationTurnStarted(makeConversation(), "turn-2", "Ship it");

    const updated = applyConversationMessageUpsert(current, {
      type: "messageUpsert",
      revision: 1,
      conversationId: "thread-1",
      message: {
        id: "user-2",
        turnId: "turn-2",
        role: "user",
        kind: "text",
        text: "Ship it",
        status: "completed",
        createdAt: "2026-05-28T10:00:00.000Z",
      },
    });

    expect(updated?.messages.filter((message) => message.text === "Ship it")).toEqual([
      {
        id: "user-2",
        turnId: "turn-2",
        role: "user",
        kind: "text",
        text: "Ship it",
        status: "completed",
        createdAt: "2026-05-28T10:00:00.000Z",
      },
    ]);
  });

  it("treats snapshots as authoritative for assistant messages", () => {
    const current = applyConversationMessageDelta(makeConversation(), {
      type: "messageDelta",
      revision: 1,
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

    expect(merged.messages).toEqual(makeConversation().messages);
  });

  it("preserves optimistic user messages until the matching server user message arrives", () => {
    const current = markConversationTurnStarted(makeConversation(), "turn-2", "Ship it");

    const merged = mergeConversationSnapshot(current, {
      ...makeConversation(),
      running: false,
      activeTurnId: null,
    });

    expect(merged.messages.some((message) => message.id === "pending-user:turn-2")).toBe(true);
  });

  it("drops optimistic user messages once a matching server user message arrives", () => {
    const current = markConversationTurnStarted(makeConversation(), "turn-2", "Ship it");

    const merged = mergeConversationSnapshot(current, {
      ...makeConversation(),
      messages: [
        ...makeConversation().messages,
        {
          id: "user-2",
          turnId: "turn-2",
          role: "user",
          text: "Ship it",
          status: "completed",
          createdAt: "2026-05-28T13:00:00.000Z",
        },
      ],
    });

    expect(merged.messages.some((message) => message.id === "pending-user:turn-2")).toBe(false);
    expect(merged.messages.at(-1)?.id).toBe("user-2");
  });

  it("drops optimistic user messages once the same server text arrives", () => {
    const current = markConversationTurnStarted(makeConversation(), "client-turn-2", "Ship it");

    const merged = mergeConversationSnapshot(current, {
      ...makeConversation(),
      messages: [
        ...makeConversation().messages,
        {
          id: "user-2",
          turnId: "server-turn-2",
          role: "user",
          text: "Ship it",
          status: "completed",
          createdAt: "2026-05-28T13:00:00.000Z",
        },
      ],
    });

    expect(merged.messages.some((message) => message.id === "pending-user:client-turn-2")).toBe(false);
    expect(merged.messages.filter((message) => message.text === "Ship it")).toHaveLength(1);
  });

  it("keeps a repeated optimistic prompt when only an older matching server message exists", () => {
    const current = markConversationTurnStarted({
      ...makeConversation(),
      messages: [
        ...makeConversation().messages,
        {
          id: "user-ship-old",
          turnId: "turn-old",
          role: "user",
          text: "Ship it",
          status: "completed",
          createdAt: "2026-05-28T12:00:00.000Z",
        },
      ],
    }, "turn-new", "Ship it");

    const merged = mergeConversationSnapshot(current, {
      ...makeConversation(),
      messages: [
        ...makeConversation().messages,
        {
          id: "user-ship-old",
          turnId: "turn-old",
          role: "user",
          text: "Ship it",
          status: "completed",
          createdAt: "2026-05-28T12:00:00.000Z",
        },
      ],
    });

    expect(merged.messages.some((message) => message.id === "pending-user:turn-new")).toBe(true);
    expect(merged.messages.filter((message) => message.text === "Ship it")).toHaveLength(2);
  });

  it("keeps longer streamed text when an upsert arrives with shorter text", () => {
    const current = applyConversationMessageDelta(makeConversation(), {
      type: "messageDelta",
      revision: 1,
      conversationId: "thread-1",
      turnId: "turn-2",
      itemId: "assistant-2",
      delta: "Still working on it",
    });

    const updated = applyConversationMessageUpsert(current, {
      type: "messageUpsert",
      revision: 2,
      conversationId: "thread-1",
      message: {
        id: "assistant-2",
        turnId: "turn-2",
        role: "assistant",
        kind: "text",
        text: "Still",
        status: "completed",
        createdAt: "2026-05-28T13:00:00.000Z",
      },
    });

    expect(updated?.messages.at(-1)).toEqual({
      id: "assistant-2",
      turnId: "turn-2",
      role: "assistant",
      kind: "text",
      text: "Still working on it",
      status: "completed",
      createdAt: "2026-05-28T13:00:00.000Z",
    });
  });

  it("uses snapshot text for server-owned messages", () => {
    const current = applyConversationMessageDelta(makeConversation(), {
      type: "messageDelta",
      revision: 1,
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
      text: "Still",
      status: "completed",
      createdAt: "2026-05-28T13:00:00.000Z",
    });
  });
});
