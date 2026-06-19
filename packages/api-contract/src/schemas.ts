import { z } from "zod";

const BooleanLikeSchema = z.union([
  z.boolean(),
  z.literal("true").transform(() => true),
  z.literal("false").transform(() => false),
]);

export const ErrorResponseSchema = z.object({
  error: z.string(),
});

export const OkResponseSchema = z.object({
  ok: z.literal(true),
});

export const EnabledResponseSchema = z.object({
  ok: z.literal(true),
  enabled: z.boolean(),
});

export const BuiltInAgentIdSchema = z.enum(["claude", "codex"]);
export const AgentIdSchema = z.string().trim().min(1);
export const AgentKindSchema = BuiltInAgentIdSchema;
export const WorktreeCreateModeSchema = z.enum(["new", "existing"]);

export const LinearIssueIdSchema = z.string().regex(/^[A-Z]+-\d+$/, "Expected Linear issue id (e.g. ENG-123)");
export const LinearTeamKeySchema = z.string().regex(/^[A-Z]+$/, "Expected Linear team key (e.g. ENG)");

/** Distinguishes a Linear issue id (TEAM-123) from a team key (TEAM). */
export type LinearTarget =
  | { kind: "issue"; issueId: string }
  | { kind: "team"; teamKey: string }
  | { kind: "invalid"; raw: string };

export function parseLinearTarget(raw: string): LinearTarget {
  const trimmed = raw.trim();
  if (LinearIssueIdSchema.safeParse(trimmed).success) return { kind: "issue", issueId: trimmed };
  if (LinearTeamKeySchema.safeParse(trimmed).success) return { kind: "team", teamKey: trimmed };
  return { kind: "invalid", raw: trimmed };
}

export const PostWorktreeToLinearTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("issue"), issueId: LinearIssueIdSchema }),
  z.object({ kind: z.literal("team"), teamKey: LinearTeamKeySchema, title: z.string().trim().min(1).optional() }),
]);

export const PostWorktreeToLinearRequestSchema = z.object({
  target: PostWorktreeToLinearTargetSchema,
});

export const PostWorktreeToLinearResponseSchema = z.object({
  ok: z.literal(true),
  issueId: z.string(),
  issueUrl: z.string(),
  commentUrl: z.string().nullable(),
  attachmentUrl: z.string(),
});

export const FromLinearInputSchema = z.object({
  issueId: LinearIssueIdSchema,
  conversationContext: z.string().optional(),
});

/** Oneshot watch config carried on create/open requests. When present, the server-side
 *  oneshot watcher will auto-close the session (and optionally post to Linear) once the
 *  agent finishes. Any browser-originated interaction with the session disarms the watcher. */
export const OneshotConfigSchema = z.object({
  autoCloseOnDone: z.boolean().optional(),
  postToLinearOnDone: PostWorktreeToLinearTargetSchema.optional(),
});

export const AgentCapabilitiesSchema = z.object({
  terminal: z.literal(true),
  inAppChat: z.boolean(),
  conversationHistory: z.boolean(),
  interrupt: z.boolean(),
  resume: z.boolean(),
});

export const AgentSummarySchema = z.object({
  id: AgentIdSchema,
  label: z.string(),
  kind: z.enum(["builtin", "custom"]),
  capabilities: AgentCapabilitiesSchema,
});

export const AgentDetailsSchema = z.object({
  id: AgentIdSchema,
  label: z.string(),
  kind: z.enum(["builtin", "custom"]),
  capabilities: AgentCapabilitiesSchema,
  startCommand: z.string().nullable(),
  resumeCommand: z.string().nullable(),
});

export const AgentListResponseSchema = z.object({
  agents: z.array(AgentDetailsSchema),
});

export const UpsertCustomAgentRequestSchema = z.object({
  label: z.string().trim().min(1),
  startCommand: z.string().trim().min(1),
  resumeCommand: z.string().trim().optional(),
});

