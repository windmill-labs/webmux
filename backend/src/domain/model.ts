import type { AgentId, RuntimeKind } from "./config";

export const WORKTREE_META_SCHEMA_VERSION = 1;
export const WORKTREE_ARCHIVE_STATE_VERSION = 1;
export const OPEN_SESSIONS_STATE_VERSION = 1;

export type WorktreeConversationProvider = "codexAppServer" | "claudeCode";

interface WorktreeConversationMetaBase {
  provider: WorktreeConversationProvider;
  conversationId: string;
  cwd: string;
  lastSeenAt: string;
}

export interface CodexWorktreeConversationMeta extends WorktreeConversationMetaBase {
  provider: "codexAppServer";
  threadId: string;
}

export interface ClaudeWorktreeConversationMeta extends WorktreeConversationMetaBase {
  provider: "claudeCode";
  sessionId: string;
}

export type WorktreeConversationMeta =
  | CodexWorktreeConversationMeta
  | ClaudeWorktreeConversationMeta;

export type WorktreeTabKind = "root" | "fork";

/** A claude/codex session shown as a tab above the agent terminal pane. The
 *  root tab is the original session; forks are `--fork-session` children of it.
 *  `paneId` is the live tmux pane id (`%N`) and is ephemeral — it is recaptured
 *  whenever the session is rematerialized. `sessionId`/`tabId`/`seq` are durable. */
export interface WorktreeTab {
  tabId: string;
  kind: WorktreeTabKind;
  label: string;
  seq: number | null;
  sessionId: string | null;
  paneId?: string;
  createdAt: string;
}

export type WorktreeSource = "ui" | "oneshot";

/** Linear post-back target embedded in oneshot meta. Re-exported from the
 *  contract so meta + wire shapes stay in lockstep. */
export type OneshotPostTarget = import("@webmux/api-contract").PostWorktreeToLinearTarget;

/** Per-worktree oneshot watch state. Persisted on disk; the server-side watcher
 *  reads it to decide when to auto-close / post back to Linear. Presence of this
 *  field is the "armed" signal — any browser-originated interaction clears it. */
export interface OneshotMeta {
  autoCloseOnDone: boolean;
  postToLinearOnDone?: OneshotPostTarget;
}

export interface WorktreeMeta {
  schemaVersion: number;
  worktreeId: string;
  branch: string;
  label?: string;
  baseBranch?: string;
  createdAt: string;
  profile: string;
  agent: AgentId;
  runtime: RuntimeKind;
  startupEnvValues: Record<string, string>;
  allocatedPorts: Record<string, number>;
  source?: WorktreeSource;
  oneshot?: OneshotMeta;
  conversation?: WorktreeConversationMeta | null;
  agentTerminalStale?: boolean;
  /** Agent-pane tabs. `tabs[0]` is always the root. Absent on worktrees created
   *  before tabs existed — `normalizeWorktreeMeta` backfills a single root tab. */
  tabs?: WorktreeTab[];
  activeTabId?: string;
  /** Monotonic fork numbering, never reused: deleting Fork 2 still yields Fork 4 next. */
  forkCounter?: number;
}

export const ROOT_TAB_ID = "root";

/** The session id a tab should treat as the active conversation, regardless of
 *  agent (claude stores `sessionId`, codex stores `threadId`). */
export function conversationSessionId(conversation: WorktreeConversationMeta | null | undefined): string | null {
  if (!conversation) return null;
  return conversation.provider === "codexAppServer" ? conversation.threadId : conversation.sessionId;
}

export interface ArchivedWorktreeEntry {
  path: string;
  archivedAt: string;
}

export interface WorktreeArchiveState {
  schemaVersion: number;
  entries: ArchivedWorktreeEntry[];
}

/** A periodically-saved snapshot of which worktree sessions were open, so
 *  `webmux restore` can re-open them after a server restart or reboot. */
export interface OpenSessionsState {
  schemaVersion: number;
  savedAt: string;
  branches: string[];
}

export interface WorktreeStoragePaths {
  gitDir: string;
  webmuxDir: string;
  metaPath: string;
  runtimeEnvPath: string;
  controlEnvPath: string;
  prsPath: string;
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
  url: string | null;
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

export type WorktreeCreationPhase =
  | "creating_worktree"
  | "preparing_runtime"
  | "running_post_create_hook"
  | "starting_session"
  | "reconciling";

export interface CreatingWorktreeState {
  branch: string;
  baseBranch?: string;
  path: string;
  profile: string | null;
  agentName: AgentId | null;
  phase: WorktreeCreationPhase;
  source: WorktreeSource;
}

export interface WorktreeCreationSnapshot {
  phase: WorktreeCreationPhase;
}

export interface ManagedWorktreeRuntimeState {
  worktreeId: string;
  branch: string;
  label: string | null;
  baseBranch: string | null;
  path: string;
  profile: string | null;
  agentName: AgentId | null;
  source: WorktreeSource;
  oneshot: OneshotMeta | null;
  agentTerminalStale: boolean;
  tabs: WorktreeTab[];
  activeTabId: string | null;
  git: GitWorktreeRuntimeState;
  session: SessionRuntimeState;
  agent: AgentRuntimeState;
  services: ServiceRuntimeState[];
  prs: PrEntry[];
}

export interface NotificationView {
  id: number;
  branch: string;
  type: "agent_stopped" | "pr_opened" | "runtime_error" | "worktree_auto_removed";
  message: string;
  url?: string;
  timestamp: number;
}

export interface WorktreeSnapshot {
  branch: string;
  label: string | null;
  baseBranch?: string;
  path: string;
  dir: string;
  archived: boolean;
  profile: string | null;
  agentName: AgentId | null;
  agentLabel: string | null;
  agentTerminalStale: boolean;
  mux: boolean;
  dirty: boolean;
  unpushed: boolean;
  paneCount: number;
  status: string;
  elapsed: string;
  services: ServiceRuntimeState[];
  prs: PrEntry[];
  linearIssue: LinkedLinearIssue | null;
  creation: WorktreeCreationSnapshot | null;
  source: WorktreeSource;
  oneshot: OneshotMeta | null;
  tabs: WorktreeTab[];
  activeTabId: string | null;
}

export interface ProjectSnapshot {
  project: {
    name: string;
    mainBranch: string;
  };
  worktrees: WorktreeSnapshot[];
  notifications: NotificationView[];
}

export interface WorktreeListResponse {
  worktrees: WorktreeSnapshot[];
}

export interface NativeTerminalLaunch {
  worktreeId: string;
  branch: string;
  path: string;
  shellCommand: string;
}
