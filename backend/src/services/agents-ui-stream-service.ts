import {
  parseCodexAppServerThreadItem,
  type CodexAppServerNotification,
  type CodexAppServerThreadItem,
} from "../adapters/codex-app-server";
import type {
  AgentsUiConversationErrorEvent,
  AgentsUiConversationEvent,
  AgentsUiConversationMessage,
  AgentsUiConversationMessageDeltaEvent,
  AgentsUiConversationMessageUpsertEvent,
  AgentsUiConversationStatusEvent,
} from "../domain/agents-ui";
import { isRecord } from "../lib/type-guards";
import { buildCodexItemConversationMessages } from "./worktree-conversation-service";

type AgentsUiConversationMessageDeltaPayload = Omit<AgentsUiConversationMessageDeltaEvent, "revision">;
type AgentsUiConversationMessageUpsertPayload = Omit<AgentsUiConversationMessageUpsertEvent, "revision">;
export type AgentsUiConversationStatusPayload = Omit<AgentsUiConversationStatusEvent, "revision">;
export type AgentsUiConversationMessageDraft = Omit<AgentsUiConversationMessage, "order">;
export type AgentsUiConversationMessageDeltaLivePayload = Omit<
  AgentsUiConversationMessageDeltaEvent,
  "revision" | "order"
>;
export type AgentsUiConversationMessageUpsertLivePayload = Omit<
  AgentsUiConversationMessageUpsertEvent,
  "revision" | "message"
> & {
  message: AgentsUiConversationMessageDraft;
};

function readNotificationParams(raw: unknown): Record<string, unknown> | null {
  return isRecord(raw) ? raw : null;
}

