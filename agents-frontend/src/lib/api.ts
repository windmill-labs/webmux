import {
  AgentsUiBootstrapResponseSchema,
  AgentsUiConversationEventSchema,
  AgentsUiInterruptResponseSchema,
  AgentsUiSendMessageResponseSchema,
  AgentsUiWorktreeConversationResponseSchema,
  apiPaths,
} from "@webmux/api-contract";
import type {
  AgentsUiBootstrapResponse,
  AgentsUiConversationEvent,
  AgentsUiInterruptResponse,
  AgentsUiSendMessageRequest,
  AgentsUiSendMessageResponse,
  AgentsUiWorktreeConversationResponse,
} from "./types";

function readBackendOrigin(): string {
  const backendPort = window.__WEBMUX_AGENTS_BACKEND_PORT__;
  if (typeof backendPort !== "number") return "";
  return `${window.location.protocol}//${window.location.hostname}:${backendPort}`;
}

function readBackendWebSocketOrigin(): string {
  const backendPort = window.__WEBMUX_AGENTS_BACKEND_PORT__;
  if (typeof backendPort !== "number") {
    return `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`;
  }

  return `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.hostname}:${backendPort}`;
}

function withWorktreeName(path: string, branch: string): string {
  return path.replace(":name", encodeURIComponent(branch));
}

async function api<T>(path: string, schema: { parse: (input: unknown) => T }, opts?: RequestInit): Promise<T> {
  const headers = new Headers(opts?.headers);
  if (opts?.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${readBackendOrigin()}${path}`, {
    ...opts,
    headers,
  });
  const data = await response.json();
  if (!response.ok) {
    const message = typeof data?.error === "string" ? data.error : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return schema.parse(data);
}

export function fetchBootstrap(): Promise<AgentsUiBootstrapResponse> {
  return api(apiPaths.fetchAgentsBootstrap, AgentsUiBootstrapResponseSchema);
}

export function attachWorktreeConversation(branch: string): Promise<AgentsUiWorktreeConversationResponse> {
  return api(withWorktreeName(apiPaths.attachAgentsWorktreeConversation, branch), AgentsUiWorktreeConversationResponseSchema, {
    method: "POST",
  });
}

export function fetchWorktreeConversationHistory(branch: string): Promise<AgentsUiWorktreeConversationResponse> {
  return api(
    withWorktreeName(apiPaths.fetchAgentsWorktreeConversationHistory, branch),
    AgentsUiWorktreeConversationResponseSchema,
  );
}

export function sendWorktreeConversationMessage(
  branch: string,
  body: AgentsUiSendMessageRequest,
): Promise<AgentsUiSendMessageResponse> {
  return api(
    withWorktreeName(apiPaths.sendAgentsWorktreeConversationMessage, branch),
    AgentsUiSendMessageResponseSchema,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function interruptWorktreeConversation(branch: string): Promise<AgentsUiInterruptResponse> {
  return api(
    withWorktreeName(apiPaths.interruptAgentsWorktreeConversation, branch),
    AgentsUiInterruptResponseSchema,
    {
      method: "POST",
    },
  );
}

export function connectWorktreeConversationStream(
  branch: string,
  callbacks: {
    onEvent: (event: AgentsUiConversationEvent) => void;
    onError: (message: string) => void;
    onClose?: () => void;
  },
): () => void {
  const socket = new WebSocket(
    `${readBackendWebSocketOrigin()}${withWorktreeName(apiPaths.streamAgentsWorktreeConversation, branch)}`,
  );
  let closedByClient = false;

  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return;
    try {
      callbacks.onEvent(AgentsUiConversationEventSchema.parse(JSON.parse(event.data)));
    } catch {
      callbacks.onError("Received malformed agents stream data");
    }
  });

  socket.addEventListener("error", () => {
    callbacks.onError("Agents stream connection failed");
  });

  socket.addEventListener("close", () => {
    if (!closedByClient) {
      callbacks.onClose?.();
    }
  });

  return () => {
    closedByClient = true;
    socket.close();
  };
}
