import type { AgentId } from "./config";
import type {
  PrEntry,
  ServiceRuntimeState,
  WorktreeConversationProvider,
  WorktreeConversationMeta,
  WorktreeCreationPhase,
} from "./model";

export interface AgentsUiWorktreeSummary {
  branch: string;
  baseBranch?: string;
  path: string;
  archived: boolean;
  profile: string | null;
  agentName: AgentId | null;
  agentLabel: string | null;
  agentTerminalStale: boolean;
  mux: boolean;
  status: string;
  dirty: boolean;
  unpushed: boolean;
  services: ServiceRuntimeState[];
  prs: PrEntry[];
  creating: boolean;
  creationPhase: WorktreeCreationPhase | null;
  conversation: WorktreeConversationMeta | null;
}

export type AgentsUiConversationMessageRole = "user" | "assistant";
export type AgentsUiConversationMessageStatus = "completed" | "inProgress" | "failed";
export type AgentsUiConversationMessageKind = "text" | "thinking" | "toolUse" | "toolResult";

export interface AgentsUiConversationMessage {
  id: string;
  turnId: string;
  role: AgentsUiConversationMessageRole;
  text: string;
  status: AgentsUiConversationMessageStatus;
  createdAt: string | null;
  kind?: AgentsUiConversationMessageKind;
  phase?: string;
  toolName?: string;
  toolCallId?: string;
  command?: string;
  cwd?: string;
  exitCode?: number | null;
  durationMs?: number | null;
}

export interface AgentsUiConversationState {
  provider: WorktreeConversationProvider;
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
  revision: number;
  data: AgentsUiWorktreeConversationResponse;
}

export interface AgentsUiConversationMessageDeltaEvent {
  type: "messageDelta";
  revision: number;
  conversationId: string;
  turnId: string;
  itemId: string;
  delta: string;
}

export interface AgentsUiConversationMessageUpsertEvent {
  type: "messageUpsert";
  revision: number;
  conversationId: string;
  message: AgentsUiConversationMessage;
}

export interface AgentsUiConversationErrorEvent {
  type: "error";
  message: string;
}

export type AgentsUiConversationEvent =
  | AgentsUiConversationSnapshotEvent
  | AgentsUiConversationMessageDeltaEvent
  | AgentsUiConversationMessageUpsertEvent
  | AgentsUiConversationErrorEvent;
