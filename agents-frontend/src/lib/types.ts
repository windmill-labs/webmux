import type { PrEntry } from "@webmux/api-contract";

export interface ServiceStatus {
  name: string;
  port: number | null;
  running: boolean;
  url: string | null;
}

interface WorktreeConversationRefBase {
  provider: "codexAppServer" | "claudeCode";
  conversationId: string;
  cwd: string;
  lastSeenAt: string;
}

export interface CodexWorktreeConversationRef extends WorktreeConversationRefBase {
  provider: "codexAppServer";
  threadId: string;
}

export interface ClaudeWorktreeConversationRef extends WorktreeConversationRefBase {
  provider: "claudeCode";
  sessionId: string;
}

export type WorktreeConversationRef =
  | CodexWorktreeConversationRef
  | ClaudeWorktreeConversationRef;

export interface AgentsUiProjectInfo {
  name: string;
  mainBranch: string;
}

export interface AgentsUiCapabilities {
  codexWorktreeChat: boolean;
  claudeWorktreeChat: boolean;
}

export interface AgentsUiWorktreeSummary {
  branch: string;
  baseBranch?: string;
  path: string;
  archived: boolean;
  profile: string | null;
  agentName: "claude" | "codex" | null;
  status: string;
  dirty: boolean;
  unpushed: boolean;
  services: ServiceStatus[];
  prs: PrEntry[];
  creating: boolean;
  creationPhase:
    | "creating_worktree"
    | "preparing_runtime"
    | "running_post_create_hook"
    | "starting_session"
    | "reconciling"
    | null;
  conversation: WorktreeConversationRef | null;
}

export interface AgentsUiBootstrapResponse {
  project: AgentsUiProjectInfo;
  capabilities: AgentsUiCapabilities;
  worktrees: AgentsUiWorktreeSummary[];
}

export type AgentsUiConversationMessageRole = "user" | "assistant";
export type AgentsUiConversationMessageStatus = "completed" | "inProgress";

export interface AgentsUiConversationMessage {
  id: string;
  turnId: string;
  role: AgentsUiConversationMessageRole;
  text: string;
  status: AgentsUiConversationMessageStatus;
  createdAt: string | null;
}

export interface AgentsUiConversationState {
  provider: "codexAppServer" | "claudeCode";
  conversationId: string;
  cwd: string;
  running: boolean;
  activeTurnId: string | null;
  messages: AgentsUiConversationMessage[];
}

export interface AgentsUiWorktreeConversationResponse {
  worktree: AgentsUiWorktreeSummary;
  conversation: AgentsUiConversationState;
}

export interface AgentsUiSendMessageRequest {
  text: string;
}

export interface AgentsUiSendMessageResponse {
  conversationId: string;
  turnId: string;
  running: true;
}

export interface AgentsUiInterruptResponse {
  conversationId: string;
  turnId: string;
  interrupted: true;
}

export interface AgentsUiConversationSnapshotEvent {
  type: "snapshot";
  data: AgentsUiWorktreeConversationResponse;
}

export interface AgentsUiConversationMessageDeltaEvent {
  type: "messageDelta";
  conversationId: string;
  turnId: string;
  itemId: string;
  delta: string;
}

export interface AgentsUiConversationErrorEvent {
  type: "error";
  message: string;
}

export type AgentsUiConversationEvent =
  | AgentsUiConversationSnapshotEvent
  | AgentsUiConversationMessageDeltaEvent
  | AgentsUiConversationErrorEvent;
