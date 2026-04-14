export interface ServiceStatus {
  name: string;
  port: number | null;
  running: boolean;
  url: string | null;
}

export interface WorktreeConversationRef {
  provider: "codexAppServer";
  threadId: string;
  cwd: string;
  lastSeenAt: string;
}

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
