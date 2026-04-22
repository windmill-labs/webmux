import type {
  AgentId,
  LinkedLinearIssue,
  PrEntry,
  ServiceStatus,
  WorktreeCreationPhase,
} from "@webmux/api-contract";

export type {
  AgentsUiConversationEvent,
  AgentsUiConversationMessage,
  AgentsUiConversationMessageDeltaEvent,
  AgentsUiConversationState,
  AgentsUiInterruptResponse,
  AgentsUiSendMessageResponse,
  AgentsUiWorktreeConversationResponse,
  AgentCapabilities,
  AgentDetails,
  AgentId,
  AgentKind,
  AgentListResponse,
  AgentResponse,
  AgentSummary,
  AppConfig,
  AppNotification,
  AvailableBranch,
  AvailableBranchesQuery,
  BranchListResponse,
  CiCheck,
  CreateWorktreeAgentSelection,
  CreateWorktreeRequest,
  CreateWorktreeResponse,
  LinearIssue,
  LinearIssueAvailability,
  LinearIssueLabel,
  LinearIssueState,
  LinearIssuesResponse,
  LinkedLinearIssue,
  LinkedRepoInfo,
  PrComment,
  PrEntry,
  ProfileConfig,
  ProjectSnapshot,
  ProjectWorktreeSnapshot,
  PullMainResult,
  ServiceConfig,
  UpsertCustomAgentRequest,
  ServiceStatus,
  SetWorktreeArchivedRequest,
  SetWorktreeArchivedResponse,
  UnpushedCommit,
  WorktreeCreationPhase,
  WorktreeCreationState,
  WorktreeCreateMode,
  WorktreeDiffResponse,
  WorktreeListResponse,
} from "@webmux/api-contract";
export type { AgentsSendMessageRequest as AgentsUiSendMessageRequest } from "@webmux/api-contract";

export interface FileUploadResult {
  files: Array<{ path: string }>;
}

export interface DiffDialogProps {
  branch: string;
  cursorUrl?: string | null;
  onclose: () => void;
}

export interface WorktreeInfo {
  branch: string;
  baseBranch?: string;
  archived: boolean;
  agent: string;
  mux: string;
  path: string;
  dir: string | null;
  dirty: boolean;
  unpushed: boolean;
  status: string;
  elapsed: string;
  profile: string | null;
  agentName: AgentId | null;
  agentLabel: string | null;
  services: ServiceStatus[];
  paneCount: number;
  prs: PrEntry[];
  linearIssue: LinkedLinearIssue | null;
  creating: boolean;
  creationPhase: WorktreeCreationPhase | null;
}

export interface WorktreeListRow {
  worktree: WorktreeInfo;
  depth: number;
}

export type ToastTone = "info" | "success" | "error";

export interface ToastInput {
  tone: ToastTone;
  message: string;
  detail?: string;
}

export interface UiToastItem extends ToastInput {
  id: string;
  source: "ui";
}

export interface NotificationToastItem extends ToastInput {
  id: string;
  source: "notification";
  notificationId: number;
  branch: string;
}

export type ToastItem = UiToastItem | NotificationToastItem;