export const AgentResponseSchema = z.object({
  agent: AgentDetailsSchema,
});

export const ValidateCustomAgentResponseSchema = z.object({
  normalizedId: AgentIdSchema,
  warnings: z.array(z.string()),
});
export const WorktreeCreationPhaseSchema = z.enum([
  "creating_worktree",
  "preparing_runtime",
  "running_post_create_hook",
  "starting_session",
  "reconciling",
]);

export const AvailableBranchSchema = z.object({
  name: z.string(),
});

export const AvailableBranchesQuerySchema = z.object({
  includeRemote: BooleanLikeSchema.optional(),
});

const NumberLikePathParamSchema = z.union([
  z.number().int().nonnegative(),
  z.string().regex(/^\d+$/).transform((value) => Number(value)),
]);

export const BranchListResponseSchema = z.object({
  branches: z.array(AvailableBranchSchema),
});

export const WorktreeSourceSchema = z.enum(["ui", "oneshot"]);

export const CreateWorktreeRequestSchema = z.object({
  mode: WorktreeCreateModeSchema.optional(),
  branch: z.string().optional(),
  baseBranch: z.string().optional(),
  profile: z.string().optional(),
  agent: AgentIdSchema.optional(),
  agents: z.array(AgentIdSchema).min(1).optional(),
  prompt: z.string().optional(),
  envOverrides: z.record(z.string()).optional(),
  createLinearTicket: z.literal(true).optional(),
  linearTitle: z.string().optional(),
  // Accept any case at the boundary, then normalize and validate against the
  // team-key shape. Invalid inputs (e.g. "ENG-1") get a clear 400 instead of
  // being forwarded to Linear for a vague 404.
  linearTeamKey: z.string()
    .trim()
    .transform((value) => value.toUpperCase())
    .pipe(LinearTeamKeySchema)
    .optional(),
  fromLinear: FromLinearInputSchema.optional(),
  source: WorktreeSourceSchema.optional(),
  oneshot: OneshotConfigSchema.optional(),
});

export const OpenWorktreeRequestSchema = z.object({
  prompt: z.string().optional(),
  oneshot: OneshotConfigSchema.optional(),
});

export const CreateWorktreeResponseSchema = z.object({
  primaryBranch: z.string(),
  branches: z.array(z.string()),
});

export const SetWorktreeArchivedRequestSchema = z.object({
  archived: z.boolean(),
});

export const SetWorktreeArchivedResponseSchema = z.object({
  ok: z.literal(true),
  archived: z.boolean(),
});

export const SetWorktreeLabelRequestSchema = z.object({
  label: z.string().trim().max(80).nullable(),
});

export const SetWorktreeLabelResponseSchema = z.object({
  ok: z.literal(true),
  label: z.string().nullable(),
});

export const ToggleEnabledRequestSchema = z.object({
  enabled: z.boolean(),
});

export const SendWorktreePromptRequestSchema = z.object({
  text: z.string().min(1),
  preamble: z.string().optional(),
});

export const AgentsSendMessageRequestSchema = z.object({
  text: z.string().trim().min(1),
});

export const PullMainRequestSchema = z.object({
  force: z.boolean().optional(),
  repo: z.string().optional(),
});

export const PullMainStatusSchema = z.enum([
  "updated",
  "already_up_to_date",
  "fetch_failed",
  "merge_failed",
]);

export const PullMainResponseSchema = z.object({
  status: PullMainStatusSchema,
  from: z.string().optional(),
  to: z.string().optional(),
  error: z.string().optional(),
});

export const ServiceStatusSchema = z.object({
  name: z.string(),
  port: z.number().nullable(),
  running: z.boolean(),
  url: z.string().nullable().optional(),
});

