import type { AgentKind } from "./config";
import type {
  ServiceRuntimeState,
  WorktreeConversationProvider,
  WorktreeConversationMeta,
  WorktreeCreationPhase,
} from "./model";

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
  agentName: AgentKind | null;
  status: string;
  dirty: boolean;
  unpushed: boolean;
  services: ServiceRuntimeState[];
  creating: boolean;
  creationPhase: WorktreeCreationPhase | null;
  conversation: WorktreeConversationMeta | null;
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
  provider: WorktreeConversationProvider;
  threadId: string;
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
  threadId: string;
  turnId: string;
  running: true;
}

export interface AgentsUiInterruptResponse {
  threadId: string;
  turnId: string;
  interrupted: true;
}

export interface AgentsUiConversationSnapshotEvent {
  type: "snapshot";
  data: AgentsUiWorktreeConversationResponse;
}

export interface AgentsUiConversationMessageDeltaEvent {
  type: "messageDelta";
  threadId: string;
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
