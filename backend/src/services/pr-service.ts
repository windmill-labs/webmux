import { readWorktreePrs, writeWorktreePrs } from "../adapters/fs";
import type { LinkedRepoConfig } from "../domain/config";
import type { CiCheck, PrComment, PrEntry } from "../domain/model";
import { mapWithConcurrency, startSerializedInterval } from "../lib/async";
import { log } from "../lib/log";

const PR_FETCH_LIMIT = 50;
const GH_TIMEOUT_MS = 15_000;

// ── Internal GH API shapes ────────────────────────────────────────────────────

type GhCheckStatus =
  | "QUEUED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "WAITING"
  | "REQUESTED"
  | "PENDING";

type GhCheckConclusion =
  | "SUCCESS"
  | "FAILURE"
  | "NEUTRAL"
  | "CANCELLED"
  | "SKIPPED"
  | "TIMED_OUT"
  | "ACTION_REQUIRED";

interface GhComment {
  author: { login: string };
  body: string;
  createdAt: string;
}

interface GhReviewComment {
  body: string;
  path: string;
  line: number | null;
  diff_hunk: string;
  user: { login: string };
  created_at: string;
  in_reply_to_id?: number;
}

// CheckRun entries from GitHub Actions
interface GhCheckRunEntry {
  __typename: "CheckRun";
  conclusion: GhCheckConclusion | null;
  status: GhCheckStatus;
  name: string;
  detailsUrl: string | null;
}

// StatusContext entries from external CI (e.g. Vercel)
interface GhStatusContextEntry {
  __typename: "StatusContext";
  context: string;
  state: "SUCCESS" | "FAILURE" | "PENDING" | "ERROR" | "EXPECTED";
  targetUrl: string | null;
}

type GhCheckEntry = GhCheckRunEntry | GhStatusContextEntry;

interface GhPrEntry {
  number: number;
  headRefName: string;
  state: string;
  updatedAt: string;
  statusCheckRollup: GhCheckEntry[] | null;
  url: string;
  comments: GhComment[];
}

type FetchPrsResult =
  | { ok: true; data: Map<string, PrEntry> }
  | { ok: false; error: string };

// ── Caches for rate-limit mitigation ─────────────────────────────────────────

/** Last-seen updatedAt per PR URL — used to skip unchanged PRs' review comments. */
const prUpdatedAtCache = new Map<string, string>();

/** Cached review comments per PR URL — reused when updatedAt hasn't changed. */
const prCommentsCache = new Map<string, PrComment[]>();

/** ETag cache for gh api review comment responses. Keyed by API path. */
const etagCache = new Map<string, { etag: string; comments: PrComment[] }>();

// ── Pure helper functions (exported for unit testing) ─────────────────────────

/** Summarize CI check status from a statusCheckRollup array. */
export function summarizeChecks(
  checks: GhCheckEntry[] | null,
): PrEntry["ciStatus"] {
  if (!checks || checks.length === 0) return "none";
  const allDone = checks.every((c) =>
    c.__typename === "StatusContext"
      ? c.state !== "PENDING" && c.state !== "EXPECTED"
      : c.status === "COMPLETED",
  );
  if (!allDone) return "pending";
  const allPass = checks.every((c) => {
    if (c.__typename === "StatusContext") return c.state === "SUCCESS";
    return c.conclusion === "SUCCESS" || c.conclusion === "NEUTRAL" || c.conclusion === "SKIPPED";
  });
  return allPass ? "success" : "failed";
}

