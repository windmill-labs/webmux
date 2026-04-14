import type {
  AgentsUiBootstrapResponse,
  AgentsUiInterruptResponse,
  AgentsUiSendMessageRequest,
  AgentsUiSendMessageResponse,
  AgentsUiWorktreeConversationResponse,
} from "./types";

async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const response = await fetch(`/api/agents/${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const data = await response.json();
  if (!response.ok) {
    const message = typeof data?.error === "string" ? data.error : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data as T;
}

export function fetchBootstrap(): Promise<AgentsUiBootstrapResponse> {
  return api<AgentsUiBootstrapResponse>("bootstrap");
}

export function attachWorktreeConversation(branch: string): Promise<AgentsUiWorktreeConversationResponse> {
  return api<AgentsUiWorktreeConversationResponse>(`worktrees/${encodeURIComponent(branch)}/attach`, {
    method: "POST",
  });
}

export function fetchWorktreeConversationHistory(branch: string): Promise<AgentsUiWorktreeConversationResponse> {
  return api<AgentsUiWorktreeConversationResponse>(`worktrees/${encodeURIComponent(branch)}/history`);
}

export function sendWorktreeConversationMessage(
  branch: string,
  body: AgentsUiSendMessageRequest,
): Promise<AgentsUiSendMessageResponse> {
  return api<AgentsUiSendMessageResponse>(`worktrees/${encodeURIComponent(branch)}/messages`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function interruptWorktreeConversation(branch: string): Promise<AgentsUiInterruptResponse> {
  return api<AgentsUiInterruptResponse>(`worktrees/${encodeURIComponent(branch)}/interrupt`, {
    method: "POST",
  });
}
