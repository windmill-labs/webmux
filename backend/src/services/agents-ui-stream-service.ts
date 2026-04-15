import type { CodexAppServerNotification } from "../adapters/codex-app-server";
import type { AgentsUiConversationMessageDeltaEvent } from "../domain/agents-ui";
import { isRecord } from "../lib/type-guards";

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
