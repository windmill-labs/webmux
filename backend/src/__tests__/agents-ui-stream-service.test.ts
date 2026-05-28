import { describe, expect, it } from "bun:test";
import {
  AgentsConversationStreamSession,
  buildAgentsUiMessageDeltaEvent,
  buildAgentsUiMessageUpsertEvents,
  mergeConversationSnapshotWithLiveMessages,
  readAgentsNotificationThreadId,
  shouldRefreshAgentsConversationSnapshot,
} from "../services/agents-ui-stream-service";
import type { AgentsUiConversationEvent, AgentsUiWorktreeConversationResponse } from "../domain/agents-ui";

function makeSnapshot(overrides: Partial<AgentsUiWorktreeConversationResponse["conversation"]> = {}): AgentsUiWorktreeConversationResponse {
  return {
    worktree: {
      branch: "feature/chat",
      path: "/tmp/worktree",
      archived: false,
      profile: "default",
      agentName: "codex",
      agentLabel: "Codex",
      agentTerminalStale: false,
      mux: true,
      status: "idle",
      dirty: false,
      unpushed: false,
      services: [],
      prs: [],
      creating: false,
      creationPhase: null,
      conversation: {
        provider: "codexAppServer",
        conversationId: "thread-1",
        threadId: "thread-1",
        cwd: "/tmp/worktree",
        lastSeenAt: "2026-05-28T10:00:00.000Z",
      },
    },
    conversation: {
      provider: "codexAppServer",
      conversationId: "thread-1",
      cwd: "/tmp/worktree",
      running: false,
      activeTurnId: null,
      messages: [],
      ...overrides,
    },
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    if (predicate()) return;
    await Bun.sleep(1);
  }
  throw new Error("timed out waiting for condition");
}

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

  it("merges live stream messages into stale snapshots on the server side", () => {
    expect(mergeConversationSnapshotWithLiveMessages(makeSnapshot(), [
      {
        id: "assistant-1",
        turnId: "turn-1",
        role: "assistant",
        kind: "text",
        text: "Streaming status",
        status: "inProgress",
        createdAt: null,
      },
    ]).conversation).toEqual({
      provider: "codexAppServer",
      conversationId: "thread-1",
      cwd: "/tmp/worktree",
      running: true,
      activeTurnId: "turn-1",
      messages: [
        {
          id: "assistant-1",
          turnId: "turn-1",
          role: "assistant",
          kind: "text",
          text: "Streaming status",
          status: "inProgress",
          createdAt: null,
        },
      ],
    });
  });

  it("does not duplicate live messages already present in snapshots under a new item id", () => {
    expect(mergeConversationSnapshotWithLiveMessages(makeSnapshot({
      messages: [
        {
          id: "snapshot-assistant",
          turnId: "turn-1",
          role: "assistant",
          kind: "text",
          phase: "final_answer",
          text: "Good. The branch is in a clean committed state.",
          status: "completed",
          createdAt: "2026-05-28T10:50:41.194Z",
        },
      ],
    }), [
      {
        id: "live-assistant",
        turnId: "turn-1",
        role: "assistant",
        kind: "text",
        phase: "final_answer",
        text: "Good. The branch is in a clean committed state.",
        status: "completed",
        createdAt: "2026-05-28T10:50:41.194Z",
      },
    ]).conversation.messages).toEqual([
      {
        id: "snapshot-assistant",
        turnId: "turn-1",
        role: "assistant",
        kind: "text",
        phase: "final_answer",
        text: "Good. The branch is in a clean committed state.",
        status: "completed",
        createdAt: "2026-05-28T10:50:41.194Z",
      },
    ]);
  });

  it("does not keep running true when a completed snapshot has shorter text", () => {
    expect(mergeConversationSnapshotWithLiveMessages(makeSnapshot({
      messages: [
        {
          id: "assistant-1",
          turnId: "turn-1",
          role: "assistant",
          kind: "text",
          text: "Partial",
          status: "completed",
          createdAt: "2026-05-28T10:50:41.194Z",
        },
      ],
    }), [
      {
        id: "assistant-1",
        turnId: "turn-1",
        role: "assistant",
        kind: "text",
        text: "Partial answer",
        status: "inProgress",
        createdAt: null,
      },
    ]).conversation).toEqual({
      provider: "codexAppServer",
      conversationId: "thread-1",
      cwd: "/tmp/worktree",
      running: false,
      activeTurnId: null,
      messages: [
        {
          id: "assistant-1",
          turnId: "turn-1",
          role: "assistant",
          kind: "text",
          text: "Partial answer",
          status: "completed",
          createdAt: "2026-05-28T10:50:41.194Z",
        },
      ],
    });
  });

  it("adds revisions and includes live deltas in refresh snapshots", async () => {
    const events: AgentsUiConversationEvent[] = [];
    const session = new AgentsConversationStreamSession({
      conversationId: "thread-1",
      loadSnapshot: async () => ({ ok: true, data: makeSnapshot() }),
      send: (event) => events.push(event),
    });

    session.sendSnapshot(makeSnapshot());
    session.handleNotification({
      method: "item/started",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        startedAtMs: 1779965441194,
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
        delta: "Streaming status",
      },
    });
    session.handleNotification({
      method: "turn/completed",
      params: {
        threadId: "thread-1",
      },
    });

    await waitFor(() => events.length === 4);

    expect(events.map((event) => event.type === "error" ? null : event.revision)).toEqual([1, 2, 3, 4]);
    expect(events.at(-1)).toEqual({
      type: "snapshot",
      revision: 4,
      data: makeSnapshot({
        running: false,
        activeTurnId: null,
        messages: [
          {
            id: "assistant-1",
            turnId: "turn-1",
            role: "assistant",
            kind: "text",
            phase: "commentary",
            text: "Streaming status",
            status: "completed",
            createdAt: "2026-05-28T10:50:41.194Z",
          },
        ],
      }),
    });
  });

  it("serializes overlapping snapshot refreshes", async () => {
    const events: AgentsUiConversationEvent[] = [];
    let resolveFirstRefresh: (value: { ok: true; data: AgentsUiWorktreeConversationResponse }) => void = () => {
      throw new Error("first refresh promise was not created");
    };
    let refreshCount = 0;
    const session = new AgentsConversationStreamSession({
      conversationId: "thread-1",
      loadSnapshot: () => {
        refreshCount += 1;
        if (refreshCount === 1) {
          return new Promise<{ ok: true; data: AgentsUiWorktreeConversationResponse }>((resolve) => {
            resolveFirstRefresh = resolve;
          });
        }
        return Promise.resolve({ ok: true, data: makeSnapshot() });
      },
      send: (event) => events.push(event),
    });

    session.handleNotification({ method: "turn/completed", params: { threadId: "thread-1" } });
    session.handleNotification({ method: "thread/status/changed", params: { threadId: "thread-1" } });

    expect(refreshCount).toBe(1);
    resolveFirstRefresh({ ok: true, data: makeSnapshot() });
    await waitFor(() => refreshCount === 2 && events.length === 2);

    expect(events.map((event) => event.type === "error" ? null : event.revision)).toEqual([1, 2]);
  });

  it("does not keep running true after an authoritative completed snapshot", async () => {
    const events: AgentsUiConversationEvent[] = [];
    const session = new AgentsConversationStreamSession({
      conversationId: "thread-1",
      loadSnapshot: async () => ({ ok: true, data: makeSnapshot() }),
      send: (event) => events.push(event),
    });

    session.handleNotification({
      method: "item/agentMessage/delta",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "assistant-1",
        delta: "Partial answer",
      },
    });
    session.handleNotification({
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
      },
    });

    await waitFor(() => events.length === 2);

    expect(events.at(-1)).toEqual({
      type: "snapshot",
      revision: 2,
      data: makeSnapshot({
        running: false,
        activeTurnId: null,
        messages: [
          {
            id: "assistant-1",
            turnId: "turn-1",
            role: "assistant",
            kind: "text",
            text: "Partial answer",
            status: "completed",
            createdAt: null,
          },
        ],
      }),
    });
  });

  it("drops unmatched in-progress live messages when a later snapshot is not running", () => {
    const events: AgentsUiConversationEvent[] = [];
    const session = new AgentsConversationStreamSession({
      conversationId: "thread-1",
      loadSnapshot: async () => ({ ok: true, data: makeSnapshot() }),
      send: (event) => events.push(event),
    });

    session.handleNotification({
      method: "item/agentMessage/delta",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "assistant-1",
        delta: "Partial answer",
      },
    });
    session.sendSnapshot(makeSnapshot());

    expect(events.at(-1)).toEqual({
      type: "snapshot",
      revision: 2,
      data: makeSnapshot(),
    });
  });
});
