import { log } from "../lib/log";

export type { LinkedLinearIssue } from "../domain/model";

interface GqlError {
  message: string;
}

interface GqlResponse<T> {
  data?: T;
  errors?: GqlError[];
}

interface GqlIssueState {
  name: string;
  color: string;
  type: string;
}

interface GqlTeam {
  name: string;
  key: string;
}

interface GqlLabel {
  name: string;
  color: string;
}

interface GqlProject {
  name: string;
}

interface GqlIssueNode {
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
  state: GqlIssueState;
  team: GqlTeam;
  labels: { nodes: GqlLabel[] };
  project: GqlProject | null;
}

interface AssignedIssuesQueryData {
  viewer: {
    assignedIssues: {
      nodes: GqlIssueNode[];
    };
  };
}

interface ViewerQueryData {
  viewer: {
    id: string;
  };
}

interface GqlWorkflowStateNode {
  id: string;
  name: string;
  type: string;
}

interface TeamStatesQueryData {
  team: {
    states: {
      nodes: GqlWorkflowStateNode[];
    };
  } | null;
}

interface GqlIssueCreatePayload {
  success: boolean;
  issue: {
    id: string;
    identifier: string;
    title: string;
    url: string;
    branchName: string | null;
  } | null;
}

interface IssueCreateMutationData {
  issueCreate: GqlIssueCreatePayload;
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
  state: { name: string; color: string; type: string };
  team: { name: string; key: string };
  labels: { name: string; color: string }[];
  project: string | null;
}

export type LinearIssueAvailability = "disabled" | "missing_api_key" | "ready";

export interface LinearIssuesResponse {
  availability: LinearIssueAvailability;
  issues: LinearIssue[];
}

export type FetchIssuesResult =
  | { ok: true; data: LinearIssue[] }
  | { ok: false; error: string };

export type BuildLinearIssuesResponseResult =
  | { ok: true; data: LinearIssuesResponse }
  | { ok: false; error: string };

export interface CreatedLinearIssue {
  id: string;
  identifier: string;
  title: string;
  url: string;
  branchName: string;
}

export interface CreateLinearIssueInput {
  title: string;
  description: string;
  teamId: string;
}

export type CreateLinearIssueResult =
  | { ok: true; data: CreatedLinearIssue }
  | { ok: false; error: string };

type FetchViewerIdResult =
  | { ok: true; data: string }
  | { ok: false; error: string };

type FetchStateIdResult =
  | { ok: true; data: string }
  | { ok: false; error: string };

const ASSIGNED_ISSUES_QUERY = `
  query AssignedIssues {
    viewer {
      assignedIssues(
        filter: { state: { type: { nin: ["completed", "canceled"] } } }
        orderBy: updatedAt
        first: 50
      ) {
        nodes {
          id
          identifier
          title
          description
          priority
          priorityLabel
          url
          branchName
          dueDate
          updatedAt
          state { name color type }
          team { name key }
          labels { nodes { name color } }
          project { name }
        }
      }
    }
  }
`;

const VIEWER_QUERY = `
  query Viewer {
    viewer {
      id
    }
  }
`;

const TEAM_STATES_QUERY = `
  query TeamStates($teamId: String!) {
    team(id: $teamId) {
      states {
        nodes {
          id
          name
          type
        }
      }
    }
  }
`;

const ISSUE_CREATE_MUTATION = `
  mutation IssueCreate($input: IssueCreateInput!) {
    issueCreate(input: $input) {
      success
      issue {
        id
        identifier
        title
        url
        branchName
      }
    }
  }
`;

function gqlErrorMessage(raw: GqlResponse<unknown>): string | null {
  return raw.errors && raw.errors.length > 0
    ? raw.errors.map((error) => error.message).join("; ")
    : null;
}

export function parseIssuesResponse(raw: GqlResponse<AssignedIssuesQueryData>): FetchIssuesResult {
  const error = gqlErrorMessage(raw);
  if (error) {
    return { ok: false, error };
  }
  if (!raw.data) {
    return { ok: false, error: "No data in response" };
  }

  const issues: LinearIssue[] = raw.data.viewer.assignedIssues.nodes.map((node) => ({
    id: node.id,
    identifier: node.identifier,
    title: node.title,
    description: node.description,
    priority: node.priority,
    priorityLabel: node.priorityLabel,
    url: node.url,
    branchName: node.branchName,
    dueDate: node.dueDate,
    updatedAt: node.updatedAt,
    state: node.state,
    team: node.team,
    labels: node.labels.nodes,
    project: node.project?.name ?? null,
  }));
  return { ok: true, data: issues };
}