export const PrCommentSchema = z.object({
  type: z.enum(["comment", "inline"]),
  author: z.string(),
  body: z.string(),
  createdAt: z.string(),
  path: z.string().optional(),
  line: z.number().nullable().optional(),
  diffHunk: z.string().optional(),
  isReply: z.boolean().optional(),
});

export const CiCheckSchema = z.object({
  name: z.string(),
  status: z.enum(["pending", "success", "failed", "skipped"]),
  url: z.string().nullable(),
  runId: z.number().nullable(),
});

export const PrEntrySchema = z.object({
  repo: z.string(),
  number: z.number(),
  state: z.enum(["open", "closed", "merged"]),
  url: z.string(),
  updatedAt: z.string(),
  ciStatus: z.enum(["none", "pending", "success", "failed"]),
  ciChecks: z.array(CiCheckSchema),
  comments: z.array(PrCommentSchema),
});

export const LinearIssueLabelSchema = z.object({
  name: z.string(),
  color: z.string(),
});

export const LinearIssueStateSchema = z.object({
  name: z.string(),
  color: z.string(),
  type: z.string(),
});

export const LinkedLinearIssueSchema = z.object({
  identifier: z.string(),
  url: z.string(),
  state: LinearIssueStateSchema,
});

export const LinearIssueSchema = z.object({
  id: z.string(),
  identifier: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  priority: z.number(),
  priorityLabel: z.string(),
  url: z.string(),
  branchName: z.string(),
  dueDate: z.string().nullable(),
  updatedAt: z.string(),
  state: LinearIssueStateSchema,
  team: z.object({
    name: z.string(),
    key: z.string(),
  }),
  labels: z.array(LinearIssueLabelSchema),
  project: z.string().nullable(),
});

export const LinearIssueAvailabilitySchema = z.enum(["disabled", "missing_api_key", "ready"]);

export const LinearIssuesResponseSchema = z.object({
  availability: LinearIssueAvailabilitySchema,
  issues: z.array(LinearIssueSchema),
});

export const AutoNameProviderSchema = z.enum(["claude", "codex"]);

export const AutoNameConfigResponseSchema = z.object({
  autoName: z.object({
    provider: AutoNameProviderSchema,
    model: z.string().optional(),
    systemPrompt: z.string().optional(),
  }).nullable(),
  linearAvailability: LinearIssueAvailabilitySchema,
});

export const WorktreeCreationStateSchema = z.object({
  phase: WorktreeCreationPhaseSchema,
});

export const AppNotificationSchema = z.object({
  id: z.number(),
  branch: z.string(),
  type: z.enum(["agent_stopped", "pr_opened", "runtime_error", "worktree_auto_removed"]),
  message: z.string(),
  url: z.string().optional(),
  timestamp: z.number(),
});

export const WorktreeTabSchema = z.object({
  tabId: z.string(),
  kind: z.enum(["root", "fork"]),
  label: z.string(),
  seq: z.number().nullable(),
  sessionId: z.string().nullable(),
  paneId: z.string().optional(),
  createdAt: z.string(),
});

export const ProjectWorktreeSnapshotSchema = z.object({
  branch: z.string(),
  label: z.string().nullable(),
  baseBranch: z.string().optional(),
  path: z.string(),
  dir: z.string(),
  archived: z.boolean(),
  profile: z.string().nullable(),
  agentName: AgentIdSchema.nullable(),
  agentLabel: z.string().nullable(),
  agentTerminalStale: z.boolean(),
  mux: z.boolean(),
  dirty: z.boolean(),
  unpushed: z.boolean(),
  paneCount: z.number(),
  status: z.string(),
  elapsed: z.string(),
  services: z.array(ServiceStatusSchema),
  prs: z.array(PrEntrySchema),
  linearIssue: LinkedLinearIssueSchema.nullable(),
  creation: WorktreeCreationStateSchema.nullable(),
  source: WorktreeSourceSchema,
  /** Present when the server-side oneshot watcher is armed for this worktree.
   *  Cleared by `disarmOneshot` on the first browser-originated interaction.
   *  CLI clients read this to detect "user took over" mid-run. */
  oneshot: OneshotConfigSchema.nullable(),
  /** Agent-pane tabs (`tabs[0]` is the root). Default keeps older servers valid. */
  tabs: z.array(WorktreeTabSchema).default([]),
  activeTabId: z.string().nullable().default(null),
});

