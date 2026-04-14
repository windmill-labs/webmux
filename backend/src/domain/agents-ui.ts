import type { AgentKind } from "./config";
import type {
  ServiceRuntimeState,
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
