import type { WorktreeInfo, AppConfig, AppNotification } from "./types";

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

let _wtEtag: string | null = null;
let _wtCache: WorktreeInfo[] | null = null;

export async function fetchWorktrees(): Promise<WorktreeInfo[]> {
  const headers: Record<string, string> = {};
  if (_wtEtag) headers["If-None-Match"] = _wtEtag;

  const res = await fetch("/api/worktrees", { headers });
  if (res.status === 304 && _wtCache) return _wtCache;
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || `HTTP ${res.status}`);
  }

  const data = (await res.json()) as WorktreeInfo[];
  _wtEtag = res.headers.get("etag");
  _wtCache = data;
  return data;
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

export function subscribeNotifications(
  onNotification: (n: AppNotification) => void,
  onDismiss: (id: number) => void,
  onInitial?: (n: AppNotification) => void,
): () => void {
  const es = new EventSource("/api/notifications/stream");

  es.addEventListener("initial", (e: MessageEvent) => {
    try {
      const n = JSON.parse(e.data as string) as AppNotification;
      onInitial?.(n);
    } catch { /* ignore malformed SSE data */ }
  });

  es.addEventListener("notification", (e: MessageEvent) => {
    try {
      const n = JSON.parse(e.data as string) as AppNotification;
      onNotification(n);
    } catch { /* ignore malformed SSE data */ }
  });

  es.addEventListener("dismiss", (e: MessageEvent) => {
    try {
      const { id } = JSON.parse(e.data as string) as { id: number };
      onDismiss(id);
    } catch { /* ignore malformed SSE data */ }
  });

  return () => es.close();
}

export async function dismissNotification(id: number): Promise<void> {
  await api(`notifications/${id}/dismiss`, { method: "POST" });
}