/** Parse a GitHub Actions run ID from a details URL. Returns null when not found. */
export function parseRunId(detailsUrl: string | null): number | null {
  if (!detailsUrl) return null;
  const match = detailsUrl.match(/\/actions\/runs\/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

/** Derive a typed check status from GH conclusion/status fields. */
export function deriveCheckStatus(check: GhCheckEntry): CiCheck["status"] {
  if (check.__typename === "StatusContext") {
    const s = check.state;
    if (s === "SUCCESS") return "success";
    if (s === "PENDING" || s === "EXPECTED") return "pending";
    return "failed";
  }
  if (check.status !== "COMPLETED") return "pending";
  const c = check.conclusion;
  if (c === "SUCCESS" || c === "NEUTRAL") return "success";
  if (c === "SKIPPED") return "skipped";
  return "failed";
}

/** Map raw GH check entries to typed CiCheck array. */
export function mapChecks(checks: GhCheckEntry[] | null): CiCheck[] {
  if (!checks || checks.length === 0) return [];
  return checks.map((c) => {
    const name = c.__typename === "StatusContext" ? c.context : c.name;
    const url = c.__typename === "StatusContext" ? c.targetUrl : c.detailsUrl;
    return {
      name,
      status: deriveCheckStatus(c),
      url,
      runId: parseRunId(url),
    };
  });
}

/** Parse raw `gh api` review comments JSON into typed array. Keeps most recent 50. */
export function parseReviewComments(json: string): PrComment[] {
  const raw = JSON.parse(json) as GhReviewComment[];
  const sorted = raw.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  return sorted.slice(0, PR_FETCH_LIMIT).map((c) => ({
    type: "inline" as const,
    author: c.user?.login ?? "unknown",
    body: c.body ?? "",
    createdAt: c.created_at ?? "",
    path: c.path ?? "",
    line: c.line ?? null,
    diffHunk: c.diff_hunk ?? "",
    isReply: c.in_reply_to_id !== undefined,
  }));
}

/** Parse raw `gh pr list --json` output into a branch → PrEntry map. Throws on invalid JSON. */
export function parsePrResponse(
  json: string,
  repoLabel?: string,
): Map<string, PrEntry> {
  const prs = new Map<string, PrEntry>();
  const entries = JSON.parse(json) as GhPrEntry[];
  for (const entry of entries) {
    // If multiple PRs share the same branch in one repo, the first (most recent) wins.
    if (prs.has(entry.headRefName)) continue;
    prs.set(entry.headRefName, {
      repo: repoLabel ?? "",
      number: entry.number,
      state: entry.state.toLowerCase() as PrEntry["state"],
      url: entry.url,
      updatedAt: entry.updatedAt ?? "",
      ciStatus: summarizeChecks(entry.statusCheckRollup),
      ciChecks: mapChecks(entry.statusCheckRollup),
      comments: (entry.comments ?? []).map((c) => ({
        type: "comment" as const,
        author: c.author?.login ?? "unknown",
        body: c.body ?? "",
        createdAt: c.createdAt ?? "",
      })),
    });
  }
  return prs;
}

// ── I/O functions ─────────────────────────────────────────────────────────────

/**
 * Fetch all open PRs from a repo via `gh` CLI.
 * Returns a Result: on success, a map of branch name → PrEntry; on failure, an error string.
 * Applies a hard timeout so a hung `gh` process never stalls the caller.
 */
export async function fetchAllPrs(
  repoSlug?: string,
  repoLabel?: string,
  cwd?: string,
): Promise<FetchPrsResult> {
  const label = repoSlug ?? "current";
  const args = [
    "gh",
    "pr",
    "list",
    "--state",
    "open",
    "--json",
    "number,headRefName,state,updatedAt,statusCheckRollup,url,comments",
    "--limit",
    String(PR_FETCH_LIMIT),
  ];
  if (repoSlug) args.push("--repo", repoSlug);

  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
    ...(cwd ? { cwd } : {}),
  });

  const timeout = Bun.sleep(GH_TIMEOUT_MS).then(() => {
    proc.kill();
    return "timeout" as const;
  });

  const raceResult = await Promise.race([proc.exited, timeout]);
  if (raceResult === "timeout") {
    return { ok: false, error: `gh pr list timed out for ${label}` };
  }

  if (raceResult !== 0) {
    const stderr = (await new Response(proc.stderr).text()).trim();
    return {
      ok: false,
      error: `gh pr list failed for ${label} (exit ${raceResult}): ${stderr}`,
    };
  }

  try {
    const json = await new Response(proc.stdout).text();
    return { ok: true, data: parsePrResponse(json, repoLabel) };
  } catch (err) {
    return { ok: false, error: `failed to parse gh output for ${label}: ${err}` };
  }
}

/** Fetch inline review comments for a single PR via `gh api` with ETag caching.
 *  Conditional requests (304) don't count against GitHub's rate limit. */
