import { describe, expect, it } from "bun:test";
import {
  AgentsConversationStreamSession,
  buildAgentsUiConversationStatusEvent,
  buildAgentsUiMessageDeltaEvent,
  buildAgentsUiMessageUpsertEvents,
  readAgentsNotificationThreadId,
} from "../services/agents-ui-stream-service";
import type { AgentsUiConversationEvent } from "../domain/agents-ui";

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
    }, 7)).toEqual({
      type: "messageDelta",
      conversationId: "thread-1",
      turnId: "turn-1",
      itemId: "item-1",
      order: 7,
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
    }, 3)).toEqual([
      {
        type: "messageUpsert",
        conversationId: "thread-1",
        message: {
          id: "commentary-1",
          turnId: "turn-1",
          order: 3,
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
    }, 4)).toEqual([
      {
        type: "messageUpsert",
        conversationId: "thread-1",
        message: {
          id: "call-1",
          turnId: "turn-1",
          order: 4,
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
          order: 5,
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

  it("builds upsert events from mcp tool call notifications", () => {
    expect(buildAgentsUiMessageUpsertEvents({
      method: "item/completed",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        completedAtMs: 1779965441194,
        item: {
          type: "mcpToolCall",
          id: "mcp-1",
          server: "linear",
          tool: "get_issue",
          status: "completed",
          arguments: { issueId: "ENG-123" },
          pluginId: null,
          result: {
            content: [{ type: "text", text: "Issue title" }],
            structuredContent: null,
            _meta: null,
          },
          error: null,
          durationMs: 25,
        },
      },
    }, 4)).toEqual([
      {
        type: "messageUpsert",
        conversationId: "thread-1",
        message: {
          id: "mcp-1",
          turnId: "turn-1",
          order: 4,
          role: "assistant",
          kind: "toolUse",
          toolName: "linear.get_issue",
          toolCallId: "mcp-1",
          text: "{\n  \"issueId\": \"ENG-123\"\n}",
          status: "completed",
          createdAt: "2026-05-28T10:50:41.194Z",
          durationMs: 25,
        },
      },
      {
        type: "messageUpsert",
        conversationId: "thread-1",
        message: {
          id: "mcp-1:result",
          turnId: "turn-1",
          order: 5,
          role: "user",
          kind: "toolResult",
          toolName: "linear.get_issue",
          toolCallId: "mcp-1",
          text: "Issue title",
          status: "completed",
          createdAt: "2026-05-28T10:50:41.194Z",
          durationMs: 25,
        },
      },
    ]);
  });

  it("builds conversation status events from turn lifecycle notifications", () => {
    expect(buildAgentsUiConversationStatusEvent({
      method: "turn/started",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
      },
    })).toEqual({
      type: "conversationStatus",
      conversationId: "thread-1",
      running: true,
      activeTurnId: "turn-1",
    });

    expect(buildAgentsUiConversationStatusEvent({
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
      },
    })).toEqual({
      type: "conversationStatus",
      conversationId: "thread-1",
      running: false,
      activeTurnId: null,
    });
  });

  it("builds terminal conversation status events from thread status notifications", () => {
    expect(buildAgentsUiConversationStatusEvent({
      method: "thread/status/changed",
      params: {
        threadId: "thread-1",
        status: {
          type: "systemError",
        },
      },
    })).toEqual({
      type: "conversationStatus",
      conversationId: "thread-1",
      running: false,
      activeTurnId: null,
    });

    expect(buildAgentsUiConversationStatusEvent({
      method: "thread/status/changed",
      params: {
        threadId: "thread-1",
        status: {
          type: "active",
        },
      },
    })).toBeNull();
  });

  it("streams live events without emitting snapshots", () => {
    const events: AgentsUiConversationEvent[] = [];
    const session = new AgentsConversationStreamSession({
      conversationId: "thread-1",
      nextOrder: 2,
      send: (event) => events.push(event),
    });

    session.handleNotification({
      method: "item/started",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        startedAtMs: 1779965441194,
        item: {
          type: "userMessage",
          id: "user-1",
          content: [{ type: "text", text: "Ship it" }],
        },
      },
    });
    session.handleNotification({
      method: "item/started",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        startedAtMs: 1779965441195,
        item: {
          type: "agentMessage",
          id: "assistant-1",
          text: "",
          phase: "commentary",
          memoryCitation: null,
        },
      },
    });
    session.handleNotification({
      method: "item/agentMessage/delta",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "assistant-1",
        delta: "Working",
      },
    });

    expect(events.map((event) => event.type)).toEqual(["messageUpsert", "messageUpsert", "messageDelta"]);
    expect(events.map((event) => event.type === "error" ? null : event.revision)).toEqual([1, 2, 3]);
    expect(events[0]).toMatchObject({ type: "messageUpsert", message: { id: "user-1", order: 2 } });
    expect(events[1]).toMatchObject({ type: "messageUpsert", message: { id: "assistant-1", order: 3 } });
    expect(events[2]).toMatchObject({ type: "messageDelta", itemId: "assistant-1", order: 3 });
  });

  it("streams conversation status without replacing the transcript", () => {
    const events: AgentsUiConversationEvent[] = [];
    const session = new AgentsConversationStreamSession({
      conversationId: "thread-1",
      nextOrder: 0,
      send: (event) => events.push(event),
    });

    session.handleNotification({
      method: "turn/started",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
      },
    });
    session.handleNotification({
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
      },
    });

    expect(events).toEqual([
      {
        type: "conversationStatus",
        revision: 1,
        conversationId: "thread-1",
        running: true,
        activeTurnId: "turn-1",
      },
      {
        type: "conversationStatus",
        revision: 2,
        conversationId: "thread-1",
        running: false,
        activeTurnId: null,
      },
    ]);
  });

  it("ignores unsupported item notifications without consuming visible order", () => {
    const events: AgentsUiConversationEvent[] = [];
    const session = new AgentsConversationStreamSession({
      conversationId: "thread-1",
      nextOrder: 4,
      send: (event) => events.push(event),
    });

    session.handleNotification({
      method: "item/started",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        startedAtMs: 1779965441194,
        item: {
          type: "reasoning",
          id: "reasoning-1",
        },
      },
    });
    session.handleNotification({
      method: "item/started",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        startedAtMs: 1779965441195,
        item: {
          type: "agentMessage",
          id: "assistant-1",
          text: "",
          phase: "commentary",
          memoryCitation: null,
        },
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "messageUpsert", message: { id: "assistant-1", order: 4 } });
  });

  it("reserves one order for text items and two for command executions", () => {
    const events: AgentsUiConversationEvent[] = [];
    const session = new AgentsConversationStreamSession({
      conversationId: "thread-1",
      nextOrder: 4,
      send: (event) => events.push(event),
    });

    session.handleNotification({
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
    });
    session.handleNotification({
      method: "item/started",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        startedAtMs: 1779965441195,
        item: {
          type: "agentMessage",
          id: "assistant-1",
          text: "",
          phase: "commentary",
          memoryCitation: null,
        },
      },
    });

    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ type: "messageUpsert", message: { id: "call-1", order: 4 } });
    expect(events[1]).toMatchObject({ type: "messageUpsert", message: { id: "call-1:result", order: 5 } });
    expect(events[2]).toMatchObject({ type: "messageUpsert", message: { id: "assistant-1", order: 6 } });
  });

  it("keeps delta and upsert order stable for the same item", () => {
    const events: AgentsUiConversationEvent[] = [];
    const session = new AgentsConversationStreamSession({
      conversationId: "thread-1",
      nextOrder: 7,
      send: (event) => events.push(event),
    });

    session.handleNotification({
      method: "item/agentMessage/delta",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "assistant-1",
        delta: "Partial",
      },
    });
    session.handleNotification({
      method: "item/completed",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        completedAtMs: 1779965441194,
        item: {
          type: "agentMessage",
          id: "assistant-1",
          text: "Final",
          phase: "final_answer",
          memoryCitation: null,
        },
      },
    });

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: "messageDelta", itemId: "assistant-1", order: 7 });
    expect(events[1]).toMatchObject({
      type: "messageUpsert",
      message: {
        id: "assistant-1",
        order: 7,
        text: "Final",
        status: "completed",
      },
    });
  });

  it("ignores notifications for other threads", () => {
    const events: AgentsUiConversationEvent[] = [];
    const session = new AgentsConversationStreamSession({
      conversationId: "thread-1",
      nextOrder: 0,
      send: (event) => events.push(event),
    });

    session.handleNotification({
      method: "item/agentMessage/delta",
      params: {
        threadId: "thread-2",
        turnId: "turn-1",
        itemId: "assistant-1",
        delta: "Wrong thread",
      },
    });

    expect(events).toEqual([]);
  });
});
