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
  branch: string,
  profile: string,
  agent: string,
): Promise<unknown> {
  return api("worktrees", {
    method: "POST",
    body: JSON.stringify({ branch, profile, agent }),
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
