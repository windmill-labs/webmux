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

export const AgentKindSchema = z.enum(["claude", "codex"]);
export const CreateWorktreeAgentSelectionSchema = z.enum(["claude", "codex", "both"]);
export const WorktreeCreateModeSchema = z.enum(["new", "existing"]);
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

export const CreateWorktreeRequestSchema = z.object({
  mode: WorktreeCreateModeSchema.optional(),
  branch: z.string().optional(),
  baseBranch: z.string().optional(),
  profile: z.string().optional(),
  agent: CreateWorktreeAgentSelectionSchema.optional(),
  prompt: z.string().optional(),
  envOverrides: z.record(z.string()).optional(),
  createLinearTicket: z.literal(true).optional(),
  linearTitle: z.string().optional(),
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

export const ToggleEnabledRequestSchema = z.object({
  enabled: z.boolean(),
});

export const SendWorktreePromptRequestSchema = z.object({
  text: z.string().min(1),
  preamble: z.string().optional(),
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

export const ProjectWorktreeSnapshotSchema = z.object({
  branch: z.string(),
  baseBranch: z.string().optional(),
  path: z.string(),
  dir: z.string(),
  archived: z.boolean(),
  profile: z.string().nullable(),
  agentName: AgentKindSchema.nullable(),
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
});

export const ProjectSnapshotSchema = z.object({
  project: z.object({
    name: z.string(),
    mainBranch: z.string(),
  }),
  worktrees: z.array(ProjectWorktreeSnapshotSchema),
  notifications: z.array(AppNotificationSchema),
});

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
  defaultProfileName: z.string(),
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

export const NotificationIdParamsSchema = z.object({
  id: NumberLikePathParamSchema,
});

export const RunIdParamsSchema = z.object({
  runId: NumberLikePathParamSchema,
});

export type AgentKind = z.infer<typeof AgentKindSchema>;
export type CreateWorktreeAgentSelection = z.infer<typeof CreateWorktreeAgentSelectionSchema>;
export type WorktreeCreateMode = z.infer<typeof WorktreeCreateModeSchema>;
export type WorktreeCreationPhase = z.infer<typeof WorktreeCreationPhaseSchema>;
export type AvailableBranch = z.infer<typeof AvailableBranchSchema>;
// Keep this manual so frontend callers pass booleans instead of raw `"true"`/`"false"` query literals.
export type AvailableBranchesQuery = { includeRemote?: boolean };
export type BranchListResponse = z.infer<typeof BranchListResponseSchema>;
export type CreateWorktreeRequest = z.infer<typeof CreateWorktreeRequestSchema>;
export type CreateWorktreeResponse = z.infer<typeof CreateWorktreeResponseSchema>;
export type SetWorktreeArchivedRequest = z.infer<typeof SetWorktreeArchivedRequestSchema>;
export type SetWorktreeArchivedResponse = z.infer<typeof SetWorktreeArchivedResponseSchema>;
export type ToggleEnabledRequest = z.infer<typeof ToggleEnabledRequestSchema>;
export type SendWorktreePromptRequest = z.infer<typeof SendWorktreePromptRequestSchema>;
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
export type WorktreeCreationState = z.infer<typeof WorktreeCreationStateSchema>;
export type AppNotification = z.infer<typeof AppNotificationSchema>;
export type ProjectWorktreeSnapshot = z.infer<typeof ProjectWorktreeSnapshotSchema>;
export type ProjectSnapshot = z.infer<typeof ProjectSnapshotSchema>;
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
