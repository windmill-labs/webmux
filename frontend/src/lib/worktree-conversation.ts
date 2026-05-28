import type {
  AgentsUiConversationMessage,
  AgentsUiConversationMessageDeltaEvent,
  AgentsUiConversationMessageUpsertEvent,
  AgentsUiConversationState,
} from "./types";

function buildOptimisticUserMessage(turnId: string, text: string): AgentsUiConversationMessage {
  return {
    id: `pending-user:${turnId}`,
    turnId,
    role: "user",
    text,
    status: "completed",
    createdAt: new Date().toISOString(),
  };
}

export function applyConversationMessageDelta(
  conversation: AgentsUiConversationState | null,
  event: AgentsUiConversationMessageDeltaEvent,
): AgentsUiConversationState | null {
  if (!conversation || conversation.conversationId !== event.conversationId) return conversation;

  const existingIndex = conversation.messages.findIndex((message) => message.id === event.itemId);
  if (existingIndex === -1) {
    return {
      ...conversation,
      running: true,
      activeTurnId: event.turnId,
      messages: [
        ...conversation.messages,
        {
          id: event.itemId,
          turnId: event.turnId,
          role: "assistant",
          kind: "text",
          text: event.delta,
          status: "inProgress",
          createdAt: null,
        },
      ],
    };
  }

  return {
    ...conversation,
    running: true,
    activeTurnId: event.turnId,
    messages: conversation.messages.map((message, index) =>
      index === existingIndex
        ? {
            ...message,
            text: `${message.text}${event.delta}`,
            status: "inProgress",
          }
        : message
    ),
  };
}

function mergeConversationMessage(
  _existing: AgentsUiConversationMessage,
  incoming: AgentsUiConversationMessage,
): AgentsUiConversationMessage {
  return incoming;
}

function mergeConversationUpsertMessage(
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

function normalizedMessageText(message: AgentsUiConversationMessage): string {
  return message.text.trim();
}

function textOverlaps(left: string, right: string): boolean {
  return left === right || left.startsWith(right) || right.startsWith(left);
}

function isSameServerUserMessage(
  pendingMessage: AgentsUiConversationMessage,
  incomingMessage: AgentsUiConversationMessage,
): boolean {
  return incomingMessage.role === "user"
    && messageKind(incomingMessage) === "text"
    && (
      pendingMessage.turnId === incomingMessage.turnId
      || normalizedMessageText(pendingMessage) === normalizedMessageText(incomingMessage)
    );
}

function isSameLogicalConversationMessage(
  existing: AgentsUiConversationMessage,
  incoming: AgentsUiConversationMessage,
): boolean {
  if (existing.id === incoming.id) return true;
  if (isOptimisticUserMessage(existing)) {
    return isSameServerUserMessage(existing, incoming);
  }
  if (existing.role !== incoming.role) return false;
  if (messageKind(existing) !== messageKind(incoming)) return false;
  if (existing.toolCallId && incoming.toolCallId) return existing.toolCallId === incoming.toolCallId;
  if (existing.turnId !== incoming.turnId) return false;
  if (existing.phase !== incoming.phase) return false;

  const kind = messageKind(existing);
  if (kind === "text" || kind === "thinking") {
    return textOverlaps(existing.text, incoming.text);
  }

  return false;
}

export function applyConversationMessageUpsert(
  conversation: AgentsUiConversationState | null,
  event: AgentsUiConversationMessageUpsertEvent,
): AgentsUiConversationState | null {
  if (!conversation || conversation.conversationId !== event.conversationId) return conversation;

  const existingIndex = conversation.messages.findIndex((message) =>
    isSameLogicalConversationMessage(message, event.message)
  );
  const messages = existingIndex === -1
    ? [...conversation.messages, event.message]
    : conversation.messages.map((message, index) =>
        index === existingIndex ? mergeConversationUpsertMessage(message, event.message) : message
      );

  return {
    ...conversation,
    running: conversation.running || event.message.status === "inProgress",
    activeTurnId: event.message.status === "inProgress" ? event.message.turnId : conversation.activeTurnId,
    messages,
  };
}

function isOptimisticUserMessage(message: AgentsUiConversationMessage): boolean {
  return message.role === "user" && message.id.startsWith("pending-user:");
}

export function mergeConversationSnapshot(
  current: AgentsUiConversationState | null,
  incoming: AgentsUiConversationState,
): AgentsUiConversationState {
  if (!current || current.conversationId !== incoming.conversationId || current.provider !== incoming.provider) {
    return incoming;
  }

  const incomingById = new Map(incoming.messages.map((message) => [message.id, message]));
  const currentById = new Map(current.messages.map((message) => [message.id, message]));
  const newlyArrivedUserMessages = incoming.messages.filter((message) =>
    message.role === "user" && !currentById.has(message.id)
  );
  const seen = new Set<string>();
  const messages: AgentsUiConversationMessage[] = [];
  let preservedOptimisticTurnId: string | null = null;

  for (const currentMessage of current.messages) {
    const incomingMessage = incomingById.get(currentMessage.id);
    if (incomingMessage) {
      messages.push(mergeConversationMessage(currentMessage, incomingMessage));
      seen.add(currentMessage.id);
      continue;
    }

    if (
      isOptimisticUserMessage(currentMessage)
      && !newlyArrivedUserMessages.some((message) => isSameServerUserMessage(currentMessage, message))
    ) {
      messages.push(currentMessage);
      preservedOptimisticTurnId = currentMessage.turnId;
      seen.add(currentMessage.id);
    }
  }

  for (const incomingMessage of incoming.messages) {
    if (seen.has(incomingMessage.id)) continue;
    const currentMessage = currentById.get(incomingMessage.id);
    messages.push(currentMessage ? mergeConversationMessage(currentMessage, incomingMessage) : incomingMessage);
  }

  return {
    ...incoming,
    running: incoming.running || preservedOptimisticTurnId !== null,
    activeTurnId: incoming.activeTurnId ?? preservedOptimisticTurnId,
    messages,
  };
}

export function markConversationTurnStarted(
  conversation: AgentsUiConversationState | null,
  turnId: string,
  text: string,
): AgentsUiConversationState | null {
  if (!conversation) return conversation;

  const nextMessages = conversation.messages.some((message) => message.turnId === turnId && message.role === "user")
    ? conversation.messages
    : [...conversation.messages, buildOptimisticUserMessage(turnId, text)];

  return {
    ...conversation,
    running: true,
    activeTurnId: turnId,
    messages: nextMessages,
  };
}

export function buildConversationProgressSignature(conversation: AgentsUiConversationState | null): string | null {
  if (!conversation) return null;

  const lastMessage = conversation.messages[conversation.messages.length - 1] ?? null;
  return JSON.stringify({
    conversationId: conversation.conversationId,
    running: conversation.running,
    activeTurnId: conversation.activeTurnId,
    messageCount: conversation.messages.length,
    lastMessageId: lastMessage?.id ?? null,
    lastMessageStatus: lastMessage?.status ?? null,
    lastMessageTextLength: lastMessage?.text.length ?? 0,
  });
}
