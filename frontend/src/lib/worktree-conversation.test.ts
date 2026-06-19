import { describe, expect, it } from "vitest";
import {
  applyConversationMessageDelta,
  applyConversationMessageUpsert,
  applyConversationStatus,
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
        order: 0,
        role: "user",
        kind: "text",
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
      order: 1,
      role: "user",
      kind: "text",
      text: "Ship it",
      status: "completed",
      createdAt: expect.any(String),
    });
  });

  it("applies streamed conversation status without replacing messages", () => {
    const conversation = {
      ...makeConversation(),
      running: true,
      activeTurnId: "turn-1",
    };

    expect(applyConversationStatus(conversation, {
      type: "conversationStatus",
      revision: 4,
      conversationId: "thread-1",
      running: false,
      activeTurnId: null,
    })).toEqual({
      ...conversation,
      running: false,
      activeTurnId: null,
    });
  });

  it("appends assistant deltas to an in-progress message", () => {
    const started = applyConversationMessageDelta(makeConversation(), {
      type: "messageDelta",
      revision: 1,
      conversationId: "thread-1",
      turnId: "turn-2",
      itemId: "assistant-2",
      order: 1,
      delta: "Looking",
    });

    const updated = applyConversationMessageDelta(started, {
      type: "messageDelta",
      revision: 2,
      conversationId: "thread-1",
      turnId: "turn-2",
      itemId: "assistant-2",
      order: 1,
      delta: " good",
    });

    expect(updated?.messages.at(-1)).toEqual({
      id: "assistant-2",
      turnId: "turn-2",
      order: 1,
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
      order: 1,
      delta: "Looking",
    });

    const updated = applyConversationMessageDelta(started, {
      type: "messageDelta",
      revision: 2,
      conversationId: "thread-1",
      turnId: "turn-2",
      itemId: "assistant-2",
      order: 1,
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
        order: 1,
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
        order: 1,
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
      order: 1,
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

  it("keeps item order when assistant text becomes visible", () => {
    const assistantStarted = applyConversationMessageUpsert(makeConversation(), {
      type: "messageUpsert",
      revision: 1,
      conversationId: "thread-1",
      message: {
        id: "assistant-2",
        turnId: "turn-2",
        order: 1,
        role: "assistant",
        kind: "text",
        text: "",
        status: "inProgress",
        createdAt: "2026-05-28T10:00:00.000Z",
      },
    });
    const toolStarted = applyConversationMessageUpsert(assistantStarted, {
      type: "messageUpsert",
      revision: 2,
      conversationId: "thread-1",
      message: {
        id: "call-1",
        turnId: "turn-2",
        order: 2,
        role: "assistant",
        kind: "toolUse",
        toolName: "shell",
        toolCallId: "call-1",
        text: "ls",
        status: "completed",
        createdAt: "2026-05-28T10:00:01.000Z",
      },
    });

    const updated = applyConversationMessageDelta(toolStarted, {
      type: "messageDelta",
      revision: 3,
      conversationId: "thread-1",
      turnId: "turn-2",
      itemId: "assistant-2",
      order: 1,
      delta: "Done.",
    });

    expect(updated?.messages.map((message) => message.id)).toEqual(["user-1", "assistant-2", "call-1"]);
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
        order: 1,
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
        order: 1,
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
      order: 1,
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
          order: 1,
          role: "user",
          kind: "text",
          text: "Ship it",
          status: "completed",
          createdAt: "2026-05-28T13:00:00.000Z",
        },
      ],
    });

    expect(merged.messages.some((message) => message.id === "pending-user:turn-2")).toBe(false);
    expect(merged.messages.at(-1)?.id).toBe("user-2");
  });

  it("keeps optimistic user messages when only the same server text arrives for another turn", () => {
    const current = markConversationTurnStarted(makeConversation(), "client-turn-2", "Ship it");

    const merged = mergeConversationSnapshot(current, {
      ...makeConversation(),
      messages: [
        ...makeConversation().messages,
        {
          id: "user-2",
          turnId: "server-turn-2",
          order: 1,
          role: "user",
          kind: "text",
          text: "Ship it",
          status: "completed",
          createdAt: "2026-05-28T13:00:00.000Z",
        },
      ],
    });

    expect(merged.messages.some((message) => message.id === "pending-user:client-turn-2")).toBe(true);
    expect(merged.messages.filter((message) => message.text === "Ship it")).toHaveLength(2);
  });

  it("keeps a repeated optimistic prompt when only an older matching server message exists", () => {
    const current = markConversationTurnStarted({
      ...makeConversation(),
      messages: [
        ...makeConversation().messages,
        {
          id: "user-ship-old",
          turnId: "turn-old",
          order: 1,
          role: "user",
          kind: "text",
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
          order: 1,
          role: "user",
          kind: "text",
          text: "Ship it",
          status: "completed",
          createdAt: "2026-05-28T12:00:00.000Z",
        },
      ],
    });

    expect(merged.messages.some((message) => message.id === "pending-user:turn-new")).toBe(true);
    expect(merged.messages.filter((message) => message.text === "Ship it")).toHaveLength(2);
  });

  it("uses completed upsert text even when it is shorter than streamed text", () => {
    const current = applyConversationMessageDelta(makeConversation(), {
      type: "messageDelta",
      revision: 1,
      conversationId: "thread-1",
      turnId: "turn-2",
      itemId: "assistant-2",
      order: 1,
      delta: "Still working on it",
    });

    const updated = applyConversationMessageUpsert(current, {
      type: "messageUpsert",
      revision: 2,
      conversationId: "thread-1",
      message: {
        id: "assistant-2",
        turnId: "turn-2",
        order: 1,
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
      order: 1,
      role: "assistant",
      kind: "text",
      text: "Still",
      status: "completed",
      createdAt: "2026-05-28T13:00:00.000Z",
    });
  });

  it("finalizes a Claude live item when its full message arrives with the same id", () => {
    // Deltas and the finalized block now share the stable `${messageId}:${index}`
    // id, so the upsert replaces the streaming placeholder in place — no
    // text-overlap heuristics, no duplicate container.
    const current = applyConversationMessageDelta({
      ...makeConversation(),
      provider: "claudeCode",
      conversationId: "session-1",
    }, {
      type: "messageDelta",
      revision: 1,
      conversationId: "session-1",
      turnId: "claude-turn:turn-2",
      itemId: "msg_2:0",
      order: 1,
      delta: "Still working",
    });

    const updated = applyConversationMessageUpsert(current, {
      type: "messageUpsert",
      revision: 2,
      conversationId: "session-1",
      message: {
        id: "msg_2:0",
        turnId: "claude-turn:turn-2",
        order: 1,
        role: "assistant",
        kind: "text",
        text: "Still working on it",
        status: "inProgress",
        createdAt: null,
      },
    });

    expect(updated?.messages.filter((message) => message.id === "msg_2:0")).toEqual([
      {
        id: "msg_2:0",
        turnId: "claude-turn:turn-2",
        order: 1,
        role: "assistant",
        kind: "text",
        text: "Still working on it",
        status: "inProgress",
        createdAt: null,
      },
    ]);
  });

  it("uses snapshot text for server-owned messages", () => {
    const current = applyConversationMessageDelta(makeConversation(), {
      type: "messageDelta",
      revision: 1,
      conversationId: "thread-1",
      turnId: "turn-2",
      itemId: "assistant-2",
      order: 1,
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
          order: 1,
          role: "assistant",
          kind: "text",
          text: "Still",
          status: "completed",
          createdAt: "2026-05-28T13:00:00.000Z",
        },
      ],
    });

    expect(merged.messages.at(-1)).toEqual({
      id: "assistant-2",
      turnId: "turn-2",
      order: 1,
      role: "assistant",
      kind: "text",
      text: "Still",
      status: "completed",
      createdAt: "2026-05-28T13:00:00.000Z",
    });
  });
});
