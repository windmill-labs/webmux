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

function readNotificationParams(raw: unknown): Record<string, unknown> | null {
  return isRecord(raw) ? raw : null;
}

function readThreadId(raw: unknown): string | null {
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

function readNotificationTurnId(notification: CodexAppServerNotification): string | null {
  const params = readNotificationParams(notification.params);
  if (!params) return null;
  return readThreadId(params.turnId);
}

function readNotificationItemType(raw: unknown): string | null {
  if (!isRecord(raw)) return null;
  return typeof raw.type === "string" ? raw.type : null;
}

function readStatusType(raw: unknown): string | null {
  if (typeof raw === "string") return raw;
  if (!isRecord(raw)) return null;
  if (typeof raw.type === "string") return raw.type;
  return null;
}

function readNotificationStatusType(notification: CodexAppServerNotification): string | null {
  const params = readNotificationParams(notification.params);
  if (!params) return null;
  return readStatusType(params.status) ?? (isRecord(params.thread) ? readStatusType(params.thread.status) : null);
}

function readNumber(raw: unknown): number | null {
  return typeof raw === "number" ? raw : null;
}

function toIsoTimestampMs(epochMs: number | null): string | null {
  if (epochMs === null) return null;
  return new Date(epochMs).toISOString();
}

export function readAgentsNotificationThreadId(notification: CodexAppServerNotification): string | null {
  const params = readNotificationParams(notification.params);
  if (!params) return null;
  return readThreadId(params.threadId);
}

export function buildAgentsUiMessageDeltaEvent(
  notification: CodexAppServerNotification,
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
    delta,
  };
}

export function buildAgentsUiMessageUpsertEvents(
  notification: CodexAppServerNotification,
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
    includeEmptyText: true,
  }).map((message) => ({
    type: "messageUpsert",
    conversationId: threadId,
    message,
  }));
}

function mergeConversationMessage(
  existing: AgentsUiConversationMessage,
  incoming: AgentsUiConversationMessage,
): AgentsUiConversationMessage {
  const text = incoming.text.length >= existing.text.length ? incoming.text : existing.text;
  return {
    ...existing,
    ...incoming,
    text,
  };
}

function messageKind(message: AgentsUiConversationMessage): NonNullable<AgentsUiConversationMessage["kind"]> {
  return message.kind ?? "text";
}

function textOverlaps(left: string, right: string): boolean {
  return left === right || left.startsWith(right) || right.startsWith(left);
}

function isSameLogicalConversationMessage(
  left: AgentsUiConversationMessage,
  right: AgentsUiConversationMessage,
): boolean {
  if (left.id === right.id) return true;
  if (left.role !== right.role) return false;
  if (messageKind(left) !== messageKind(right)) return false;
  if (left.toolCallId && right.toolCallId) return left.toolCallId === right.toolCallId;
  if (left.turnId !== right.turnId) return false;
  if (left.phase !== right.phase) return false;

  const kind = messageKind(left);
  if (kind === "text" || kind === "thinking") {
    return textOverlaps(left.text, right.text);
  }

  return false;
}

function mergeSnapshotMessageWithLiveMessage(
  snapshotMessage: AgentsUiConversationMessage,
  liveMessage: AgentsUiConversationMessage,
): AgentsUiConversationMessage {
  const liveHasNewerState = liveMessage.text.length > snapshotMessage.text.length
    || (snapshotMessage.status === "inProgress" && liveMessage.status !== "inProgress");
  if (!liveHasNewerState) return snapshotMessage;

  const merged = mergeConversationMessage(snapshotMessage, liveMessage);
  return {
    ...merged,
    status: snapshotMessage.status !== "inProgress" && liveMessage.status === "inProgress"
      ? snapshotMessage.status
      : merged.status,
    createdAt: snapshotMessage.createdAt ?? liveMessage.createdAt,
  };
}

function mergeLiveMessages(
  messages: AgentsUiConversationMessage[],
  liveMessages: AgentsUiConversationMessage[],
): AgentsUiConversationMessage[] {
  if (liveMessages.length === 0) return messages;

  const merged = [...messages];

  for (const liveMessage of liveMessages) {
    const existingIndex = merged.findIndex((message) => isSameLogicalConversationMessage(message, liveMessage));
    if (existingIndex === -1) {
      merged.push(liveMessage);
    } else {
      merged[existingIndex] = mergeSnapshotMessageWithLiveMessage(merged[existingIndex], liveMessage);
    }
  }

  return merged;
}

function findMatchingSnapshotMessage(
  snapshot: AgentsUiWorktreeConversationResponse["conversation"],
  liveMessage: AgentsUiConversationMessage,
): AgentsUiConversationMessage | null {
  return snapshot.messages.find((message) => isSameLogicalConversationMessage(message, liveMessage)) ?? null;
}