function readThreadId(raw: unknown): string | null {
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

function readStatusType(raw: unknown): string | null {
  if (typeof raw === "string") return raw;
  if (!isRecord(raw)) return null;
  return typeof raw.type === "string" ? raw.type : null;
}

function readNotificationStatusType(notification: CodexAppServerNotification): string | null {
  const params = readNotificationParams(notification.params);
  if (!params) return null;
  return readStatusType(params.status) ?? (isRecord(params.thread) ? readStatusType(params.thread.status) : null);
}

function isTerminalThreadStatus(statusType: string | null): boolean {
  return statusType === "idle"
    || statusType === "completed"
    || statusType === "interrupted"
    || statusType === "failed"
    || statusType === "systemError";
}

function readNumber(raw: unknown): number | null {
  return typeof raw === "number" ? raw : null;
}

function toIsoTimestampMs(epochMs: number | null): string | null {
  if (epochMs === null) return null;
  return new Date(epochMs).toISOString();
}

function readNotificationItem(notification: CodexAppServerNotification): CodexAppServerThreadItem | null {
  const params = readNotificationParams(notification.params);
  if (!params) return null;
  return parseCodexAppServerThreadItem(params.item);
}

function orderSpanForItem(item: CodexAppServerThreadItem): number | null {
  // Reserve the maximum number of messages the snapshot builder can emit for this item.
  switch (item.type) {
    case "userMessage":
    case "agentMessage":
    case "webSearch":
      return 1;
    case "commandExecution":
    case "fileChange":
    case "mcpToolCall":
    case "dynamicToolCall":
      return 2;
    default:
      return null;
  }
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

  const item = readNotificationItem(notification);
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

export function buildAgentsUiConversationStatusEvent(
  notification: CodexAppServerNotification,
): AgentsUiConversationStatusPayload | null {
  if (
    notification.method !== "turn/started"
    && notification.method !== "turn/completed"
    && notification.method !== "thread/status/changed"
  ) return null;

  const params = readNotificationParams(notification.params);
  if (!params) return null;

  const conversationId = readThreadId(params.threadId);
  if (!conversationId) return null;

  if (notification.method === "thread/status/changed") {
    if (!isTerminalThreadStatus(readNotificationStatusType(notification))) return null;
    return {
      type: "conversationStatus",
      conversationId,
      running: false,
      activeTurnId: null,
    };
  }

  if (notification.method === "turn/started") {
    const activeTurnId = readThreadId(params.turnId);
    if (!activeTurnId) return null;
    return {
      type: "conversationStatus",
      conversationId,
      running: true,
      activeTurnId,
    };
  }

  return {
    type: "conversationStatus",
    conversationId,
    running: false,
    activeTurnId: null,
  };
}

export class AgentsConversationStreamSession {
  private revision = 0;
  private conversationId: string;
  private closed = false;
  private nextLiveOrder: number;
  private readonly itemOrders = new Map<string, number>();

  constructor(
    private readonly deps: {
      conversationId: string;
      nextOrder: number;
      send: (event: AgentsUiConversationEvent) => void;
    },
  ) {
    this.conversationId = deps.conversationId;
    this.nextLiveOrder = deps.nextOrder;
  }

  currentConversationId(): string {
    return this.conversationId;
  }

  close(): void {
    this.closed = true;
  }

  handleNotification(notification: CodexAppServerNotification): void {
    if (this.closed) return;

    const notificationThreadId = readAgentsNotificationThreadId(notification);
    if (!notificationThreadId || notificationThreadId !== this.conversationId) return;

    const statusEvent = buildAgentsUiConversationStatusEvent(notification);
    if (statusEvent) {
      this.handleConversationStatus(statusEvent);
      return;
    }

    const deltaOrder = this.orderForDeltaNotification(notification);
    const deltaEvent = deltaOrder === null ? null : buildAgentsUiMessageDeltaEvent(notification, deltaOrder);
    if (deltaEvent) {
      this.sendMessageDelta(deltaEvent);
      return;
    }

    const upsertOrder = this.orderForUpsertNotification(notification);
    if (upsertOrder !== null) {
      for (const upsertEvent of buildAgentsUiMessageUpsertEvents(notification, upsertOrder)) {
        this.sendMessageUpsert(upsertEvent);
      }
    }
  }

  handleLiveMessageDelta(event: AgentsUiConversationMessageDeltaLivePayload): void {
    if (this.closed || event.conversationId !== this.conversationId) return;
    this.sendMessageDelta({
      ...event,
      order: this.reserveOrder(event.itemId, 1),
    });
  }

  handleLiveMessageUpsert(
    event: AgentsUiConversationMessageUpsertLivePayload,
    orderKey = event.message.id,
  ): void {
    if (this.closed || event.conversationId !== this.conversationId) return;
    const order = this.reserveOrder(orderKey, 1);
    this.itemOrders.set(event.message.id, order);
    this.sendMessageUpsert({
      ...event,
      message: {
        ...event.message,
        order,
      },
    });
  }

  handleConversationStatus(event: AgentsUiConversationStatusPayload): void {
    if (this.closed || event.conversationId !== this.conversationId) return;
    this.deps.send({
      ...event,
      revision: this.nextRevision(),
    });
  }

  sendError(message: string): void {
    if (this.closed) return;
    this.deps.send(this.errorEvent(message));
  }

  private nextRevision(): number {
    this.revision += 1;
    return this.revision;
  }

  private reserveOrder(itemId: string, span: number): number {
    const existing = this.itemOrders.get(itemId);
    if (existing !== undefined) return existing;

    const order = this.nextLiveOrder;
    this.nextLiveOrder += span;
    this.itemOrders.set(itemId, order);
    return order;
  }

  private sendMessageDelta(event: AgentsUiConversationMessageDeltaPayload): void {
    this.deps.send({
      ...event,
      revision: this.nextRevision(),
    });
  }

  private sendMessageUpsert(event: AgentsUiConversationMessageUpsertPayload): void {
    this.deps.send({
      ...event,
      revision: this.nextRevision(),
    });
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
    const item = readNotificationItem(notification);
    if (!itemId || !item) return null;
    const orderSpan = orderSpanForItem(item);
    return orderSpan === null ? null : this.reserveOrder(itemId, orderSpan);
  }

  private errorEvent(message: string): AgentsUiConversationErrorEvent {
    return {
      type: "error",
      message,
    };
  }
}