export function buildLinearIssuesResponse(input: {
  integrationEnabled: boolean;
  apiKey: string | undefined;
  fetchResult?: FetchIssuesResult;
}): BuildLinearIssuesResponseResult {
  if (!input.integrationEnabled) {
    return {
      ok: true,
      data: {
        availability: "disabled",
        issues: [],
      },
    };
  }

  if (!input.apiKey?.trim()) {
    return {
      ok: true,
      data: {
        availability: "missing_api_key",
        issues: [],
      },
    };
  }

  if (!input.fetchResult) {
    return { ok: false, error: "Linear fetch result required when LINEAR_API_KEY is set" };
  }

  if (!input.fetchResult.ok) {
    return input.fetchResult;
  }

  return {
    ok: true,
    data: {
      availability: "ready",
      issues: input.fetchResult.data,
    },
  };
}

function parseViewerIdResponse(raw: GqlResponse<ViewerQueryData>): FetchViewerIdResult {
  const error = gqlErrorMessage(raw);
  if (error) {
    return { ok: false, error };
  }
  const viewerId = raw.data?.viewer.id;
  if (!viewerId) {
    return { ok: false, error: "No viewer id in response" };
  }
  return { ok: true, data: viewerId };
}

function parseInProgressStateIdResponse(raw: GqlResponse<TeamStatesQueryData>): FetchStateIdResult {
  const error = gqlErrorMessage(raw);
  if (error) {
    return { ok: false, error };
  }

  const states = raw.data?.team?.states.nodes;
  if (!states) {
    return { ok: false, error: "No team states in response" };
  }

  const preferredState = states.find((state) =>
    state.type === "started" && state.name.trim().toLowerCase() === "in progress"
  );
  if (preferredState) {
    return { ok: true, data: preferredState.id };
  }

  const startedState = states.find((state) => state.type === "started");
  if (!startedState) {
    return { ok: false, error: "No started workflow state found for team" };
  }

  return { ok: true, data: startedState.id };
}

export function parseIssueCreateResponse(raw: GqlResponse<IssueCreateMutationData>): CreateLinearIssueResult {
  const error = gqlErrorMessage(raw);
  if (error) {
    return { ok: false, error };
  }
  const payload = raw.data?.issueCreate;
  if (!payload) {
    return { ok: false, error: "No issueCreate payload in response" };
  }
  if (!payload.success || !payload.issue) {
    return { ok: false, error: "Linear issue creation was not successful" };
  }
  if (!payload.issue.branchName) {
    return { ok: false, error: "Linear issue did not return a branch name" };
  }
  return {
    ok: true,
    data: {
      id: payload.issue.id,
      identifier: payload.issue.identifier,
      title: payload.issue.title,
      url: payload.issue.url,
      branchName: payload.issue.branchName,
    },
  };
}

export function deriveLinearIssueTitle(
  explicitTitle: string | undefined,
  prompt: string | undefined,
): string | null {
  const trimmedTitle = explicitTitle?.trim();
  if (trimmedTitle) {
    return trimmedTitle;
  }

  const firstPromptLine = prompt
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return firstPromptLine ?? null;
}

export function branchMatchesIssue(
  worktreeBranch: string,
  issueBranchName: string,
): boolean {
  if (!worktreeBranch || !issueBranchName) return false;
  if (worktreeBranch === issueBranchName) return true;

  const issueSlashIdx = issueBranchName.indexOf("/");
  if (issueSlashIdx !== -1) {
    const suffix = issueBranchName.slice(issueSlashIdx + 1);
    if (worktreeBranch === suffix) return true;
  }

  const wtSlashIdx = worktreeBranch.indexOf("/");
  if (wtSlashIdx !== -1) {
    const wtSuffix = worktreeBranch.slice(wtSlashIdx + 1);
    if (wtSuffix === issueBranchName) return true;
    if (issueSlashIdx !== -1 && wtSuffix === issueBranchName.slice(issueSlashIdx + 1)) return true;
  }
  return false;
}

