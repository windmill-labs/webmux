import { describe, expect, it } from "bun:test";
import type {
  ClaudeCliGateway,
  ClaudeCliRunCallbacks,
  ClaudeCliRunHandle,
} from "../adapters/claude-cli";
import type { AgentsUiConversationEvent } from "../domain/agents-ui";
import { AgentsConversationStreamSession } from "../services/agents-ui-stream-service";
import { ClaudeConversationStreamService } from "../services/claude-conversation-stream-service";

class FakeClaudeCliGateway implements Pick<ClaudeCliGateway, "sendMessage"> {
  callbacks: ClaudeCliRunCallbacks | null = null;
  params: Parameters<ClaudeCliGateway["sendMessage"]>[0] | null = null;
  interrupted = false;

  sendMessage(
    params: Parameters<ClaudeCliGateway["sendMessage"]>[0],
    callbacks: ClaudeCliRunCallbacks,
  ): ClaudeCliRunHandle {
    this.params = params;
    this.callbacks = callbacks;
    return {
      completion: Promise.resolve(),
      interrupt: () => {
        this.interrupted = true;
      },
      sessionId: Promise.resolve(params.sessionId ?? params.resumeSessionId ?? "session-1"),
    };
  }
}

function makeSession(events: AgentsUiConversationEvent[], nextOrder = 0): AgentsConversationStreamSession {
  return new AgentsConversationStreamSession({
    conversationId: "session-1",
    nextOrder,
    send: (event) => events.push(event),
  });
}

