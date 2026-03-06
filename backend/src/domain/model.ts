import type { AgentKind, RuntimeKind } from "./config";

export const WORKTREE_META_SCHEMA_VERSION = 1;

export interface WorktreeMeta {
  schemaVersion: number;
  worktreeId: string;
  branch: string;
  createdAt: string;
  profile: string;
  agent: AgentKind;
  runtime: RuntimeKind;
  startupEnvValues: Record<string, string>;
  allocatedPorts: Record<string, number>;
}

export interface WorktreeStoragePaths {
  gitDir: string;
  webmuxDir: string;
  metaPath: string;
  runtimeEnvPath: string;
  controlEnvPath: string;
}

export interface ControlEnvMap extends Record<string, string> {
  WEBMUX_CONTROL_URL: string;
  WEBMUX_CONTROL_TOKEN: string;
  WEBMUX_WORKTREE_ID: string;
  WEBMUX_BRANCH: string;
}

export type AgentLifecycle = "closed" | "starting" | "running" | "idle" | "stopped" | "error";

export interface GitWorktreeRuntimeState {
  exists: boolean;
  branch: string;
  dirty: boolean;
  aheadCount: number;
  currentCommit: string | null;
}

export interface SessionRuntimeState {
  exists: boolean;
  sessionName: string | null;
  windowName: string;
  paneCount: number;
}

export interface AgentRuntimeState {
  runtime: RuntimeKind;
  lifecycle: AgentLifecycle;
  title: string;
  lastStartedAt: string | null;
  lastEventAt: string | null;
  lastError: string | null;
}

export interface ServiceRuntimeState {
  name: string;
  port: number | null;
  running: boolean;
  url: string | null;
}

export interface ManagedWorktreeRuntimeState {
  worktreeId: string;
  branch: string;
  path: string;
  profile: string | null;
  agentName: AgentKind | null;
  git: GitWorktreeRuntimeState;
  session: SessionRuntimeState;
  agent: AgentRuntimeState;
  services: ServiceRuntimeState[];
}

export interface NotificationView {
  id: number;
  branch: string;
  type: "agent_stopped" | "pr_opened" | "runtime_error";
  message: string;
  url?: string;
  timestamp: number;
}

export interface WorktreeSnapshot {
  branch: string;
  path: string;
  dir: string;
  profile: string | null;
  agentName: AgentKind | null;
  mux: boolean;
  dirty: boolean;
  paneCount: number;
  status: string;
  elapsed: string;
  title: string;
  services: ServiceRuntimeState[];
}

export interface ProjectSnapshot {
  project: {
    name: string;
    mainBranch: string;
  };
  worktrees: WorktreeSnapshot[];
  notifications: NotificationView[];
}
