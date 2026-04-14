import { describe, expect, it } from "bun:test";
import {
  buildAgentsUiMessageDeltaEvent,
  readAgentsNotificationThreadId,
  shouldRefreshAgentsConversationSnapshot,
} from "../services/agents-ui-stream-service";

describe("agents-ui-stream-service", () => {
  it("reads the thread id from thread-scoped notifications", () => {
    expect(readAgentsNotificationThreadId({
      method: "thread/status/changed",
      params: {
        threadId: "thread-1",
      },
    })).toBe("thread-1");
  });

  it("builds message delta events from agent message notifications", () => {
    expect(buildAgentsUiMessageDeltaEvent({
      method: "item/agentMessage/delta",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "item-1",
        delta: "hello",
      },
    })).toEqual({
      type: "messageDelta",
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-1",
      delta: "hello",
    });
  });

  it("marks turn and relevant item notifications as snapshot refresh points", () => {
    expect(shouldRefreshAgentsConversationSnapshot({
      method: "turn/started",
      params: {
        threadId: "thread-1",
      },
    })).toBe(true);

    expect(shouldRefreshAgentsConversationSnapshot({
      method: "item/completed",
      params: {
        threadId: "thread-1",
        item: {
          type: "userMessage",
        },
      },
    })).toBe(true);

    expect(shouldRefreshAgentsConversationSnapshot({
      method: "item/completed",
      params: {
        threadId: "thread-1",
        item: {
          type: "reasoning",
        },
      },
    })).toBe(false);
  });
});
