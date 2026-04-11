import { initContract } from "@ts-rest/core";
import {
  AppConfigSchema,
  AvailableBranchesQuerySchema,
  BranchListResponseSchema,
  CiLogsResponseSchema,
  CreateWorktreeRequestSchema,
  CreateWorktreeResponseSchema,
  EnabledResponseSchema,
  ErrorResponseSchema,
  OkResponseSchema,
  ProjectSnapshotSchema,
  PullMainRequestSchema,
  PullMainResponseSchema,
  RunIdParamsSchema,
  SendWorktreePromptRequestSchema,
  SetWorktreeArchivedRequestSchema,
  SetWorktreeArchivedResponseSchema,
  ToggleEnabledRequestSchema,
  WorktreeDiffResponseSchema,
  WorktreeListResponseSchema,
  WorktreeNameParamsSchema,
  NotificationIdParamsSchema,
  LinearIssuesResponseSchema,
} from "./schemas";

const c = initContract();

export const apiPaths = {
  fetchConfig: "/api/config",
  fetchAvailableBranches: "/api/branches",
  fetchBaseBranches: "/api/base-branches",
  fetchProject: "/api/project",
  fetchWorktrees: "/api/worktrees",
  createWorktree: "/api/worktrees",
  removeWorktree: "/api/worktrees/:name",
  openWorktree: "/api/worktrees/:name/open",
  closeWorktree: "/api/worktrees/:name/close",
  setWorktreeArchived: "/api/worktrees/:name/archive",
  sendWorktreePrompt: "/api/worktrees/:name/send",
  mergeWorktree: "/api/worktrees/:name/merge",
  fetchWorktreeDiff: "/api/worktrees/:name/diff",
  fetchLinearIssues: "/api/linear/issues",
  setLinearAutoCreate: "/api/linear/auto-create",
  setAutoRemoveOnMerge: "/api/github/auto-remove-on-merge",
  pullMain: "/api/pull-main",
  fetchCiLogs: "/api/ci-logs/:runId",
  dismissNotification: "/api/notifications/:id/dismiss",
} as const;

const commonErrorResponses = {
  400: ErrorResponseSchema,
  404: ErrorResponseSchema,
  409: ErrorResponseSchema,
  500: ErrorResponseSchema,
  502: ErrorResponseSchema,
  503: ErrorResponseSchema,
} as const;

export const apiContract = c.router({
  fetchConfig: {
    method: "GET",
    path: apiPaths.fetchConfig,
    responses: {
      200: AppConfigSchema,
    },
  },
  fetchAvailableBranches: {
    method: "GET",
    path: apiPaths.fetchAvailableBranches,
    query: AvailableBranchesQuerySchema,
    responses: {
      200: BranchListResponseSchema,
      400: ErrorResponseSchema,
      500: ErrorResponseSchema,
    },
  },
  fetchBaseBranches: {
    method: "GET",
    path: apiPaths.fetchBaseBranches,
    responses: {
      200: BranchListResponseSchema,
      500: ErrorResponseSchema,
    },
  },
  fetchProject: {
    method: "GET",
    path: apiPaths.fetchProject,
    responses: {
      200: ProjectSnapshotSchema,
      500: ErrorResponseSchema,
      502: ErrorResponseSchema,
    },
  },
  fetchWorktrees: {
    method: "GET",
    path: apiPaths.fetchWorktrees,
    responses: {
      200: WorktreeListResponseSchema,
      500: ErrorResponseSchema,
      502: ErrorResponseSchema,
    },
  },
  createWorktree: {
    method: "POST",
    path: apiPaths.createWorktree,
    body: CreateWorktreeRequestSchema,
    responses: {
      201: CreateWorktreeResponseSchema,
      ...commonErrorResponses,
    },
  },
  removeWorktree: {
    method: "DELETE",
    path: apiPaths.removeWorktree,
    pathParams: WorktreeNameParamsSchema,
    responses: {
      200: OkResponseSchema,
      ...commonErrorResponses,
    },
  },
  openWorktree: {
    method: "POST",
    path: apiPaths.openWorktree,
    pathParams: WorktreeNameParamsSchema,
    body: c.noBody(),
    responses: {
      200: OkResponseSchema,
      ...commonErrorResponses,
    },
  },
  closeWorktree: {
    method: "POST",
    path: apiPaths.closeWorktree,
    pathParams: WorktreeNameParamsSchema,
    body: c.noBody(),
    responses: {
      200: OkResponseSchema,
      ...commonErrorResponses,
    },
  },
  setWorktreeArchived: {
    method: "PUT",
    path: apiPaths.setWorktreeArchived,
    pathParams: WorktreeNameParamsSchema,
    body: SetWorktreeArchivedRequestSchema,
    responses: {
      200: SetWorktreeArchivedResponseSchema,
      ...commonErrorResponses,
    },
  },
  sendWorktreePrompt: {
    method: "POST",
    path: apiPaths.sendWorktreePrompt,
    pathParams: WorktreeNameParamsSchema,
    body: SendWorktreePromptRequestSchema,
    responses: {
      200: OkResponseSchema,
      ...commonErrorResponses,
    },
  },
  mergeWorktree: {
    method: "POST",
    path: apiPaths.mergeWorktree,
    pathParams: WorktreeNameParamsSchema,
    body: c.noBody(),
    responses: {
      200: OkResponseSchema,
      ...commonErrorResponses,
    },
  },
  fetchWorktreeDiff: {
    method: "GET",
    path: apiPaths.fetchWorktreeDiff,
    pathParams: WorktreeNameParamsSchema,
    responses: {
      200: WorktreeDiffResponseSchema,
      ...commonErrorResponses,
    },
  },
  fetchLinearIssues: {
    method: "GET",
    path: apiPaths.fetchLinearIssues,
    responses: {
      200: LinearIssuesResponseSchema,
      500: ErrorResponseSchema,
      502: ErrorResponseSchema,
    },
  },
  setLinearAutoCreate: {
    method: "PUT",
    path: apiPaths.setLinearAutoCreate,
    body: ToggleEnabledRequestSchema,
    responses: {
      200: EnabledResponseSchema,
      ...commonErrorResponses,
    },
  },
  setAutoRemoveOnMerge: {
    method: "PUT",
    path: apiPaths.setAutoRemoveOnMerge,
    body: ToggleEnabledRequestSchema,
    responses: {
      200: EnabledResponseSchema,
      ...commonErrorResponses,
    },
  },
  pullMain: {
    method: "POST",
    path: apiPaths.pullMain,
    body: PullMainRequestSchema,
    responses: {
      200: PullMainResponseSchema,
      ...commonErrorResponses,
    },
  },
  fetchCiLogs: {
    method: "GET",
    path: apiPaths.fetchCiLogs,
    pathParams: RunIdParamsSchema,
    responses: {
      200: CiLogsResponseSchema,
      ...commonErrorResponses,
    },
  },
  dismissNotification: {
    method: "POST",
    path: apiPaths.dismissNotification,
    pathParams: NotificationIdParamsSchema,
    body: c.noBody(),
    responses: {
      200: OkResponseSchema,
      400: ErrorResponseSchema,
      404: ErrorResponseSchema,
    },
  },
}, {
  strictStatusCodes: true,
});