function completeLiveMessageFromSnapshot(
  snapshot: AgentsUiWorktreeConversationResponse["conversation"],
  liveMessage: AgentsUiConversationMessage,
): AgentsUiConversationMessage {
  const snapshotMessage = findMatchingSnapshotMessage(snapshot, liveMessage);
  if (!snapshotMessage || snapshotMessage.status === "inProgress" || liveMessage.status !== "inProgress") {
    return liveMessage;
  }
  return {
    ...liveMessage,
    status: snapshotMessage.status,
  };
}

export function mergeConversationSnapshotWithLiveMessages(
  snapshot: AgentsUiWorktreeConversationResponse,
  liveMessages: AgentsUiConversationMessage[],
): AgentsUiWorktreeConversationResponse {
  if (liveMessages.length === 0) return snapshot;

  const reconciledLiveMessages = liveMessages.map((message) =>
    completeLiveMessageFromSnapshot(snapshot.conversation, message)
  );
  const inProgress = reconciledLiveMessages.find((message) => message.status === "inProgress") ?? null;
  return {
    ...snapshot,
    conversation: {
      ...snapshot.conversation,
      running: snapshot.conversation.running || inProgress !== null,
      activeTurnId: snapshot.conversation.activeTurnId ?? inProgress?.turnId ?? null,
      messages: mergeLiveMessages(snapshot.conversation.messages, reconciledLiveMessages),
    },
  };
}

function shouldKeepLiveMessage(
  snapshot: AgentsUiWorktreeConversationResponse["conversation"],
  liveMessage: AgentsUiConversationMessage,
): boolean {
  const snapshotMessage = findMatchingSnapshotMessage(snapshot, liveMessage);
  if (!snapshotMessage) return snapshot.running || liveMessage.status !== "inProgress";
  if (snapshotMessage.status === "inProgress") return true;
  return snapshotMessage.text.length < liveMessage.text.length;
}

function shouldCompleteLiveMessages(notification: CodexAppServerNotification): boolean {
  if (notification.method === "turn/completed") return true;
  if (notification.method !== "thread/status/changed") return false;
  const statusType = readNotificationStatusType(notification);
  return statusType === "idle" || statusType === "completed" || statusType === "interrupted";
}

export class AgentsConversationStreamSession {
  private revision = 0;
  private conversationId: string;
  private closed = false;
  private refreshInFlight = false;
  private refreshQueued = false;
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
    const liveMessages = [...this.liveMessages.values()];
    for (const message of liveMessages) {
      if (!shouldKeepLiveMessage(snapshot.conversation, message)) {
        this.liveMessages.delete(message.id);
      } else {
        this.liveMessages.set(message.id, completeLiveMessageFromSnapshot(snapshot.conversation, message));
      }
    }
    const retainedLiveMessages = [...this.liveMessages.values()];
    const data = mergeConversationSnapshotWithLiveMessages(snapshot, retainedLiveMessages);
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

    const deltaEvent = buildAgentsUiMessageDeltaEvent(notification);
    if (deltaEvent) {
      this.applyDelta(deltaEvent);
      this.deps.send({
        ...deltaEvent,
        revision: this.nextRevision(),
      });
      return;
    }

    for (const upsertEvent of buildAgentsUiMessageUpsertEvents(notification)) {
      const message = this.applyUpsert(upsertEvent.message);
      this.deps.send({
        ...upsertEvent,
        message,
        revision: this.nextRevision(),
      });
    }

    if (shouldCompleteLiveMessages(notification)) {
      this.completeLiveMessages(readNotificationTurnId(notification));
    }

    if (shouldRefreshAgentsConversationSnapshot(notification)) {
      this.queueSnapshotRefresh();
    }
  }

  private nextRevision(): number {
    this.revision += 1;
    return this.revision;
  }

  private applyDelta(event: AgentsUiConversationMessageDeltaPayload): void {
    const existing = this.liveMessages.get(event.itemId);
    this.liveMessages.set(event.itemId, {
      id: event.itemId,
      turnId: event.turnId,
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
    const nextMessage = existing ? mergeConversationMessage(existing, message) : message;
    this.liveMessages.set(message.id, nextMessage);
    return nextMessage;
  }

  private completeLiveMessages(turnId: string | null): void {
    for (const [messageId, message] of this.liveMessages) {
      if (message.status !== "inProgress") continue;
      if (turnId && message.turnId !== turnId) continue;
      this.liveMessages.set(messageId, {
        ...message,
        status: "completed",
      });
    }
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
      return itemType === "userMessage" || itemType === "agentMessage";
    }
    default:
      return false;
  }
}