export const ProjectSnapshotSchema = z.object({
  project: z.object({
    name: z.string(),
    mainBranch: z.string(),
  }),
  worktrees: z.array(ProjectWorktreeSnapshotSchema),
  notifications: z.array(AppNotificationSchema),
});

export const WorktreeConversationProviderSchema = z.enum(["codexAppServer", "claudeCode"]);

export const CodexWorktreeConversationRefSchema = z.object({
  provider: z.literal("codexAppServer"),
  conversationId: z.string(),
  cwd: z.string(),
  lastSeenAt: z.string(),
  threadId: z.string(),
});

export const ClaudeWorktreeConversationRefSchema = z.object({
  provider: z.literal("claudeCode"),
  conversationId: z.string(),
  cwd: z.string(),
  lastSeenAt: z.string(),
  sessionId: z.string(),
});

export const WorktreeConversationRefSchema = z.discriminatedUnion("provider", [
  CodexWorktreeConversationRefSchema,
  ClaudeWorktreeConversationRefSchema,
]);

export const AgentsUiWorktreeSummarySchema = z.object({
  branch: z.string(),
  baseBranch: z.string().optional(),
  path: z.string(),
  archived: z.boolean(),
  profile: z.string().nullable(),
  agentName: AgentIdSchema.nullable(),
  agentLabel: z.string().nullable(),
  agentTerminalStale: z.boolean(),
  mux: z.boolean(),
  status: z.string(),
  dirty: z.boolean(),
  unpushed: z.boolean(),
  services: z.array(ServiceStatusSchema),
  prs: z.array(PrEntrySchema),
  creating: z.boolean(),
  creationPhase: WorktreeCreationPhaseSchema.nullable(),
  conversation: WorktreeConversationRefSchema.nullable(),
});

export const AgentsUiConversationMessageRoleSchema = z.enum(["user", "assistant"]);
export const AgentsUiConversationMessageStatusSchema = z.enum(["completed", "inProgress", "failed"]);
export const AgentsUiConversationMessageKindSchema = z.enum(["text", "thinking", "toolUse", "toolResult"]);

export const AgentsUiConversationMessageSchema = z.object({
  id: z.string(),
  turnId: z.string(),
  order: z.number().int().nonnegative(),
  role: AgentsUiConversationMessageRoleSchema,
  text: z.string(),
  status: AgentsUiConversationMessageStatusSchema,
  createdAt: z.string().nullable(),
  kind: AgentsUiConversationMessageKindSchema,
  phase: z.string().optional(),
  toolName: z.string().optional(),
  toolCallId: z.string().optional(),
  command: z.string().optional(),
  cwd: z.string().optional(),
  exitCode: z.number().nullable().optional(),
  durationMs: z.number().nullable().optional(),
});

export const AgentsUiConversationStateSchema = z.object({
  provider: WorktreeConversationProviderSchema,
  conversationId: z.string(),
  cwd: z.string(),
  running: z.boolean(),
  activeTurnId: z.string().nullable(),
  messages: z.array(AgentsUiConversationMessageSchema),
});

export const AgentsUiWorktreeConversationResponseSchema = z.object({
  worktree: AgentsUiWorktreeSummarySchema,
  conversation: AgentsUiConversationStateSchema,
});

export const AgentsUiSendMessageResponseSchema = z.object({
  conversationId: z.string(),
  turnId: z.string(),
  running: z.literal(true),
  streaming: z.boolean(),
});

