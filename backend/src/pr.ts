import { upsertEnvLocal } from "./env";
import type { LinkedRepoConfig } from "./config";

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

export interface PrComment {
  author: string;
  body: string;
  createdAt: string;
}

interface GhComment {
  author: { login: string };
  body: string;
  createdAt: string;
}

interface GhCheckEntry {
  conclusion: GhCheckConclusion | null;
  status: GhCheckStatus;
  name: string;
  detailsUrl: string;
}

interface GhPrEntry {
  number: number;
  headRefName: string;
  state: string;
  statusCheckRollup: GhCheckEntry[] | null;
  url: string;
  comments: GhComment[];
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface CiCheck {
  name: string;
  status: "pending" | "success" | "failed" | "skipped";
  url: string;
  runId: number | null;
}

export interface PrEntry {
  repo: string;
  number: number;
  state: "open" | "closed" | "merged";
  url: string;
  ciStatus: "none" | "pending" | "success" | "failed";
  ciChecks: CiCheck[];
  comments: PrComment[];
}

type FetchPrsResult =
  | { ok: true; data: Map<string, PrEntry> }
  | { ok: false; error: string };

// ── Pure helper functions (exported for unit testing) ─────────────────────────

/** Summarize CI check status from a statusCheckRollup array. */
export function summarizeChecks(
  checks: GhCheckEntry[] | null,
): PrEntry["ciStatus"] {
  if (!checks || checks.length === 0) return "none";
  const allDone = checks.every((c) => c.status === "COMPLETED");
  if (!allDone) return "pending";
  const allPass = checks.every(
    (c) =>
      c.conclusion === "SUCCESS" ||
      c.conclusion === "NEUTRAL" ||
      c.conclusion === "SKIPPED",
  );
  return allPass ? "success" : "failed";
}

/** Parse a GitHub Actions run ID from a details URL. Returns null when not found. */
export function parseRunId(detailsUrl: string): number | null {
  const match = detailsUrl.match(/\/actions\/runs\/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

/** Derive a typed check status from GH conclusion/status fields. */
export function deriveCheckStatus(check: GhCheckEntry): CiCheck["status"] {
  if (check.status !== "COMPLETED") return "pending";
  const c = check.conclusion;
  if (c === "SUCCESS" || c === "NEUTRAL") return "success";
  if (c === "SKIPPED") return "skipped";
  return "failed";
}

/** Map raw GH check entries to typed CiCheck array. */
export function mapChecks(checks: GhCheckEntry[] | null): CiCheck[] {
  if (!checks || checks.length === 0) return [];
  return checks.map((c) => ({
    name: c.name,
    status: deriveCheckStatus(c),
    url: c.detailsUrl,
    runId: parseRunId(c.detailsUrl),
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
      ciStatus: summarizeChecks(entry.statusCheckRollup),
      ciChecks: mapChecks(entry.statusCheckRollup),
      comments: (entry.comments ?? []).map((c) => ({
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
    "number,headRefName,state,statusCheckRollup,url,comments",
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

/** Sync PR status to .env.local for all worktrees that have open PRs. */
export async function syncPrStatus(
  getWorktreePaths: () => Promise<Map<string, string>>,
  linkedRepos: LinkedRepoConfig[],
  projectDir?: string,
): Promise<void> {
  // Fetch current repo + all linked repos in parallel.
  const allRepoResults = await Promise.all([
    fetchAllPrs(undefined, undefined, projectDir),
    ...linkedRepos.map(({ repo, alias }) => fetchAllPrs(repo, alias, projectDir)),
  ]);

  // Log fetch errors; aggregate successes into branch → PrEntry[].
  const branchPrs = new Map<string, PrEntry[]>();
  for (const result of allRepoResults) {
    if (!result.ok) {
      console.error(`[pr] ${result.error}`);
      continue;
    }
    for (const [branch, entry] of result.data) {
      const existing = branchPrs.get(branch) ?? [];
      existing.push(entry);
      branchPrs.set(branch, existing);
    }
  }

  if (branchPrs.size === 0) return;

  const wtPaths = await getWorktreePaths();
  const seen = new Set<string>();

  for (const [branch, entries] of branchPrs) {
    const wtDir = wtPaths.get(branch);
    if (!wtDir || seen.has(wtDir)) continue;
    seen.add(wtDir);

    await upsertEnvLocal(wtDir, "PR_DATA", JSON.stringify(entries));
  }

  console.log(
    `[pr] synced ${seen.size} worktree(s) with PR data from ${allRepoResults.length} repo(s)`,
  );
}

/** Start periodic PR status sync. Returns a cleanup function that stops the monitor. */
export function startPrMonitor(
  getWorktreePaths: () => Promise<Map<string, string>>,
  linkedRepos: LinkedRepoConfig[],
  projectDir?: string,
  intervalMs: number = 20_000,
): () => void {
  const run = (): void => {
    syncPrStatus(getWorktreePaths, linkedRepos, projectDir).catch(
      (err: unknown) => {
        console.error(`[pr] sync error: ${err}`);
      },
    );
  };

  // Run once immediately (non-blocking).
  run();

  const timer = setInterval(run, intervalMs);

  return (): void => {
    clearInterval(timer);
  };
}
