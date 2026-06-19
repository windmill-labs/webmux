import { AgentsUiConversationEventSchema, apiPaths, createApi } from "@webmux/api-contract";
import type {
  AgentDetails,
  AgentResponse,
  AgentsUiConversationEvent,
  AgentsUiInterruptResponse,
  AgentsUiSendMessageRequest,
  AgentsUiSendMessageResponse,
  AgentsUiWorktreeConversationResponse,
  AppNotification,
  FileUploadResult,
  InstanceSummary,
  PostWorktreeToLinearResponse,
  PostWorktreeToLinearTarget,
  ProjectWorktreeSnapshot,
  UpsertCustomAgentRequest,
  ValidateCustomAgentResponse,
  WorktreeInfo,
  WorktreeTab,
} from "./types";

export const api = createApi("");

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

function mapWorktree(snapshot: ProjectWorktreeSnapshot): WorktreeInfo {
  return {
    branch: snapshot.branch,
    label: snapshot.label,
    ...(snapshot.baseBranch ? { baseBranch: snapshot.baseBranch } : {}),
    archived: snapshot.archived,
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
    agentLabel: snapshot.agentLabel,
    agentTerminalStale: snapshot.agentTerminalStale,
    services: snapshot.services,
    paneCount: snapshot.paneCount,
    prs: snapshot.prs,
    linearIssue: snapshot.linearIssue,
    creating: snapshot.creation !== null,
    creationPhase: snapshot.creation?.phase ?? null,
    source: snapshot.source,
    oneshot: snapshot.oneshot,
    tabs: snapshot.tabs,
    activeTabId: snapshot.activeTabId,
  };
}

export async function createWorktreeTab(branch: string): Promise<WorktreeTab> {
  const response = await api.createWorktreeTab({ params: { name: branch } });
  return response.tab;
}

export function selectWorktreeTab(branch: string, tabId: string): Promise<void> {
  return api.selectWorktreeTab({ params: { name: branch, tabId } }).then(() => undefined);
}

export function deleteWorktreeTab(branch: string, tabId: string): Promise<void> {
  return api.deleteWorktreeTab({ params: { name: branch, tabId } }).then(() => undefined);
}

export function postWorktreeToLinear(
  branch: string,
  target: PostWorktreeToLinearTarget,
): Promise<PostWorktreeToLinearResponse> {
  return api.postWorktreeToLinear({
    params: { name: branch },
    body: { target },
  });
}

export async function fetchWorktrees(): Promise<WorktreeInfo[]> {
  const response = await api.fetchWorktrees();
  return response.worktrees.map((worktree) => mapWorktree(worktree));
}

export async function setWorktreeLabel(branch: string, label: string | null): Promise<string | null> {
  const response = await api.setWorktreeLabel({
    params: { name: branch },
    body: { label },
  });
  return response.label;
}

export function attachWorktreeConversation(branch: string): Promise<AgentsUiWorktreeConversationResponse> {
  return api.attachAgentsWorktreeConversation({
    params: { name: branch },
  });
}

export function fetchWorktreeConversationHistory(branch: string): Promise<AgentsUiWorktreeConversationResponse> {
  return api.fetchAgentsWorktreeConversationHistory({
    params: { name: branch },
  });
}

export function sendWorktreeConversationMessage(
  branch: string,
  body: AgentsUiSendMessageRequest,
): Promise<AgentsUiSendMessageResponse> {
  return api.sendAgentsWorktreeConversationMessage({
    params: { name: branch },
    body,
  });
}

export function interruptWorktreeConversation(branch: string): Promise<AgentsUiInterruptResponse> {
  return api.interruptAgentsWorktreeConversation({
    params: { name: branch },
  });
}

export function refreshWorktreeAgentTerminal(branch: string): Promise<void> {
  return api.refreshWorktreeAgentTerminal({
    params: { name: branch },
  }).then(() => undefined);
}

function withWorktreeName(path: string, branch: string): string {
  return path.replace(":name", encodeURIComponent(branch));
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
    `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}${
      withWorktreeName(apiPaths.streamAgentsWorktreeConversation, branch)
    }`,
  );
  let closedByClient = false;

  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return;
    try {
      callbacks.onEvent(AgentsUiConversationEventSchema.parse(JSON.parse(event.data)));
    } catch {
      callbacks.onError("Received malformed conversation stream data");
    }
  });

  socket.addEventListener("error", () => {
    callbacks.onError("Conversation stream connection failed");
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

export function fetchAgents(): Promise<AgentDetails[]> {
  return api.fetchAgents().then((response) => response.agents);
}

export function createAgent(body: UpsertCustomAgentRequest): Promise<AgentResponse> {
  return api.createAgent({ body });
}

export function updateAgent(id: string, body: UpsertCustomAgentRequest): Promise<AgentResponse> {
  return api.updateAgent({ params: { id }, body });
}

export function deleteAgent(id: string): Promise<void> {
  return api.deleteAgent({ params: { id } }).then(() => undefined);
}

export function validateAgent(body: UpsertCustomAgentRequest): Promise<ValidateCustomAgentResponse> {
  return api.validateAgent({ body });
}

export async function fetchInstances(): Promise<InstanceSummary[]> {
  const response = await api.fetchInstances();
  return response.instances;
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