export const AgentsUiInterruptResponseSchema = z.object({
  conversationId: z.string(),
  turnId: z.string(),
  interrupted: z.literal(true),
  streaming: z.boolean(),
});

export const AgentsUiConversationMessageDeltaEventSchema = z.object({
  type: z.literal("messageDelta"),
  revision: z.number().int().nonnegative(),
  conversationId: z.string(),
  turnId: z.string(),
  itemId: z.string(),
  order: z.number().int().nonnegative(),
  delta: z.string(),
});

export const AgentsUiConversationMessageUpsertEventSchema = z.object({
  type: z.literal("messageUpsert"),
  revision: z.number().int().nonnegative(),
  conversationId: z.string(),
  message: AgentsUiConversationMessageSchema,
});

export const AgentsUiConversationStatusEventSchema = z.object({
  type: z.literal("conversationStatus"),
  revision: z.number().int().nonnegative(),
  conversationId: z.string(),
  running: z.boolean(),
  activeTurnId: z.string().nullable(),
});

export const AgentsUiConversationErrorEventSchema = z.object({
  type: z.literal("error"),
  message: z.string(),
});

export const AgentsUiConversationEventSchema = z.discriminatedUnion("type", [
  AgentsUiConversationMessageDeltaEventSchema,
  AgentsUiConversationMessageUpsertEventSchema,
  AgentsUiConversationStatusEventSchema,
  AgentsUiConversationErrorEventSchema,
]);

export const WorktreeListResponseSchema = z.object({
  worktrees: z.array(ProjectWorktreeSnapshotSchema),
});

export const UnpushedCommitSchema = z.object({
  hash: z.string(),
  message: z.string(),
});

export const WorktreeDiffResponseSchema = z.object({
  uncommitted: z.string(),
  uncommittedTruncated: z.boolean(),
  gitStatus: z.string(),
  unpushedCommits: z.array(UnpushedCommitSchema),
});

export const ServiceConfigSchema = z.object({
  name: z.string(),
  portEnv: z.string(),
});

export const ProfileConfigSchema = z.object({
  name: z.string(),
  systemPrompt: z.string().optional(),
});

export const LinkedRepoInfoSchema = z.object({
  alias: z.string(),
  dir: z.string().optional(),
});

export const AppConfigSchema = z.object({
  name: z.string(),
  services: z.array(ServiceConfigSchema),
  profiles: z.array(ProfileConfigSchema),
  agents: z.array(AgentSummarySchema),
  defaultProfileName: z.string(),
  defaultAgentId: BuiltInAgentIdSchema,
  autoName: z.boolean(),
  linearCreateTicketOption: z.boolean(),
  startupEnvs: z.record(z.union([z.string(), z.boolean()])),
  linkedRepos: z.array(LinkedRepoInfoSchema),
  linearAutoCreateWorktrees: z.boolean(),
  autoRemoveOnMerge: z.boolean(),
  projectDir: z.string(),
  mainBranch: z.string(),
});

export const CiLogsResponseSchema = z.object({
  logs: z.string(),
});

export const WorktreeNameParamsSchema = z.object({
  name: z.string(),
});

export const WorktreeTabParamsSchema = z.object({
  name: z.string(),
  tabId: z.string(),
});

export const CreateTabResponseSchema = z.object({
  tab: WorktreeTabSchema,
});

export const NotificationIdParamsSchema = z.object({
  id: NumberLikePathParamSchema,
});

export const AgentIdParamsSchema = z.object({
  id: AgentIdSchema,
});

export const RunIdParamsSchema = z.object({
  runId: NumberLikePathParamSchema,
});

export const InstanceSummarySchema = z.object({
  prefix: z.string(),
  port: z.number(),
  projectDir: z.string(),
  startedAt: z.number(),
});

export const InstancesResponseSchema = z.object({
  instances: z.array(InstanceSummarySchema),
});