const CACHE_TTL_MS = 300_000;
let issueCache: { data: FetchIssuesResult; expiry: number } | null = null;
let viewerIdCache: string | null = null;
const inProgressStateIdCache = new Map<string, string>();

export function resetLinearCaches(): void {
  issueCache = null;
  viewerIdCache = null;
  inProgressStateIdCache.clear();
}

async function postLinearGraphql<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<{ ok: true; data: GqlResponse<T> } | { ok: false; error: string }> {
  const apiKey = Bun.env.LINEAR_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "LINEAR_API_KEY not set" };
  }

  try {
    const res = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: apiKey,
      },
      body: JSON.stringify(variables ? { query, variables } : { query }),
    });

    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `Linear API ${res.status}: ${text.slice(0, 200)}` };
    }

    return {
      ok: true,
      data: (await res.json()) as GqlResponse<T>,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

async function fetchViewerId(): Promise<FetchViewerIdResult> {
  if (viewerIdCache) {
    return { ok: true, data: viewerIdCache };
  }

  const response = await postLinearGraphql<ViewerQueryData>(VIEWER_QUERY);
  if (!response.ok) {
    log.error(`[linear] viewer fetch failed: ${response.error}`);
    return { ok: false, error: response.error };
  }

  const result = parseViewerIdResponse(response.data);
  if (!result.ok) {
    log.error(`[linear] viewer GraphQL error: ${result.error}`);
    return result;
  }

  viewerIdCache = result.data;
  return result;
}

async function fetchInProgressStateId(teamId: string): Promise<FetchStateIdResult> {
  const cachedStateId = inProgressStateIdCache.get(teamId);
  if (cachedStateId) {
    return { ok: true, data: cachedStateId };
  }

  const response = await postLinearGraphql<TeamStatesQueryData>(TEAM_STATES_QUERY, { teamId });
  if (!response.ok) {
    log.error(`[linear] team states fetch failed: ${response.error}`);
    return { ok: false, error: response.error };
  }

  const result = parseInProgressStateIdResponse(response.data);
  if (!result.ok) {
    log.error(`[linear] team states GraphQL error: ${result.error}`);
    return result;
  }

  inProgressStateIdCache.set(teamId, result.data);
  return result;
}

export async function fetchAssignedIssues(options?: { skipCache?: boolean }): Promise<FetchIssuesResult> {
  const now = Date.now();
  if (!options?.skipCache && issueCache && now < issueCache.expiry) {
    return issueCache.data;
  }

  const response = await postLinearGraphql<AssignedIssuesQueryData>(ASSIGNED_ISSUES_QUERY);
  if (!response.ok) {
    log.error(`[linear] fetch failed: ${response.error}`);
    return { ok: false, error: response.error };
  }

  const result = parseIssuesResponse(response.data);
  if (result.ok) {
    issueCache = { data: result, expiry: now + CACHE_TTL_MS };
    log.debug(`[linear] fetched ${result.data.length} assigned issues`);
  } else {
    log.error(`[linear] GraphQL error: ${result.error}`);
  }

  return result;
}

export async function createLinearIssue(input: CreateLinearIssueInput): Promise<CreateLinearIssueResult> {
  const viewerResult = await fetchViewerId();
  if (!viewerResult.ok) {
    return { ok: false, error: viewerResult.error };
  }

  const stateResult = await fetchInProgressStateId(input.teamId);
  if (!stateResult.ok) {
    return { ok: false, error: stateResult.error };
  }

  const response = await postLinearGraphql<IssueCreateMutationData>(ISSUE_CREATE_MUTATION, {
    input: {
      title: input.title,
      description: input.description,
      teamId: input.teamId,
      assigneeId: viewerResult.data,
      stateId: stateResult.data,
    },
  });
  if (!response.ok) {
    log.error(`[linear] create failed: ${response.error}`);
    return { ok: false, error: response.error };
  }

  const result = parseIssueCreateResponse(response.data);
  if (result.ok) {
    issueCache = null;
    log.debug(`[linear] created issue ${result.data.identifier} branch=${result.data.branchName}`);
  } else {
    log.error(`[linear] issueCreate error: ${result.error}`);
  }

  return result;
}
