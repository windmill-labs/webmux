import type {
  ClaudeCliGateway,
  ClaudeCliRunHandle,
  ClaudeCliStreamMessage,
} from "../adapters/claude-cli";
import type { AgentsUiConversationMessageDraft } from "./agents-ui-stream-service";
import {
  AgentsConversationStreamSession,
  type AgentsUiConversationMessageDeltaLivePayload,
  type AgentsUiConversationMessageUpsertLivePayload,
} from "./agents-ui-stream-service";

export interface ClaudeConversationStreamRunInput {
  conversationId: string;
  turnId: string;
  cwd: string;
  prompt: string;
  env?: Record<string, string>;
  permissionMode?: "bypassPermissions" | null;
  resumeSessionId?: string | null;
  sessionId?: string | null;
  systemPrompt?: string | null;
}

interface ActiveClaudeRun {
  conversationId: string;
  turnId: string;
  handle: ClaudeCliRunHandle | null;
  liveMessages: Map<string, AgentsUiConversationMessageDraft>;
  completed: boolean;
  pruneTimer: ReturnType<typeof setTimeout> | null;
}

export interface ClaudeConversationStreamServiceDependencies {
  claude: Pick<ClaudeCliGateway, "sendMessage">;
}

const COMPLETED_RUN_RETENTION_MS = 30_000;

export class ClaudeConversationStreamService {
  private readonly runs = new Map<string, ActiveClaudeRun>();
  private readonly subscribers = new Map<string, Set<AgentsConversationStreamSession>>();

  constructor(private readonly deps: ClaudeConversationStreamServiceDependencies) {}

  hasActiveRun(conversationId: string): boolean {
    return this.runs.get(conversationId)?.completed === false;
  }

  activeTurnId(conversationId: string): string | null {
    const run = this.runs.get(conversationId);
    return run?.completed === false ? run.turnId : null;
  }

