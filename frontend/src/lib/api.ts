import type {
  AvailableBranch,
  WorktreeInfo,
  AppConfig,
  AppNotification,
  CreateWorktreeRequest,
  CreateWorktreeResponse,
  FileUploadResult,
  LinearIssue,
  LinearIssuesResponse,
  PrEntry,
  ProjectSnapshot,
  ProjectWorktreeSnapshot,
  WorktreeDiffResponse,
} from "./types";

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

function mapAgentStatus(status: string): string {
  switch (status) {
    case "creating":
    case "running":
    case "starting":
      return "working";
    case "idle":
      return "waiting";
    case "stopped":
      return "done";
    case "error":
      return "error";
    default:
      return "idle";
  }
}

function clonePrEntry(pr: PrEntry): PrEntry {
  return {
    ...pr,
    ciChecks: pr.ciChecks.map((check) => ({ ...check })),
    comments: pr.comments.map((comment) => ({ ...comment })),
  };
}

function mapWorktree(snapshot: ProjectWorktreeSnapshot): WorktreeInfo {
  return {
    branch: snapshot.branch,
    ...(snapshot.baseBranch ? { baseBranch: snapshot.baseBranch } : {}),
    agent: mapAgentStatus(snapshot.status),
    mux: snapshot.mux ? "✓" : "",
    path: snapshot.path,
    dir: snapshot.dir,
    dirty: snapshot.dirty,
    unpushed: snapshot.unpushed,
    status: snapshot.status,
    elapsed: snapshot.elapsed,
    profile: snapshot.profile,
    agentName: snapshot.agentName,
    services: snapshot.services.map((service) => ({ ...service })),
    paneCount: snapshot.paneCount,
    prs: snapshot.prs.map((pr) => clonePrEntry(pr)),
    linearIssue: snapshot.linearIssue,
    creating: snapshot.creation !== null,
    creationPhase: snapshot.creation?.phase ?? null,
  };
}

export async function fetchWorktrees(): Promise<WorktreeInfo[]> {
  const snapshot = await api<ProjectSnapshot>("project");
  return snapshot.worktrees.map((worktree) => mapWorktree(worktree));
}

export async function fetchAvailableBranches(): Promise<AvailableBranch[]> {
  const data = await api<{ branches: AvailableBranch[] }>("branches");
  return data.branches;
}

export async function fetchBaseBranches(): Promise<AvailableBranch[]> {
  const data = await api<{ branches: AvailableBranch[] }>("base-branches");
  return data.branches;
}

export function createWorktree(request: CreateWorktreeRequest): Promise<CreateWorktreeResponse> {
  return api<CreateWorktreeResponse>("worktrees", {
    method: "POST",
    body: JSON.stringify({
      mode: request.mode,
      ...(request.branch ? { branch: request.branch } : {}),
      ...(request.baseBranch ? { baseBranch: request.baseBranch } : {}),
      profile: request.profile,
      agent: request.agent,
      ...(request.prompt ? { prompt: request.prompt } : {}),
      ...(request.envOverrides && Object.keys(request.envOverrides).length > 0
        ? { envOverrides: request.envOverrides }
        : {}),
      ...(request.createLinearTicket ? { createLinearTicket: true } : {}),
      ...(request.linearTitle ? { linearTitle: request.linearTitle } : {}),
    }),
  });
}

export function removeWorktree(name: string): Promise<unknown> {
  return api(`worktrees/${encodeURIComponent(name)}`, { method: "DELETE" });
}

export function openWorktree(name: string): Promise<unknown> {
  return api(`worktrees/${encodeURIComponent(name)}/open`, { method: "POST" });
}

export function closeWorktree(name: string): Promise<unknown> {
  return api(`worktrees/${encodeURIComponent(name)}/close`, { method: "POST" });
}

export function mergeWorktree(name: string): Promise<unknown> {
  return api(`worktrees/${encodeURIComponent(name)}/merge`, { method: "POST" });
}

export function fetchLinearIssues(): Promise<LinearIssuesResponse> {
  return api<LinearIssuesResponse>("linear/issues");
}

export function setLinearAutoCreate(enabled: boolean): Promise<{ ok: boolean; enabled: boolean }> {
  return api<{ ok: boolean; enabled: boolean }>("linear/auto-create", {
    method: "PUT",
    body: JSON.stringify({ enabled }),
  });
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

export async function uploadFiles(worktree: string, files: File[]): Promise<FileUploadResult> {
  const form = new FormData();
  for (const file of files) {
    form.append("files", file);
  }
  const res = await fetch(`/api/worktrees/${encodeURIComponent(worktree)}/upload`, {
    method: "POST",
    body: form,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data as FileUploadResult;
}

export function fetchWorktreeDiff(branch: string): Promise<WorktreeDiffResponse> {
  return api<WorktreeDiffResponse>(`worktrees/${encodeURIComponent(branch)}/diff`);
}
