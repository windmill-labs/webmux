import { parseCodexAppServerThreadItem, type CodexAppServerNotification } from "../adapters/codex-app-server";
import type {
  AgentsUiConversationErrorEvent,
  AgentsUiConversationEvent,
  AgentsUiConversationMessage,
  AgentsUiConversationMessageDeltaEvent,
  AgentsUiConversationMessageUpsertEvent,
  AgentsUiWorktreeConversationResponse,
} from "../domain/agents-ui";
import { isRecord } from "../lib/type-guards";
import { buildCodexItemConversationMessages } from "./worktree-conversation-service";

type AgentsUiConversationMessageDeltaPayload = Omit<AgentsUiConversationMessageDeltaEvent, "revision">;
type AgentsUiConversationMessageUpsertPayload = Omit<AgentsUiConversationMessageUpsertEvent, "revision">;
type ConversationSnapshotLoader = () => Promise<{
  ok: true;
  data: AgentsUiWorktreeConversationResponse;
} | {
  ok: false;
  message: string;
}>;
const CODEX_ITEM_ORDER_SPAN = 2;

function readNotificationParams(raw: unknown): Record<string, unknown> | null {
  return isRecord(raw) ? raw : null;
}

function readThreadId(raw: unknown): string | null {
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

function readNotificationItemType(raw: unknown): string | null {
  if (!isRecord(raw)) return null;
  return typeof raw.type === "string" ? raw.type : null;
}

function readNumber(raw: unknown): number | null {
  return typeof raw === "number" ? raw : null;
}

function toIsoTimestampMs(epochMs: number | null): string | null {
  if (epochMs === null) return null;
  return new Date(epochMs).toISOString();
}

function compareMessagesByOrder(left: AgentsUiConversationMessage, right: AgentsUiConversationMessage): number {
  return left.order - right.order;
}

function sortMessages(messages: AgentsUiConversationMessage[]): AgentsUiConversationMessage[] {
  return [...messages].sort(compareMessagesByOrder);
}

export function readAgentsNotificationThreadId(notification: CodexAppServerNotification): string | null {
  const params = readNotificationParams(notification.params);
  if (!params) return null;
  return readThreadId(params.threadId);
}

export function buildAgentsUiMessageDeltaEvent(
  notification: CodexAppServerNotification,
  order: number,
): AgentsUiConversationMessageDeltaPayload | null {
  if (notification.method !== "item/agentMessage/delta") return null;

  const params = readNotificationParams(notification.params);
  if (!params) return null;

  const threadId = readThreadId(params.threadId);
  const turnId = readThreadId(params.turnId);
  const itemId = readThreadId(params.itemId);
  const delta = typeof params.delta === "string" ? params.delta : null;

  if (!threadId || !turnId || !itemId || delta === null) return null;

  return {
    type: "messageDelta",
    conversationId: threadId,
    turnId,
    itemId,
    order,
    delta,
  };
}

export function buildAgentsUiMessageUpsertEvents(
  notification: CodexAppServerNotification,
  order: number,
): AgentsUiConversationMessageUpsertPayload[] {
  if (notification.method !== "item/started" && notification.method !== "item/completed") return [];

  const params = readNotificationParams(notification.params);
  if (!params) return [];

  const threadId = readThreadId(params.threadId);
  const turnId = readThreadId(params.turnId);
  if (!threadId || !turnId) return [];

  const item = parseCodexAppServerThreadItem(params.item);
  if (!item) return [];

  const createdAt = toIsoTimestampMs(
    notification.method === "item/started"
      ? readNumber(params.startedAtMs)
      : readNumber(params.completedAtMs),
  );

  return buildCodexItemConversationMessages({
    item,
    turnId,
    turnStatus: notification.method === "item/started" ? "inProgress" : "completed",
    createdAt,
    order,
    includeEmptyText: true,
  }).map((message) => ({
    type: "messageUpsert",
    conversationId: threadId,
    message,
  }));
}

export function mergeConversationSnapshotWithLiveMessages(
  snapshot: AgentsUiWorktreeConversationResponse,
  liveMessages: AgentsUiConversationMessage[],
): AgentsUiWorktreeConversationResponse {
  if (liveMessages.length === 0) return snapshot;

  const liveById = new Map(liveMessages.map((message) => [message.id, message]));
  const seen = new Set<string>();
  const messages = snapshot.conversation.messages.map((snapshotMessage) => {
    const liveMessage = liveById.get(snapshotMessage.id);
    if (!liveMessage) return snapshotMessage;
    seen.add(snapshotMessage.id);
    return snapshotMessage.status === "inProgress" ? liveMessage : snapshotMessage;
  });

  if (snapshot.conversation.running) {
    for (const liveMessage of liveMessages) {
      if (!seen.has(liveMessage.id)) messages.push(liveMessage);
    }
  }

  const sortedMessages = sortMessages(messages);
  const inProgress = sortedMessages.find((message) => message.status === "inProgress") ?? null;
  return {
    ...snapshot,
    conversation: {
      ...snapshot.conversation,
      running: snapshot.conversation.running || inProgress !== null,
      activeTurnId: snapshot.conversation.activeTurnId ?? inProgress?.turnId ?? null,
      messages: sortedMessages,
    },
  };
}

export class AgentsConversationStreamSession {
  private revision = 0;
  private conversationId: string;
  private closed = false;
  private refreshInFlight = false;
  private refreshQueued = false;
  private nextLiveOrder = 0;
  private readonly liveMessages = new Map<string, AgentsUiConversationMessage>();

  constructor(
    private readonly deps: {
      conversationId: string;
      loadSnapshot: ConversationSnapshotLoader;
      send: (event: AgentsUiConversationEvent) => void;
    },
  ) {
    this.conversationId = deps.conversationId;
  }

  currentConversationId(): string {
    return this.conversationId;
  }

  close(): void {
    this.closed = true;
  }

  sendSnapshot(snapshot: AgentsUiWorktreeConversationResponse): void {
    if (this.closed) return;
    this.conversationId = snapshot.conversation.conversationId;
    this.syncNextLiveOrder(snapshot.conversation.messages);

    const data = mergeConversationSnapshotWithLiveMessages(snapshot, [...this.liveMessages.values()]);
    const snapshotById = new Map(snapshot.conversation.messages.map((message) => [message.id, message]));
    for (const [messageId, message] of this.liveMessages) {
      const snapshotMessage = snapshotById.get(messageId);
      const completedInSnapshot = snapshotMessage?.status !== "inProgress" && message.status !== "inProgress";
      if (!data.conversation.running || (snapshotMessage !== undefined && completedInSnapshot)) {
        this.liveMessages.delete(messageId);
      }
    }

    this.deps.send({
      type: "snapshot",
      revision: this.nextRevision(),
      data,
    });
  }

  handleNotification(notification: CodexAppServerNotification): void {
    if (this.closed) return;

    const notificationThreadId = readAgentsNotificationThreadId(notification);
    if (!notificationThreadId || notificationThreadId !== this.conversationId) return;

    const deltaOrder = this.orderForDeltaNotification(notification);
    const deltaEvent = deltaOrder === null ? null : buildAgentsUiMessageDeltaEvent(notification, deltaOrder);
    if (deltaEvent) {
      this.applyDelta(deltaEvent);
      this.deps.send({
        ...deltaEvent,
        revision: this.nextRevision(),
      });
      return;
    }

    const upsertOrder = this.orderForUpsertNotification(notification);
    if (upsertOrder !== null) {
      for (const upsertEvent of buildAgentsUiMessageUpsertEvents(notification, upsertOrder)) {
        const message = this.applyUpsert(upsertEvent.message);
        this.deps.send({
          ...upsertEvent,
          message,
          revision: this.nextRevision(),
        });
      }
    }

    if (shouldRefreshAgentsConversationSnapshot(notification)) {
      this.queueSnapshotRefresh();
    }
  }

  private nextRevision(): number {
    this.revision += 1;
    return this.revision;
  }

  private syncNextLiveOrder(messages: AgentsUiConversationMessage[]): void {
    for (const message of messages) {
      this.nextLiveOrder = Math.max(this.nextLiveOrder, message.order + 1);
    }
  }

  private reserveOrder(itemId: string, span: number): number {
    const existing = this.liveMessages.get(itemId);
    if (existing) return existing.order;

    const order = this.nextLiveOrder;
    this.nextLiveOrder += span;
    return order;
  }

  private orderForDeltaNotification(notification: CodexAppServerNotification): number | null {
    if (notification.method !== "item/agentMessage/delta") return null;
    const params = readNotificationParams(notification.params);
    if (!params) return null;
    const itemId = readThreadId(params.itemId);
    return itemId ? this.reserveOrder(itemId, 1) : null;
  }

  private orderForUpsertNotification(notification: CodexAppServerNotification): number | null {
    if (notification.method !== "item/started" && notification.method !== "item/completed") return null;
    const params = readNotificationParams(notification.params);
    if (!params || !isRecord(params.item)) return null;
    const itemId = readThreadId(params.item.id);
    return itemId ? this.reserveOrder(itemId, CODEX_ITEM_ORDER_SPAN) : null;
  }

  private applyDelta(event: AgentsUiConversationMessageDeltaPayload): void {
    const existing = this.liveMessages.get(event.itemId);
    this.liveMessages.set(event.itemId, {
      id: event.itemId,
      turnId: event.turnId,
      order: existing?.order ?? event.order,
      role: "assistant",
      kind: existing?.kind ?? "text",
      text: `${existing?.text ?? ""}${event.delta}`,
      status: "inProgress",
      createdAt: existing?.createdAt ?? null,
      ...(existing?.phase ? { phase: existing.phase } : {}),
    });
  }

  private applyUpsert(message: AgentsUiConversationMessage): AgentsUiConversationMessage {
    const existing = this.liveMessages.get(message.id);
    const nextMessage = existing ? { ...message, order: existing.order } : message;
    this.liveMessages.set(message.id, nextMessage);
    return nextMessage;
  }

  private queueSnapshotRefresh(): void {
    if (this.refreshInFlight) {
      this.refreshQueued = true;
      return;
    }

    this.refreshInFlight = true;
    void this.runSnapshotRefresh();
  }

  private async runSnapshotRefresh(): Promise<void> {
    try {
      const snapshot = await this.deps.loadSnapshot();
      if (this.closed) return;

      if (snapshot.ok) {
        this.sendSnapshot(snapshot.data);
      } else {
        this.deps.send(this.errorEvent(snapshot.message));
      }
    } catch (error) {
      if (!this.closed) {
        this.deps.send(this.errorEvent(error instanceof Error ? error.message : String(error)));
      }
    } finally {
      this.refreshInFlight = false;
      if (!this.closed && this.refreshQueued) {
        this.refreshQueued = false;
        this.queueSnapshotRefresh();
      }
    }
  }

  private errorEvent(message: string): AgentsUiConversationErrorEvent {
    return {
      type: "error",
      message,
    };
  }
}

export function shouldRefreshAgentsConversationSnapshot(notification: CodexAppServerNotification): boolean {
  switch (notification.method) {
    case "turn/started":
    case "turn/completed":
    case "thread/status/changed":
      return readAgentsNotificationThreadId(notification) !== null;
    case "item/completed": {
      const params = readNotificationParams(notification.params);
      if (!params) return false;
      const itemType = readNotificationItemType(params.item);
      return itemType === "userMessage" || itemType === "agentMessage" || itemType === "commandExecution";
    }
    default:
      return false;
  }
}