export type InstanceSummary = z.infer<typeof InstanceSummarySchema>;
export type InstancesResponse = z.infer<typeof InstancesResponseSchema>;

export type BuiltInAgentId = z.infer<typeof BuiltInAgentIdSchema>;
export type AgentId = z.infer<typeof AgentIdSchema>;
export type AgentKind = z.infer<typeof AgentKindSchema>;
export type AgentCapabilities = z.infer<typeof AgentCapabilitiesSchema>;
export type AgentSummary = z.infer<typeof AgentSummarySchema>;
export type AgentDetails = z.infer<typeof AgentDetailsSchema>;
export type AgentListResponse = z.infer<typeof AgentListResponseSchema>;
export type UpsertCustomAgentRequest = z.infer<typeof UpsertCustomAgentRequestSchema>;
export type AgentResponse = z.infer<typeof AgentResponseSchema>;
export type ValidateCustomAgentResponse = z.infer<typeof ValidateCustomAgentResponseSchema>;
export type WorktreeCreateMode = z.infer<typeof WorktreeCreateModeSchema>;
export type LinearIssueId = z.infer<typeof LinearIssueIdSchema>;
export type LinearTeamKey = z.infer<typeof LinearTeamKeySchema>;
export type PostWorktreeToLinearTarget = z.infer<typeof PostWorktreeToLinearTargetSchema>;
export type PostWorktreeToLinearRequest = z.infer<typeof PostWorktreeToLinearRequestSchema>;
export type PostWorktreeToLinearResponse = z.infer<typeof PostWorktreeToLinearResponseSchema>;
export type FromLinearInput = z.infer<typeof FromLinearInputSchema>;
export type OneshotConfig = z.infer<typeof OneshotConfigSchema>;
export type WorktreeCreationPhase = z.infer<typeof WorktreeCreationPhaseSchema>;
export type AvailableBranch = z.infer<typeof AvailableBranchSchema>;
// Keep this manual so frontend callers pass booleans instead of raw `"true"`/`"false"` query literals.
export type AvailableBranchesQuery = { includeRemote?: boolean };
export type BranchListResponse = z.infer<typeof BranchListResponseSchema>;
export type CreateWorktreeRequest = z.infer<typeof CreateWorktreeRequestSchema>;
export type OpenWorktreeRequest = z.infer<typeof OpenWorktreeRequestSchema>;
export type WorktreeSource = z.infer<typeof WorktreeSourceSchema>;
export type CreateWorktreeResponse = z.infer<typeof CreateWorktreeResponseSchema>;
export type SetWorktreeArchivedRequest = z.infer<typeof SetWorktreeArchivedRequestSchema>;
export type SetWorktreeArchivedResponse = z.infer<typeof SetWorktreeArchivedResponseSchema>;
export type SetWorktreeLabelRequest = z.infer<typeof SetWorktreeLabelRequestSchema>;
export type SetWorktreeLabelResponse = z.infer<typeof SetWorktreeLabelResponseSchema>;
export type ToggleEnabledRequest = z.infer<typeof ToggleEnabledRequestSchema>;
export type SendWorktreePromptRequest = z.infer<typeof SendWorktreePromptRequestSchema>;
export type AgentsSendMessageRequest = z.infer<typeof AgentsSendMessageRequestSchema>;
export type PullMainRequest = z.infer<typeof PullMainRequestSchema>;
export type PullMainResult = z.infer<typeof PullMainResponseSchema>;
export type ServiceStatus = z.infer<typeof ServiceStatusSchema>;
export type PrComment = z.infer<typeof PrCommentSchema>;
export type CiCheck = z.infer<typeof CiCheckSchema>;
export type PrEntry = z.infer<typeof PrEntrySchema>;
export type LinearIssueLabel = z.infer<typeof LinearIssueLabelSchema>;
export type LinearIssueState = z.infer<typeof LinearIssueStateSchema>;
export type LinkedLinearIssue = z.infer<typeof LinkedLinearIssueSchema>;
export type LinearIssue = z.infer<typeof LinearIssueSchema>;
export type LinearIssueAvailability = z.infer<typeof LinearIssueAvailabilitySchema>;
export type LinearIssuesResponse = z.infer<typeof LinearIssuesResponseSchema>;
export type AutoNameConfigResponse = z.infer<typeof AutoNameConfigResponseSchema>;
export type WorktreeCreationState = z.infer<typeof WorktreeCreationStateSchema>;
export type AppNotification = z.infer<typeof AppNotificationSchema>;
export type ProjectWorktreeSnapshot = z.infer<typeof ProjectWorktreeSnapshotSchema>;
export type WorktreeTab = z.infer<typeof WorktreeTabSchema>;
export type WorktreeTabParams = z.infer<typeof WorktreeTabParamsSchema>;
export type CreateTabResponse = z.infer<typeof CreateTabResponseSchema>;
export type ProjectSnapshot = z.infer<typeof ProjectSnapshotSchema>;
export type WorktreeConversationProvider = z.infer<typeof WorktreeConversationProviderSchema>;
export type CodexWorktreeConversationRef = z.infer<typeof CodexWorktreeConversationRefSchema>;
export type ClaudeWorktreeConversationRef = z.infer<typeof ClaudeWorktreeConversationRefSchema>;
export type WorktreeConversationRef = z.infer<typeof WorktreeConversationRefSchema>;
export type AgentsUiWorktreeSummary = z.infer<typeof AgentsUiWorktreeSummarySchema>;
export type AgentsUiConversationMessageRole = z.infer<typeof AgentsUiConversationMessageRoleSchema>;
export type AgentsUiConversationMessageStatus = z.infer<typeof AgentsUiConversationMessageStatusSchema>;
export type AgentsUiConversationMessageKind = z.infer<typeof AgentsUiConversationMessageKindSchema>;
export type AgentsUiConversationMessage = z.infer<typeof AgentsUiConversationMessageSchema>;
export type AgentsUiConversationState = z.infer<typeof AgentsUiConversationStateSchema>;
export type AgentsUiWorktreeConversationResponse = z.infer<typeof AgentsUiWorktreeConversationResponseSchema>;
export type AgentsUiSendMessageResponse = z.infer<typeof AgentsUiSendMessageResponseSchema>;
export type AgentsUiInterruptResponse = z.infer<typeof AgentsUiInterruptResponseSchema>;
export type AgentsUiConversationMessageDeltaEvent = z.infer<typeof AgentsUiConversationMessageDeltaEventSchema>;
export type AgentsUiConversationMessageUpsertEvent = z.infer<typeof AgentsUiConversationMessageUpsertEventSchema>;
export type AgentsUiConversationStatusEvent = z.infer<typeof AgentsUiConversationStatusEventSchema>;
export type AgentsUiConversationErrorEvent = z.infer<typeof AgentsUiConversationErrorEventSchema>;
export type AgentsUiConversationEvent = z.infer<typeof AgentsUiConversationEventSchema>;
export type WorktreeListResponse = z.infer<typeof WorktreeListResponseSchema>;
export type UnpushedCommit = z.infer<typeof UnpushedCommitSchema>;
export type WorktreeDiffResponse = z.infer<typeof WorktreeDiffResponseSchema>;
export type ServiceConfig = z.infer<typeof ServiceConfigSchema>;
export type ProfileConfig = z.infer<typeof ProfileConfigSchema>;
export type LinkedRepoInfo = z.infer<typeof LinkedRepoInfoSchema>;
export type AppConfig = z.infer<typeof AppConfigSchema>;
export type CiLogsResponse = z.infer<typeof CiLogsResponseSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
export type OkResponse = z.infer<typeof OkResponseSchema>;
export type EnabledResponse = z.infer<typeof EnabledResponseSchema>;
