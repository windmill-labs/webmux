export interface ServiceStatus {
  name: string;
  port: number | null;
  running: boolean;
  url?: string | null;
}

export interface PrComment {
  type: "comment" | "inline";
  author: string;
  body: string;
  createdAt: string;
  path?: string;
  line?: number | null;
  diffHunk?: string;
  isReply?: boolean;
}

export interface CiCheck {
  name: string;
  status: "pending" | "success" | "failed" | "skipped";
  url: string;
  runId: number | null;
}

export interface PrEntry {
  repo: string;
  number: number;
  state: "open" | "closed" | "merged";
  url: string;
  updatedAt: string;
  ciStatus: "none" | "pending" | "success" | "failed";
  ciChecks: CiCheck[];
  comments: PrComment[];
}

export interface LinearIssueLabel {
  name: string;
  color: string;
}

export interface LinearIssueState {
  name: string;
  color: string;
  type: string;
}

export interface LinkedLinearIssue {
  identifier: string;
  url: string;
  state: LinearIssueState;
}

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  priority: number;
  priorityLabel: string;
  url: string;
  branchName: string;
  dueDate: string | null;
  updatedAt: string;
  state: LinearIssueState;
  team: { name: string; key: string };
  labels: LinearIssueLabel[];
  project: string | null;
}

export type WorktreeCreateMode = "new" | "existing";

export interface AvailableBranch {
  name: string;
}

export type WorktreeCreationPhase =
  | "creating_worktree"
  | "preparing_runtime"
  | "running_post_create_hook"
  | "starting_session"
  | "reconciling";

export interface WorktreeCreationState {
  phase: WorktreeCreationPhase;
}

export interface WorktreeInfo {
  branch: string;
  agent: string;
  mux: string;
  path: string;
  dir: string | null;
  dirty: boolean;
  status: string;
  elapsed: string;
  profile: string | null;
  agentName: string | null;
  services: ServiceStatus[];
  paneCount: number;
  prs: PrEntry[];
  linearIssue: LinkedLinearIssue | null;
  creating: boolean;
  creationPhase: WorktreeCreationPhase | null;
}

export interface ServiceConfig {
  name: string;
  portEnv: string;
}

export interface ProfileConfig {
  name: string;
  systemPrompt?: string;
}

export interface AppNotification {
  id: number;
  branch: string;
  type: "agent_stopped" | "pr_opened" | "runtime_error";
  message: string;
  url?: string;
  timestamp: number;
}

export interface ProjectWorktreeSnapshot {
  branch: string;
  path: string;
  dir: string;
  profile: string | null;
  agentName: string | null;
  mux: boolean;
  dirty: boolean;
  paneCount: number;
  status: string;
  elapsed: string;
  services: ServiceStatus[];
  prs: PrEntry[];
  linearIssue: LinkedLinearIssue | null;
  creation: WorktreeCreationState | null;
}

export interface ProjectSnapshot {
  project: {
    name: string;
    mainBranch: string;
  };
  worktrees: ProjectWorktreeSnapshot[];
  notifications: AppNotification[];
}

export interface LinkedRepoInfo {
  alias: string;
  dir?: string;
}

export interface AppConfig {
  name?: string;
  services: ServiceConfig[];
  profiles: ProfileConfig[];
  defaultProfileName: string;
  autoName: boolean;
  startupEnvs?: Record<string, string | boolean>;
  linkedRepos?: LinkedRepoInfo[];
}

export type ThemeKey = "github-dark" | "dracula" | "nord" | "solarized-dark" | "one-dark";