async function fetchReviewComments(
  prNumber: number,
  repoSlug?: string,
  cwd?: string,
): Promise<PrComment[]> {
  const repoFlag = repoSlug
    ? repoSlug
    : "{owner}/{repo}";
  const apiPath = `repos/${repoFlag}/pulls/${prNumber}/comments?per_page=100`;
  const args = [
    "gh", "api",
    apiPath,
    "--include",
  ];

  const cached = etagCache.get(apiPath);
  if (cached) {
    args.push("--header", `If-None-Match: ${cached.etag}`);
  }

  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
    ...(cwd ? { cwd } : {}),
  });

  const timeout = Bun.sleep(GH_TIMEOUT_MS).then(() => {
    proc.kill();
    return "timeout" as const;
  });

  const raceResult = await Promise.race([proc.exited, timeout]);
  if (raceResult === "timeout") return cached?.comments ?? [];

  const raw = await new Response(proc.stdout).text();

  // gh api --include prefixes the body with HTTP headers separated by a blank line
  let blankLineIdx = raw.indexOf("\r\n\r\n");
  let separatorLen = 4;
  if (blankLineIdx === -1) {
    blankLineIdx = raw.indexOf("\n\n");
    separatorLen = 2;
  }
  if (blankLineIdx === -1) {
    // No headers found — may be an error or empty response
    if (raceResult !== 0) return cached?.comments ?? [];
    try {
      return parseReviewComments(raw);
    } catch {
      return cached?.comments ?? [];
    }
  }

  const headerBlock = raw.slice(0, blankLineIdx);
  const body = raw.slice(blankLineIdx + separatorLen);

  // Check for 304 Not Modified
  if (headerBlock.includes("304 Not Modified")) {
    log.debug(`[pr] etag cache hit for PR #${prNumber}`);
    return cached?.comments ?? [];
  }

  if (raceResult !== 0) return cached?.comments ?? [];

  // Parse ETag from response headers
  const etagMatch = headerBlock.match(/^etag:\s*(.+)$/mi);

  try {
    const comments = parseReviewComments(body);
    if (etagMatch) {
      etagCache.set(apiPath, { etag: etagMatch[1].trim(), comments });
    }
    return comments;
  } catch {
    return cached?.comments ?? [];
  }
}

