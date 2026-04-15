import { apiPaths } from "@webmux/api-contract";
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

async function api<T>(path: string, opts?: RequestInit): Promise<T> {
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
  return data as T;
}

export function fetchBootstrap(): Promise<AgentsUiBootstrapResponse> {
  return api<AgentsUiBootstrapResponse>(apiPaths.fetchAgentsBootstrap);
}

export function attachWorktreeConversation(branch: string): Promise<AgentsUiWorktreeConversationResponse> {
  return api<AgentsUiWorktreeConversationResponse>(withWorktreeName(apiPaths.attachAgentsWorktreeConversation, branch), {
    method: "POST",
  });
}

export function fetchWorktreeConversationHistory(branch: string): Promise<AgentsUiWorktreeConversationResponse> {
  return api<AgentsUiWorktreeConversationResponse>(withWorktreeName(apiPaths.fetchAgentsWorktreeConversationHistory, branch));
}

export function sendWorktreeConversationMessage(
  branch: string,
  body: AgentsUiSendMessageRequest,
): Promise<AgentsUiSendMessageResponse> {
  return api<AgentsUiSendMessageResponse>(withWorktreeName(apiPaths.sendAgentsWorktreeConversationMessage, branch), {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function interruptWorktreeConversation(branch: string): Promise<AgentsUiInterruptResponse> {
  return api<AgentsUiInterruptResponse>(withWorktreeName(apiPaths.interruptAgentsWorktreeConversation, branch), {
    method: "POST",
  });
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
    try {
      callbacks.onEvent(JSON.parse(event.data as string) as AgentsUiConversationEvent);
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
