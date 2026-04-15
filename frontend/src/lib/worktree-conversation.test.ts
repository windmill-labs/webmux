import { describe, expect, it } from "vitest";
import {
  applyConversationMessageDelta,
  markConversationTurnStarted,
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
});
