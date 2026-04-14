import type { AgentsUiBootstrapResponse } from "./types";

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
