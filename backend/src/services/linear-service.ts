import { log } from "../lib/log";

// --- Types ---

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

interface GqlResponse {
  data?: {
    viewer: {
      assignedIssues: {
        nodes: GqlIssueNode[];
      };
    };
  };
  errors?: { message: string }[];
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

export interface LinkedLinearIssue {
  identifier: string;
  url: string;
  state: { name: string; color: string; type: string };
}

export type FetchIssuesResult =
  | { ok: true; data: LinearIssue[] }
  | { ok: false; error: string };

// --- GraphQL query ---

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

// --- Pure functions ---

export function parseIssuesResponse(raw: GqlResponse): FetchIssuesResult {
  if (raw.errors && raw.errors.length > 0) {
    return { ok: false, error: raw.errors.map((e) => e.message).join("; ") };
  }
  if (!raw.data) {
    return { ok: false, error: "No data in response" };
  }
  const nodes = raw.data.viewer.assignedIssues.nodes;
  const issues: LinearIssue[] = nodes.map((n) => ({
    id: n.id,
    identifier: n.identifier,
    title: n.title,
    description: n.description,
    priority: n.priority,
    priorityLabel: n.priorityLabel,
    url: n.url,
    branchName: n.branchName,
    dueDate: n.dueDate,
    updatedAt: n.updatedAt,
    state: n.state,
    team: n.team,
    labels: n.labels.nodes,
    project: n.project?.name ?? null,
  }));
  return { ok: true, data: issues };
}

/** Match a worktree branch to a Linear issue branch name.
 *  Linear generates branches like `user/eng-123-desc` — we strip the first
 *  `/`-delimited prefix segment from each side to find a match. */
export function branchMatchesIssue(
  worktreeBranch: string,
  issueBranchName: string,
): boolean {
  if (!worktreeBranch || !issueBranchName) return false;
  if (worktreeBranch === issueBranchName) return true;
  // Strip prefix: "user/eng-123-desc" → "eng-123-desc"
  const issueSlashIdx = issueBranchName.indexOf("/");
  if (issueSlashIdx !== -1) {
    const suffix = issueBranchName.slice(issueSlashIdx + 1);
    if (worktreeBranch === suffix) return true;
  }
  // Also try stripping worktree prefix
  const wtSlashIdx = worktreeBranch.indexOf("/");
  if (wtSlashIdx !== -1) {
    const wtSuffix = worktreeBranch.slice(wtSlashIdx + 1);
    if (wtSuffix === issueBranchName) return true;
    if (issueSlashIdx !== -1 && wtSuffix === issueBranchName.slice(issueSlashIdx + 1)) return true;
  }
  return false;
}

// --- I/O: fetch with cache ---
// On fetch error, stale cache continues to be served until TTL expires.
// This is intentional — availability over freshness for a read-only sidebar.

const CACHE_TTL_MS = 300_000;
let issueCache: { data: FetchIssuesResult; expiry: number } | null = null;

export async function fetchAssignedIssues(): Promise<FetchIssuesResult> {
  const apiKey = Bun.env.LINEAR_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "LINEAR_API_KEY not set" };
  }

  const now = Date.now();
  if (issueCache && now < issueCache.expiry) {
    return issueCache.data;
  }

  try {
    const res = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: apiKey,
      },
      body: JSON.stringify({ query: ASSIGNED_ISSUES_QUERY }),
    });

    if (!res.ok) {
      const text = await res.text();
      const result: FetchIssuesResult = { ok: false, error: `Linear API ${res.status}: ${text.slice(0, 200)}` };
      return result;
    }

    const json = (await res.json()) as GqlResponse;
    const result = parseIssuesResponse(json);

    if (result.ok) {
      issueCache = { data: result, expiry: now + CACHE_TTL_MS };
      log.debug(`[linear] fetched ${result.data.length} assigned issues`);
    } else {
      log.error(`[linear] GraphQL error: ${result.error}`);
    }

    return result;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`[linear] fetch failed: ${msg}`);
    return { ok: false, error: msg };
  }
}
