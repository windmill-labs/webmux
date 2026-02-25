import type { WorktreeInfo, AppConfig } from "./types";

async function api<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`/api/${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data as T;
}

export function fetchConfig(): Promise<AppConfig> {
  return api<AppConfig>("config");
}

export function fetchWorktrees(): Promise<WorktreeInfo[]> {
  return api<WorktreeInfo[]>("worktrees");
}

export function createWorktree(
  branch: string | undefined,
  profile: string,
  agent: string,
  prompt?: string,
): Promise<{ branch: string }> {
  return api<{ branch: string }>("worktrees", {
    method: "POST",
    body: JSON.stringify({
      ...(branch ? { branch } : {}),
      profile,
      agent,
      ...(prompt ? { prompt } : {}),
    }),
  });
}

export function removeWorktree(name: string): Promise<unknown> {
  return api(`worktrees/${encodeURIComponent(name)}`, { method: "DELETE" });
}

export function openWorktree(name: string): Promise<unknown> {
  return api(`worktrees/${encodeURIComponent(name)}/open`, { method: "POST" });
}

export function mergeWorktree(name: string): Promise<unknown> {
  return api(`worktrees/${encodeURIComponent(name)}/merge`, { method: "POST" });
}

export async function fetchCiLogs(runId: number): Promise<string> {
  const data = await api<{ logs: string }>(`ci-logs/${runId}`);
  return data.logs;
}

export async function sendWorktreePrompt(branch: string, text: string, preamble?: string): Promise<void> {
  await api(`worktrees/${encodeURIComponent(branch)}/send`, {
    method: "POST",
    body: JSON.stringify({ text, ...(preamble ? { preamble } : {}) }),
  });
}
