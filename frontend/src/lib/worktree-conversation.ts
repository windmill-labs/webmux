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
  existing: AgentsUiConversationMessage,
  incoming: AgentsUiConversationMessage,
): AgentsUiConversationMessage {
  return {
    ...existing,
    ...incoming,
    text: existing.text.length > incoming.text.length ? existing.text : incoming.text,
  };
}

export function applyConversationMessageUpsert(
  conversation: AgentsUiConversationState | null,
  event: AgentsUiConversationMessageUpsertEvent,
): AgentsUiConversationState | null {
  if (!conversation || conversation.conversationId !== event.conversationId) return conversation;

  const existingIndex = conversation.messages.findIndex((message) => message.id === event.message.id);
  const messages = existingIndex === -1
    ? [...conversation.messages, event.message]
    : conversation.messages.map((message, index) =>
        index === existingIndex ? mergeConversationMessage(message, event.message) : message
      );

  return {
    ...conversation,
    running: conversation.running || event.message.status === "inProgress",
    activeTurnId: event.message.status === "inProgress" ? event.message.turnId : conversation.activeTurnId,
    messages,
  };
}

function shouldPreserveLocalMessage(message: AgentsUiConversationMessage): boolean {
  return message.role === "assistant" || message.kind === "toolUse" || message.kind === "toolResult";
}

function preserveLocalMessage(
  message: AgentsUiConversationMessage,
  incoming: AgentsUiConversationState,
): AgentsUiConversationMessage {
  if (message.status !== "inProgress" || incoming.running || incoming.activeTurnId === message.turnId) {
    return message;
  }

  return {
    ...message,
    status: "completed",
  };
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
  const seen = new Set<string>();
  const messages: AgentsUiConversationMessage[] = [];

  for (const currentMessage of current.messages) {
    const incomingMessage = incomingById.get(currentMessage.id);
    if (incomingMessage) {
      messages.push(mergeConversationMessage(currentMessage, incomingMessage));
      seen.add(currentMessage.id);
      continue;
    }

    if (shouldPreserveLocalMessage(currentMessage)) {
      messages.push(preserveLocalMessage(currentMessage, incoming));
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