  startRun(input: ClaudeConversationStreamRunInput): { ok: true } | { ok: false; error: string } {
    if (this.hasActiveRun(input.conversationId)) {
      return {
        ok: false,
        error: "Claude is already responding in this conversation",
      };
    }

    const existing = this.runs.get(input.conversationId);
    if (existing?.pruneTimer) {
      clearTimeout(existing.pruneTimer);
    }

    const run: ActiveClaudeRun = {
      conversationId: input.conversationId,
      turnId: input.turnId,
      handle: null,
      liveMessages: new Map(),
      completed: false,
      pruneTimer: null,
    };
    this.runs.set(input.conversationId, run);

    try {
      const handle = this.deps.claude.sendMessage({
        cwd: input.cwd,
        prompt: input.prompt,
        ...(input.env ? { env: input.env } : {}),
        ...(input.permissionMode ? { permissionMode: input.permissionMode } : {}),
        ...(input.resumeSessionId ? { resumeSessionId: input.resumeSessionId } : {}),
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}),
      }, {
        onAssistantDelta: (delta, event) => {
          this.notifyDelta(run, event.itemId, delta);
        },
        onComplete: () => {
          this.finishRun(run, "completed");
        },
        onError: (message) => {
          this.failRun(run, message);
        },
        onMessage: (message) => {
          this.notifyMessage(run, message);
        },
      });
      run.handle = handle;
      this.notifyStatus(run, true);
      this.notifyUserMessage(run, input.prompt);
      void handle.completion.finally(() => {
        if (!run.completed) {
          this.finishRun(run, "completed");
        }
      });
      return { ok: true };
    } catch (error) {
      this.runs.delete(input.conversationId);
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  interrupt(conversationId: string): { ok: true; turnId: string } | { ok: false; error: string } {
    const run = this.runs.get(conversationId);
    if (!run || run.completed || !run.handle) {
      return {
        ok: false,
        error: "No active Claude response to interrupt",
      };
    }

    run.handle.interrupt();
    this.finishRun(run, "completed");
    return {
      ok: true,
      turnId: run.turnId,
    };
  }

  subscribe(conversationId: string, session: AgentsConversationStreamSession): () => void {
    const current = this.subscribers.get(conversationId) ?? new Set<AgentsConversationStreamSession>();
    current.add(session);
    this.subscribers.set(conversationId, current);

    const run = this.runs.get(conversationId);
    if (run) {
      if (!run.completed) {
        session.handleConversationStatus({
          type: "conversationStatus",
          conversationId,
          running: true,
          activeTurnId: run.turnId,
        });
      }
      for (const [id, message] of run.liveMessages) {
        session.handleLiveMessageUpsert({
          type: "messageUpsert",
          conversationId,
          message,
        }, id);
      }
      if (run.completed) {
        session.handleConversationStatus({
          type: "conversationStatus",
          conversationId,
          running: false,
          activeTurnId: null,
        });
      }
    }

    return () => {
      current.delete(session);
      if (current.size === 0) {
        this.subscribers.delete(conversationId);
      }
    };
  }

  private notifyStatus(run: ActiveClaudeRun, running: boolean): void {
    for (const subscriber of this.subscribers.get(run.conversationId) ?? []) {
      subscriber.handleConversationStatus({
        type: "conversationStatus",
        conversationId: run.conversationId,
        running,
        activeTurnId: running ? run.turnId : null,
      });
    }
  }

  private notifyUserMessage(run: ActiveClaudeRun, prompt: string): void {
    const message: AgentsUiConversationMessageDraft = {
      id: `claude-user:${run.turnId}`,
      turnId: run.turnId,
      role: "user",
      kind: "text",
      text: prompt,
      status: "completed",
      createdAt: null,
    };
    run.liveMessages.set(message.id, message);
    this.broadcastUpsert(run, message, message.id);
  }

  private notifyDelta(run: ActiveClaudeRun, itemId: string, delta: string): void {
    if (run.completed) return;
    const event: AgentsUiConversationMessageDeltaLivePayload = {
      type: "messageDelta",
      conversationId: run.conversationId,
      turnId: run.turnId,
      itemId,
      delta,
    };

    this.applyDelta(run, event);
    for (const subscriber of this.subscribers.get(run.conversationId) ?? []) {
      subscriber.handleLiveMessageDelta(event);
    }
  }

  private notifyMessage(run: ActiveClaudeRun, streamMessage: ClaudeCliStreamMessage): void {
    if (run.completed) return;

    // `streamMessage.id` is the stable `${messageId}:${blockIndex}` /
    // `tool_result:${toolCallId}` key — the same key the deltas use — so a
    // finalized block simply overwrites its streaming placeholder by id.
    const message: AgentsUiConversationMessageDraft = {
      id: streamMessage.id,
      turnId: run.turnId,
      role: streamMessage.role,
      kind: streamMessage.kind,
      text: streamMessage.text,
      status: "inProgress",
      createdAt: streamMessage.createdAt,
      ...(streamMessage.toolName ? { toolName: streamMessage.toolName } : {}),
      ...(streamMessage.toolCallId ? { toolCallId: streamMessage.toolCallId } : {}),
    };
    run.liveMessages.set(message.id, message);
    this.broadcastUpsert(run, message, message.id);
  }

  private finishRun(run: ActiveClaudeRun, status: "completed" | "failed"): void {
    if (run.completed) return;
    run.completed = true;

    for (const [id, message] of run.liveMessages) {
      if (message.status !== "inProgress") continue;
      const completedMessage = {
        ...message,
        status,
      };
      run.liveMessages.set(id, completedMessage);
      this.broadcastUpsert(run, completedMessage, id);
    }

    this.notifyStatus(run, false);

    run.pruneTimer = setTimeout(() => {
      const current = this.runs.get(run.conversationId);
      if (current === run) {
        this.runs.delete(run.conversationId);
      }
    }, COMPLETED_RUN_RETENTION_MS);
  }

  private failRun(run: ActiveClaudeRun, message: string): void {
    this.finishRun(run, "failed");
    for (const subscriber of this.subscribers.get(run.conversationId) ?? []) {
      subscriber.sendError(message);
    }
  }

  private broadcastUpsert(
    run: ActiveClaudeRun,
    message: AgentsUiConversationMessageDraft,
    orderKey: string,
  ): void {
    const event: AgentsUiConversationMessageUpsertLivePayload = {
      type: "messageUpsert",
      conversationId: run.conversationId,
      message,
    };

    for (const subscriber of this.subscribers.get(run.conversationId) ?? []) {
      subscriber.handleLiveMessageUpsert(event, orderKey);
    }
  }

  private applyDelta(run: ActiveClaudeRun, event: AgentsUiConversationMessageDeltaLivePayload): void {
    const existing = run.liveMessages.get(event.itemId);
    run.liveMessages.set(event.itemId, {
      id: event.itemId,
      turnId: event.turnId,
      role: "assistant",
      kind: existing?.kind ?? "text",
      text: `${existing?.text ?? ""}${event.delta}`,
      status: "inProgress",
      createdAt: existing?.createdAt ?? null,
    });
  }
}
