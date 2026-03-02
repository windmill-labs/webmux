export interface ServiceStatus {
  name: string;
  port: number | null;
  running: boolean;
}

export interface PrComment {
  author: string;
  body: string;
  createdAt: string;
}

export interface CiCheck {
  name: string;
  status: string;
  url: string;
  runId: number;
}

export interface PrEntry {
  repo: string;
  number: number;
  state: string;
  url: string;
  ciStatus: string;
  ciChecks: CiCheck[];
  comments: PrComment[];
}

export interface LinearIssueLabel {
  name: string;
  color: string;
}

export interface LinkedLinearIssue {
  identifier: string;
  url: string;
  state: { name: string; color: string; type: string };
}

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description: string;
  priority: number;
  priorityLabel: string;
  url: string;
  branchName: string;
  dueDate: string | null;
  updatedAt: string;
  state: { name: string; color: string; type: string };
  team: { name: string; key: string };
  labels: LinearIssueLabel[];
  project: string | null;
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
  title: string;
  profile: string | null;
  agentName: string | null;
  services: ServiceStatus[];
  paneCount: number;
  prs: PrEntry[];
  linearIssue: LinkedLinearIssue | null;
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
  type: "agent_stopped" | "pr_opened";
  message: string;
  url?: string;
  timestamp: number;
}

export interface AppConfig {
  services: ServiceConfig[];
  profiles: {
    default: ProfileConfig;
    sandbox?: ProfileConfig;
  };
  autoName: boolean;
}