describe("ClaudeConversationStreamService", () => {
  it("starts new Claude runs with a fixed session id and streams ordered live events", () => {
    const claude = new FakeClaudeCliGateway();
    const service = new ClaudeConversationStreamService({ claude });
    const events: AgentsUiConversationEvent[] = [];
    const session = makeSession(events);
    service.subscribe("session-1", session);

    expect(service.startRun({
      conversationId: "session-1",
      turnId: "claude-turn:turn-1",
      cwd: "/tmp/worktree",
      prompt: "Ship it",
      sessionId: "session-1",
      permissionMode: "bypassPermissions",
    })).toEqual({ ok: true });
    expect(claude.params).toMatchObject({
      cwd: "/tmp/worktree",
      prompt: "Ship it",
      sessionId: "session-1",
      permissionMode: "bypassPermissions",
    });

    claude.callbacks?.onAssistantDelta?.("Hel", { itemId: "msg_1:0" });
    claude.callbacks?.onAssistantDelta?.("lo", { itemId: "msg_1:0" });
    claude.callbacks?.onMessage?.({
      id: "msg_1:0",
      role: "assistant",
      kind: "text",
      text: "Hello",
      createdAt: null,
    });
    claude.callbacks?.onComplete?.("session-1");

    expect(events.map((event) => event.type)).toEqual([
      "conversationStatus",
      "messageUpsert",
      "messageDelta",
      "messageDelta",
      "messageUpsert",
      "messageUpsert",
      "conversationStatus",
    ]);
    expect(events[0]).toMatchObject({
      type: "conversationStatus",
      conversationId: "session-1",
      running: true,
      activeTurnId: "claude-turn:turn-1",
    });
    expect(events[1]).toMatchObject({
      type: "messageUpsert",
      conversationId: "session-1",
      message: {
        id: "claude-user:claude-turn:turn-1",
        order: 0,
        role: "user",
        text: "Ship it",
        status: "completed",
      },
    });
    expect(events[2]).toMatchObject({
      type: "messageDelta",
      itemId: "msg_1:0",
      order: 1,
      delta: "Hel",
    });
    expect(events[4]).toMatchObject({
      type: "messageUpsert",
      conversationId: "session-1",
      message: {
        id: "msg_1:0",
        turnId: "claude-turn:turn-1",
        order: 1,
        role: "assistant",
        kind: "text",
        text: "Hello",
        status: "inProgress",
        createdAt: null,
      },
    });
    expect(events[5]).toMatchObject({
      type: "messageUpsert",
      message: {
        id: "msg_1:0",
        order: 1,
        status: "completed",
      },
    });
    expect(events[6]).toMatchObject({
      type: "conversationStatus",
      conversationId: "session-1",
      running: false,
      activeTurnId: null,
    });
  });

  it("resumes existing Claude sessions and interrupts active runs", () => {
    const claude = new FakeClaudeCliGateway();
    const service = new ClaudeConversationStreamService({ claude });

    expect(service.startRun({
      conversationId: "session-1",
      turnId: "claude-turn:turn-1",
      cwd: "/tmp/worktree",
      prompt: "Continue",
      resumeSessionId: "session-1",
    })).toEqual({ ok: true });
    expect(claude.params).toMatchObject({
      resumeSessionId: "session-1",
    });

    expect(service.interrupt("session-1")).toEqual({
      ok: true,
      turnId: "claude-turn:turn-1",
    });
    expect(claude.interrupted).toBe(true);
  });

  it("marks in-progress Claude live messages failed when the run errors", () => {
    const claude = new FakeClaudeCliGateway();
    const service = new ClaudeConversationStreamService({ claude });
    const events: AgentsUiConversationEvent[] = [];
    service.subscribe("session-1", makeSession(events));

    expect(service.startRun({
      conversationId: "session-1",
      turnId: "claude-turn:turn-1",
      cwd: "/tmp/worktree",
      prompt: "Ship it",
      sessionId: "session-1",
    })).toEqual({ ok: true });

    claude.callbacks?.onAssistantDelta?.("Partial response", { itemId: "msg_1:0" });
    claude.callbacks?.onError?.("API key is invalid");

    expect(events.map((event) => event.type)).toEqual([
      "conversationStatus",
      "messageUpsert",
      "messageDelta",
      "messageUpsert",
      "conversationStatus",
      "error",
    ]);
    expect(events[3]).toMatchObject({
      type: "messageUpsert",
      message: {
        id: "msg_1:0",
        order: 1,
        text: "Partial response",
        status: "failed",
      },
    });
    expect(events[4]).toMatchObject({
      type: "conversationStatus",
      running: false,
      activeTurnId: null,
    });
    expect(events[5]).toEqual({
      type: "error",
      message: "API key is invalid",
    });
  });

  it("replays active Claude live messages to late subscribers without sending snapshots", () => {
    const claude = new FakeClaudeCliGateway();
    const service = new ClaudeConversationStreamService({ claude });

    expect(service.startRun({
      conversationId: "session-1",
      turnId: "claude-turn:turn-1",
      cwd: "/tmp/worktree",
      prompt: "Ship it",
      sessionId: "session-1",
    })).toEqual({ ok: true });

    claude.callbacks?.onAssistantDelta?.("Hello", { itemId: "msg_1:0" });
    claude.callbacks?.onMessage?.({
      id: "msg_1:0",
      role: "assistant",
      kind: "text",
      text: "Hello",
      createdAt: null,
    });

    const events: AgentsUiConversationEvent[] = [];
    service.subscribe("session-1", makeSession(events, 3));

    expect(events.map((event) => event.type)).toEqual([
      "conversationStatus",
      "messageUpsert",
      "messageUpsert",
    ]);
    expect(events[1]).toMatchObject({
      type: "messageUpsert",
      message: {
        id: "claude-user:claude-turn:turn-1",
        order: 3,
        text: "Ship it",
      },
    });
    expect(events[2]).toMatchObject({
      type: "messageUpsert",
      message: {
        id: "msg_1:0",
        order: 4,
        text: "Hello",
      },
    });
  });

  it("replays retained completed Claude live messages to late subscribers", () => {
    const claude = new FakeClaudeCliGateway();
    const service = new ClaudeConversationStreamService({ claude });

    expect(service.startRun({
      conversationId: "session-1",
      turnId: "claude-turn:turn-1",
      cwd: "/tmp/worktree",
      prompt: "Ship it",
      sessionId: "session-1",
    })).toEqual({ ok: true });

    claude.callbacks?.onAssistantDelta?.("Done", { itemId: "msg_1:0" });
    claude.callbacks?.onMessage?.({
      id: "msg_1:0",
      role: "assistant",
      kind: "text",
      text: "Done",
      createdAt: null,
    });
    claude.callbacks?.onComplete?.("session-1");

    const events: AgentsUiConversationEvent[] = [];
    service.subscribe("session-1", makeSession(events, 2));

    expect(events.map((event) => event.type)).toEqual([
      "messageUpsert",
      "messageUpsert",
      "conversationStatus",
    ]);
    expect(events[1]).toMatchObject({
      type: "messageUpsert",
      message: {
        id: "msg_1:0",
        order: 3,
        text: "Done",
        status: "completed",
      },
    });
    expect(events[2]).toMatchObject({
      type: "conversationStatus",
      running: false,
      activeTurnId: null,
    });
  });
});
