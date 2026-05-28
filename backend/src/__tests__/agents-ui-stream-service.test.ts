import { describe, expect, it } from "bun:test";
import {
  buildAgentsUiMessageDeltaEvent,
  buildAgentsUiMessageUpsertEvents,
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
      conversationId: "thread-1",
      turnId: "turn-1",
      itemId: "item-1",
      delta: "hello",
    });
  });

  it("builds commentary upsert events as text messages", () => {
    expect(buildAgentsUiMessageUpsertEvents({
      method: "item/started",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        startedAtMs: 1779965441194,
        item: {
          type: "agentMessage",
          id: "commentary-1",
          text: "",
          phase: "commentary",
          memoryCitation: null,
        },
      },
    })).toEqual([
      {
        type: "messageUpsert",
        conversationId: "thread-1",
        message: {
          id: "commentary-1",
          turnId: "turn-1",
          role: "assistant",
          kind: "text",
          phase: "commentary",
          text: "",
          status: "inProgress",
          createdAt: "2026-05-28T10:50:41.194Z",
        },
      },
    ]);
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

  it("builds upsert events from command execution notifications", () => {
    expect(buildAgentsUiMessageUpsertEvents({
      method: "item/completed",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        completedAtMs: 1779965441194,
        item: {
          type: "commandExecution",
          id: "call-1",
          command: "/bin/zsh -lc ls",
          cwd: "/tmp/worktree",
          status: "completed",
          commandActions: [{ type: "listFiles", command: "ls", path: null }],
          aggregatedOutput: "README.md\n",
          exitCode: 0,
          durationMs: 4,
        },
      },
    })).toEqual([
      {
        type: "messageUpsert",
        conversationId: "thread-1",
        message: {
          id: "call-1",
          turnId: "turn-1",
          role: "assistant",
          kind: "toolUse",
          toolName: "shell",
          toolCallId: "call-1",
          text: "ls",
          command: "/bin/zsh -lc ls",
          cwd: "/tmp/worktree",
          status: "completed",
          createdAt: "2026-05-28T10:50:41.194Z",
          exitCode: 0,
          durationMs: 4,
        },
      },
      {
        type: "messageUpsert",
        conversationId: "thread-1",
        message: {
          id: "call-1:result",
          turnId: "turn-1",
          role: "user",
          kind: "toolResult",
          toolName: "shell",
          toolCallId: "call-1",
          text: "README.md",
          command: "/bin/zsh -lc ls",
          cwd: "/tmp/worktree",
          status: "completed",
          createdAt: "2026-05-28T10:50:41.194Z",
          exitCode: 0,
          durationMs: 4,
        },
      },
    ]);
  });
});
