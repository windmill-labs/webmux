import { request as httpsRequest } from "node:https";
import { log } from "../lib/log";

export type { LinkedLinearIssue } from "../domain/model";

function getHeader(headers: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  return getHeader(headers, name) !== undefined;
}

function putViaNodeHttps(
  url: string,
  headers: Record<string, string>,
  body: ArrayBuffer,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = httpsRequest({
      method: "PUT",
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      headers: {
        ...headers,
        "Content-Length": String(body.byteLength),
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    req.write(Buffer.from(body));
    req.end();
  });
}

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

// ── Issue + attachments query (for --linear / `webmux linear post`) ─────────

const ISSUE_WITH_ATTACHMENTS_QUERY = `
  query IssueWithAttachments($id: String!) {
    issue(id: $id) {
      id
      identifier
      title
      description
      url
      branchName
      attachments {
        nodes {
          id
          url
          title
          subtitle
          sourceType
          metadata
          createdAt
        }
      }
    }
  }
`;

const TEAM_BY_KEY_QUERY = `
  query TeamByKey($key: String!) {
    teams(filter: { key: { eq: $key } }, first: 1) {
      nodes {
        id
        key
        name
      }
    }
  }
`;

const TEAM_ISSUES_BY_KEYWORDS_QUERY = `
  query TeamIssuesByKeywords($teamId: ID!, $titleFilters: [IssueFilter!]!, $first: Int!) {
    issues(
      filter: {
        team: { id: { eq: $teamId } }
        state: { type: { in: ["triage", "backlog", "unstarted", "started"] } }
        or: $titleFilters
      }
      orderBy: updatedAt
      first: $first
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
`;

interface TeamIssuesByKeywordsQueryData {
  issues: {
    nodes: GqlIssueNode[];
  };
}

export type SearchTeamIssuesResult =
  | { ok: true; data: LinearIssue[] }
  | { ok: false; error: string };

export async function searchTeamIssuesByKeywords(input: {
  teamId: string;
  keywords: string[];
  limit?: number;
}): Promise<SearchTeamIssuesResult> {
  const keywords = input.keywords.map((k) => k.trim()).filter((k) => k.length > 0);
  if (keywords.length === 0) {
    return { ok: true, data: [] };
  }
  const titleFilters = keywords.map((keyword) => ({ title: { containsIgnoreCase: keyword } }));
  const response = await postLinearGraphql<TeamIssuesByKeywordsQueryData>(
    TEAM_ISSUES_BY_KEYWORDS_QUERY,
    { teamId: input.teamId, titleFilters, first: input.limit ?? 10 },
  );
  if (!response.ok) return { ok: false, error: response.error };
  const error = gqlErrorMessage(response.data);
  if (error) return { ok: false, error };
  const nodes = response.data.data?.issues.nodes ?? [];
  return {
    ok: true,
    data: nodes.map((node) => ({
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
    })),
  };
}

const FILE_UPLOAD_MUTATION = `
  mutation FileUpload($contentType: String!, $filename: String!, $size: Int!) {
    fileUpload(contentType: $contentType, filename: $filename, size: $size) {
      success
      uploadFile {
        uploadUrl
        assetUrl
        headers {
          key
          value
        }
      }
    }
  }
`;

const ATTACHMENT_CREATE_MUTATION = `
  mutation AttachmentCreate($issueId: String!, $title: String!, $url: String!, $subtitle: String) {
    attachmentCreate(input: { issueId: $issueId, title: $title, url: $url, subtitle: $subtitle }) {
      success
      attachment {
        id
        url
      }
    }
  }
`;

const COMMENT_CREATE_MUTATION = `
  mutation CommentCreate($issueId: String!, $body: String!) {
    commentCreate(input: { issueId: $issueId, body: $body }) {
      success
      comment {
        id
        url
      }
    }
  }
`;

interface GqlAttachmentNode {
  id: string;
  url: string;
  title: string;
  subtitle: string | null;
  sourceType: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

interface GqlIssueWithAttachments {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  url: string;
  branchName: string;
  attachments: { nodes: GqlAttachmentNode[] };
}

interface IssueWithAttachmentsQueryData {
  issue: GqlIssueWithAttachments | null;
}

interface TeamByKeyQueryData {
  teams: {
    nodes: Array<{ id: string; key: string; name: string }>;
  };
}

interface FileUploadMutationData {
  fileUpload: {
    success: boolean;
    uploadFile: {
      uploadUrl: string;
      assetUrl: string;
      headers: Array<{ key: string; value: string }>;
    } | null;
  };
}

interface AttachmentCreateMutationData {
  attachmentCreate: {
    success: boolean;
    attachment: { id: string; url: string } | null;
  };
}

interface CommentCreateMutationData {
  commentCreate: {
    success: boolean;
    comment: { id: string; url: string } | null;
  };
}

export interface LinearAttachment {
  id: string;
  url: string;
  title: string;
  subtitle: string | null;
  sourceType: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface LinearIssueWithAttachments {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  url: string;
  branchName: string;
  attachments: LinearAttachment[];
}

export type FetchIssueWithAttachmentsResult =
  | { ok: true; data: LinearIssueWithAttachments }
  | { ok: false; error: string; status: number };

export type FetchTeamResult =
  | { ok: true; data: { id: string; key: string; name: string } }
  | { ok: false; error: string; status: number };

export type UploadFileResult =
  | { ok: true; data: { assetUrl: string } }
  | { ok: false; error: string };

export type AttachToIssueResult =
  | { ok: true; data: { id: string; url: string } }
  | { ok: false; error: string };

export type CreateCommentResult =
  | { ok: true; data: { id: string; url: string } }
  | { ok: false; error: string };

export { parseLinearTarget, type LinearTarget } from "@webmux/api-contract";

const WEBMUX_ATTACHMENT_TITLE_PREFIX = "webmux-state:";

export function buildWebmuxAttachmentTitle(branch: string): string {
  return `${WEBMUX_ATTACHMENT_TITLE_PREFIX}${branch}`;
}

export function findWebmuxAttachment(
  issue: { attachments: LinearAttachment[] },
  branch?: string,
): LinearAttachment | null {
  const candidates = issue.attachments.filter((a) => a.title.startsWith(WEBMUX_ATTACHMENT_TITLE_PREFIX));
  if (candidates.length === 0) return null;
  if (branch) {
    const exact = candidates.find((a) => a.title === buildWebmuxAttachmentTitle(branch));
    if (exact) return exact;
  }
  // Newest first.
  return [...candidates].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

export interface LinkedGitHubPr {
  url: string;
  branch: string | null;
  state: "open" | "closed" | "merged" | "unknown";
}

function inferPrStateFromAttachment(attachment: LinearAttachment): LinkedGitHubPr["state"] {
  const meta = attachment.metadata ?? {};
  const rawState = typeof meta.state === "string" ? meta.state.toLowerCase() : null;
  if (rawState === "open" || rawState === "closed" || rawState === "merged") return rawState;
  const status = typeof meta.status === "string" ? meta.status.toLowerCase() : null;
  if (status === "open" || status === "closed" || status === "merged") return status;
  return "unknown";
}

function inferPrBranchFromAttachment(attachment: LinearAttachment): string | null {
  const meta = attachment.metadata ?? {};
  if (typeof meta.branchName === "string" && meta.branchName.trim()) return meta.branchName.trim();
  if (typeof meta.headRefName === "string" && meta.headRefName.trim()) return meta.headRefName.trim();
  return null;
}

const STATE_PRIORITY: Record<LinkedGitHubPr["state"], number> = {
  open: 0,
  merged: 1,
  closed: 2,
  unknown: 3,
};

export function findLinkedGitHubPr(
  issue: { attachments: LinearAttachment[] },
): LinkedGitHubPr | null {
  const githubAttachments = issue.attachments.filter((a) => {
    if (a.sourceType === "githubPR" || a.sourceType === "github_pull_request") {
      return true;
    }
    // `sourceType: "github"` covers both linked PRs and linked issues, so it is
    // not enough on its own — a synced GitHub *issue* (Linear's "GitHub Issues"
    // team) would otherwise be treated as a PR, and the oneshot seed resolves to
    // a branch that was never created ("Branch not found"). Only /pull/ URLs are PRs.
    return /github\.com\/.+\/pull\/\d+/i.test(a.url);
  });
  if (githubAttachments.length === 0) return null;

  const prs: LinkedGitHubPr[] = githubAttachments.map((a) => ({
    url: a.url,
    branch: inferPrBranchFromAttachment(a),
    state: inferPrStateFromAttachment(a),
  }));

  // Sort by state priority (open > merged > closed > unknown), then keep insertion order otherwise.
  const indexed = prs.map((pr, idx) => ({ pr, idx, attachment: githubAttachments[idx] }));
  indexed.sort((a, b) => {
    const stateDiff = STATE_PRIORITY[a.pr.state] - STATE_PRIORITY[b.pr.state];
    if (stateDiff !== 0) return stateDiff;
    return b.attachment.createdAt.localeCompare(a.attachment.createdAt);
  });
  return indexed[0].pr;
}

export interface LinearSummaryInput {
  branch: string;
  baseBranch?: string;
  turns: number;
  prUrl?: string;
  attachmentTitle: string;
  webmuxVersion?: string;
}

export interface LinearPickupMarkdownInput {
  branch: string;
  pickedUpAt: Date;
}

/** Build the structured pickup comment posted when the auto-create watcher picks up a
 *  `webmux_oneshot`-labeled issue. The prefix (`**Webmux pickup — branch ...**`) is the
 *  contract external automation greps on, so the format is fixed by tests. */
export function buildLinearPickupMarkdown(input: LinearPickupMarkdownInput): string {
  return [
    `**Webmux pickup — branch \`${input.branch}\`**`,
    "",
    `- Picked up: ${input.pickedUpAt.toISOString()}`,
  ].join("\n");
}

export function buildLinearSummaryMarkdown(input: LinearSummaryInput): string {
  const lines: string[] = [
    `**Webmux session — branch \`${input.branch}\`**`,
    "",
  ];
  if (input.baseBranch) lines.push(`- Base: \`${input.baseBranch}\``);
  lines.push(`- Turns: ${input.turns}`);
  if (input.prUrl) lines.push(`- PR: ${input.prUrl}`);
  lines.push(`- Transcript: see attachment \`${input.attachmentTitle}\``);
  if (input.webmuxVersion) lines.push(`- webmux: ${input.webmuxVersion}`);
  lines.push("");
  lines.push("_Resume on another machine with_ `webmux oneshot --linear <issue-id>`.");
  return lines.join("\n");
}

export async function fetchIssueWithAttachments(issueIdentifierOrId: string): Promise<FetchIssueWithAttachmentsResult> {
  const response = await postLinearGraphql<IssueWithAttachmentsQueryData>(ISSUE_WITH_ATTACHMENTS_QUERY, {
    id: issueIdentifierOrId,
  });
  if (!response.ok) {
    return { ok: false, error: response.error, status: 502 };
  }
  const error = gqlErrorMessage(response.data);
  if (error) {
    return { ok: false, error, status: 502 };
  }
  const issue = response.data.data?.issue;
  if (!issue) {
    return { ok: false, error: `Linear issue not found: ${issueIdentifierOrId}`, status: 404 };
  }
  return {
    ok: true,
    data: {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description,
      url: issue.url,
      branchName: issue.branchName,
      attachments: issue.attachments.nodes.map((node) => ({
        id: node.id,
        url: node.url,
        title: node.title,
        subtitle: node.subtitle,
        sourceType: node.sourceType,
        metadata: node.metadata,
        createdAt: node.createdAt,
      })),
    },
  };
}

export async function fetchTeamByKey(teamKey: string): Promise<FetchTeamResult> {
  const response = await postLinearGraphql<TeamByKeyQueryData>(TEAM_BY_KEY_QUERY, { key: teamKey });
  if (!response.ok) {
    return { ok: false, error: response.error, status: 502 };
  }
  const error = gqlErrorMessage(response.data);
  if (error) {
    return { ok: false, error, status: 502 };
  }
  const team = response.data.data?.teams.nodes[0];
  if (!team) {
    return { ok: false, error: `Linear team not found for key: ${teamKey}`, status: 404 };
  }
  return { ok: true, data: team };
}

export async function uploadAttachmentFile(input: {
  filename: string;
  contentType: string;
  body: ArrayBuffer;
}): Promise<UploadFileResult> {
  const response = await postLinearGraphql<FileUploadMutationData>(FILE_UPLOAD_MUTATION, {
    contentType: input.contentType,
    filename: input.filename,
    size: input.body.byteLength,
  });
  if (!response.ok) return { ok: false, error: response.error };
  const error = gqlErrorMessage(response.data);
  if (error) return { ok: false, error };
  const upload = response.data.data?.fileUpload;
  if (!upload?.success || !upload.uploadFile) {
    return { ok: false, error: "Linear fileUpload did not return an upload URL" };
  }

  const headers: Record<string, string> = {};
  for (const h of upload.uploadFile.headers) headers[h.key] = h.value;

  // Linear's pre-signed GCS URL declares the signed headers in the URL's
  // `X-Goog-SignedHeaders` param, but `headers` doesn't always include them
  // all — we have to reconstruct the missing ones with the exact values
  // Linear signed, or GCS rejects the upload (MalformedSecurityHeader /
  // SignatureDoesNotMatch).
  if (!hasHeader(headers, "content-type")) {
    headers["Content-Type"] = input.contentType;
  }
  if (!hasHeader(headers, "x-goog-content-length-range")) {
    const size = input.body.byteLength;
    headers["x-goog-content-length-range"] = `${size},${size}`;
  }

  // Bun's `fetch` normalizes header values (e.g. adds `;charset=utf-8` to
  // application/json Content-Type) which the GCS pre-signed URL didn't sign,
  // causing SignatureDoesNotMatch. Use node:https for byte-exact control.
  try {
    const { status, body } = await putViaNodeHttps(upload.uploadFile.uploadUrl, headers, input.body);
    if (status < 200 || status >= 300) {
      return { ok: false, error: `Asset upload failed ${status}: ${body.slice(0, 1000)}` };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Asset upload error: ${msg}` };
  }

  return { ok: true, data: { assetUrl: upload.uploadFile.assetUrl } };
}

export async function attachToIssue(input: {
  issueId: string;
  title: string;
  url: string;
  subtitle?: string;
}): Promise<AttachToIssueResult> {
  const response = await postLinearGraphql<AttachmentCreateMutationData>(ATTACHMENT_CREATE_MUTATION, {
    issueId: input.issueId,
    title: input.title,
    url: input.url,
    subtitle: input.subtitle ?? null,
  });
  if (!response.ok) return { ok: false, error: response.error };
  const error = gqlErrorMessage(response.data);
  if (error) return { ok: false, error };
  const payload = response.data.data?.attachmentCreate;
  if (!payload?.success || !payload.attachment) {
    return { ok: false, error: "Linear attachmentCreate did not succeed" };
  }
  return { ok: true, data: payload.attachment };
}

export async function createIssueComment(input: {
  issueId: string;
  body: string;
}): Promise<CreateCommentResult> {
  const response = await postLinearGraphql<CommentCreateMutationData>(COMMENT_CREATE_MUTATION, {
    issueId: input.issueId,
    body: input.body,
  });
  if (!response.ok) return { ok: false, error: response.error };
  const error = gqlErrorMessage(response.data);
  if (error) return { ok: false, error };
  const payload = response.data.data?.commentCreate;
  if (!payload?.success || !payload.comment) {
    return { ok: false, error: "Linear commentCreate did not succeed" };
  }
  return { ok: true, data: payload.comment };
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
