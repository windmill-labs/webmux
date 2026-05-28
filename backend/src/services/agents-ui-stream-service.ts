import { parseCodexAppServerThreadItem, type CodexAppServerNotification } from "../adapters/codex-app-server";
import type {
  AgentsUiConversationMessageDeltaEvent,
  AgentsUiConversationMessageUpsertEvent,
} from "../domain/agents-ui";
import { isRecord } from "../lib/type-guards";
import { buildCodexItemConversationMessages } from "./worktree-conversation-service";

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

export function readAgentsNotificationThreadId(notification: CodexAppServerNotification): string | null {
  const params = readNotificationParams(notification.params);
  if (!params) return null;
  return readThreadId(params.threadId);
}

export function buildAgentsUiMessageDeltaEvent(
  notification: CodexAppServerNotification,
): AgentsUiConversationMessageDeltaEvent | null {
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
): AgentsUiConversationMessageUpsertEvent[] {
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