/** Fetch the current state of a PR by its URL. Returns null on error. */
async function fetchPrState(url: string): Promise<PrEntry["state"] | null> {
  const proc = Bun.spawn(["gh", "pr", "view", url, "--json", "state"], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const timeout = Bun.sleep(GH_TIMEOUT_MS).then(() => {
    proc.kill();
    return "timeout" as const;
  });

  const raceResult = await Promise.race([proc.exited, timeout]);
  if (raceResult === "timeout" || raceResult !== 0) return null;

  try {
    const data = JSON.parse(await new Response(proc.stdout).text()) as { state: string };
    return data.state.toLowerCase() as PrEntry["state"];
  } catch {
    return null;
  }
}

/** Update stored PR state for a worktree whose PR is no longer in the open PR list.
 *  Fetches the actual current state for any entry still marked "open". */
async function refreshStalePrData(gitDir: string): Promise<void> {
  const entries = await readWorktreePrs(gitDir);
  if (!entries.some((e) => e.state === "open")) return;

  const updated = await Promise.all(
    entries.map(async (entry) => {
      if (entry.state !== "open") return entry;
      const state = await fetchPrState(entry.url);
      return state ? { ...entry, state } : entry;
    }),
  );

  await writeWorktreePrs(gitDir, updated);
}

/** Sync PR status into per-worktree webmux storage for all worktrees that have open PRs. */
export async function syncPrStatus(
  getWorktreeGitDirs: () => Promise<Map<string, string>>,
  linkedRepos: LinkedRepoConfig[],
  projectDir?: string,
): Promise<void> {
  log.debug(`[pr] starting sync (${1 + linkedRepos.length} repo(s))`);
  // Fetch current repo + all linked repos in parallel.
  const allRepoResults = await Promise.all([
    fetchAllPrs(undefined, undefined, projectDir),
    ...linkedRepos.map(({ repo, alias }) => fetchAllPrs(repo, alias, projectDir)),
  ]);

  // Log fetch errors; aggregate successes into branch → PrEntry[].
  const branchPrs = new Map<string, PrEntry[]>();
  for (const result of allRepoResults) {
    if (!result.ok) {
      log.error(`[pr] ${result.error}`);
      continue;
    }
    for (const [branch, entry] of result.data) {
      const existing = branchPrs.get(branch) ?? [];
      existing.push(entry);
      branchPrs.set(branch, existing);
    }
  }

  const worktreeGitDirs = await getWorktreeGitDirs();
  const activeBranches = new Set(worktreeGitDirs.keys());

  // Fetch inline review comments only for PRs matching active worktrees.
  // PRs that haven't been updated reuse cached comments (saves API calls).
  const reviewTuples: { entry: PrEntry; repoSlug: string | undefined }[] = [];
  for (const [branch, entries] of branchPrs) {
    if (!activeBranches.has(branch)) continue;
    for (const entry of entries) {
      if (entry.state !== "open") continue;
      const cachedUpdatedAt = prUpdatedAtCache.get(entry.url);
      if (cachedUpdatedAt === entry.updatedAt && prCommentsCache.has(entry.url)) {
        log.debug(`[pr] skipping comments for PR #${entry.number} (unchanged)`);
        const cached = prCommentsCache.get(entry.url)!;
        entry.comments = [...entry.comments, ...cached].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );
      } else {
        const repoSlug = entry.repo
          ? linkedRepos.find((lr) => lr.alias === entry.repo)?.repo
          : undefined;
        reviewTuples.push({ entry, repoSlug });
      }
    }
  }
  if (reviewTuples.length > 0) {
    log.debug(`[pr] fetching review comments for ${reviewTuples.length} PR(s)`);
    const reviewResults = await mapWithConcurrency(reviewTuples, 5, (t) =>
      fetchReviewComments(t.entry.number, t.repoSlug, projectDir),
    );
    for (let i = 0; i < reviewTuples.length; i++) {
      const entry = reviewTuples[i].entry;
      const reviewComments = reviewResults[i];
      prUpdatedAtCache.set(entry.url, entry.updatedAt);
      prCommentsCache.set(entry.url, reviewComments);
      entry.comments = [...entry.comments, ...reviewComments].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
    }
  }
  const seen = new Set<string>();

  for (const [branch, entries] of branchPrs) {
    const gitDir = worktreeGitDirs.get(branch);
    if (!gitDir || seen.has(gitDir)) continue;
    seen.add(gitDir);

    await writeWorktreePrs(gitDir, entries);
  }

  if (seen.size > 0) {
    log.debug(
      `[pr] synced ${seen.size} worktree(s) with PR data from ${allRepoResults.length} repo(s)`,
    );
  }

  // For worktrees not matched by the open-PR sync, refresh any stale "open"
  // entries so merged/closed PRs are reflected in stored worktree PR state.
  const uniqueDirs = new Set(worktreeGitDirs.values());
  const staleRefreshes: Promise<void>[] = [];
  for (const gitDir of uniqueDirs) {
    if (seen.has(gitDir)) continue;
    staleRefreshes.push(refreshStalePrData(gitDir));
  }
  await Promise.all(staleRefreshes);

  // Evict cache entries for PRs that are no longer open.
  const currentPrUrls = new Set<string>();
  const currentApiPaths = new Set<string>();
  for (const entries of branchPrs.values()) {
    for (const entry of entries) {
      currentPrUrls.add(entry.url);
      const repoSlug = entry.repo
        ? linkedRepos.find((lr) => lr.alias === entry.repo)?.repo ?? "{owner}/{repo}"
        : "{owner}/{repo}";
      currentApiPaths.add(`repos/${repoSlug}/pulls/${entry.number}/comments?per_page=100`);
    }
  }
  for (const url of prUpdatedAtCache.keys()) {
    if (!currentPrUrls.has(url)) prUpdatedAtCache.delete(url);
  }
  for (const url of prCommentsCache.keys()) {
    if (!currentPrUrls.has(url)) prCommentsCache.delete(url);
  }
  for (const key of etagCache.keys()) {
    if (!currentApiPaths.has(key)) etagCache.delete(key);
  }
}

/** Start periodic PR status sync. Returns a cleanup function that stops the monitor.
 *  When `isActive` is provided, polling is skipped if no clients are connected. */
export function startPrMonitor(
  getWorktreeGitDirs: () => Promise<Map<string, string>>,
  linkedRepos: LinkedRepoConfig[],
  projectDir?: string,
  intervalMs: number = 10_000,
  isActive?: () => boolean,
): () => void {
  const run = async (): Promise<void> => {
    if (isActive && !isActive()) {
      log.debug("[pr] skipping PR sync: no active clients");
      return;
    }
    await syncPrStatus(getWorktreeGitDirs, linkedRepos, projectDir).catch(
      (err: unknown) => {
        log.error(`[pr] sync error: ${err}`);
      },
    );
  };

  return startSerializedInterval(run, intervalMs);
}
