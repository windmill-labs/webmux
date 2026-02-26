import { upsertEnvLocal } from "./env";
import type { LinkedRepoConfig } from "./config";

export interface PrComment {
  author: string;
  body: string;
  createdAt: string;
}

export interface CiCheck {
  name: string;
  status: string;
  url: string;
  runId: number;
}

export interface PrEntry {
  repo: string;
  number: number;
  state: string;
  url: string;
  ciStatus: string;
  ciChecks: CiCheck[];
  comments: PrComment[];
}

interface GhComment {
  author: { login: string };
  body: string;
  createdAt: string;
}

interface GhCheckEntry {
  conclusion: string;
  status: string;
  name: string;
  detailsUrl: string;
}

interface GhPrEntry {
  number: number;
  headRefName: string;
  state: string;
  statusCheckRollup: GhCheckEntry[];
  url: string;
  comments: GhComment[];
}

/** Summarize CI check status from statusCheckRollup array. */
function summarizeChecks(checks: GhCheckEntry[]): string {
  if (!checks || checks.length === 0) return "none";
  const allDone = checks.every((c) => c.status === "COMPLETED");
  if (!allDone) return "pending";
  const allPass = checks.every((c) => c.conclusion === "SUCCESS" || c.conclusion === "NEUTRAL" || c.conclusion === "SKIPPED");
  return allPass ? "success" : "failed";
}

/** Parse run ID from a GitHub Actions details URL. */
function parseRunId(detailsUrl: string): number {
  const match = detailsUrl.match(/\/actions\/runs\/(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

/** Derive per-check status string from GH conclusion/status fields. */
function deriveCheckStatus(check: GhCheckEntry): string {
  if (check.status !== "COMPLETED") return "pending";
  const c = check.conclusion;
  if (c === "SUCCESS" || c === "NEUTRAL") return "success";
  if (c === "SKIPPED") return "skipped";
  return "failed";
}

/** Map raw GH check entries to typed CiCheck array. */
function mapChecks(checks: GhCheckEntry[]): CiCheck[] {
  if (!checks || checks.length === 0) return [];
  return checks.map((c) => ({
    name: c.name,
    status: deriveCheckStatus(c),
    url: c.detailsUrl,
    runId: parseRunId(c.detailsUrl),
  }));
}

/** Fetch all PRs from a repo via gh CLI. Returns a map of branch name → PrEntry. */
export async function fetchAllPrs(repoSlug?: string, repoLabel?: string): Promise<Map<string, PrEntry>> {
  const args = ["gh", "pr", "list", "--state", "open", "--json", "number,headRefName,state,statusCheckRollup,url,comments", "--limit", "50"];
  if (repoSlug) args.push("--repo", repoSlug);

  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const exitCode = await proc.exited;

  const prs = new Map<string, PrEntry>();
  if (exitCode !== 0) {
    const stderr = (await new Response(proc.stderr).text()).trim();
    const label = repoSlug ?? "current";
    console.error(`[pr] gh pr list failed for ${label}: ${stderr}`);
    return prs;
  }

  try {
    const entries: GhPrEntry[] = JSON.parse(await new Response(proc.stdout).text());
    for (const entry of entries) {
      // If multiple PRs for same branch in same repo, the first (most recent) wins
      if (prs.has(entry.headRefName)) continue;
      prs.set(entry.headRefName, {
        repo: repoLabel ?? "",
        number: entry.number,
        state: entry.state.toLowerCase(),
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
  } catch (err) {
    const label = repoSlug ?? "current";
    console.error(`[pr] failed to parse gh output for ${label}: ${err}`);
  }

  return prs;
}

/** Sync PR status to .env.local for all worktrees that have PRs. */
export async function syncPrStatus(
  getWorktreePaths: () => Map<string, string>,
  linkedRepos: LinkedRepoConfig[],
): Promise<void> {
  // Fetch current repo + all linked repos in parallel
  const allRepoResults = await Promise.all([
    fetchAllPrs(),
    ...linkedRepos.map(({ repo, alias }) => fetchAllPrs(repo, alias)),
  ]);

  // Group by branch → PrEntry[]
  const branchPrs = new Map<string, PrEntry[]>();
  for (const repoPrs of allRepoResults) {
    for (const [branch, entry] of repoPrs) {
      const existing = branchPrs.get(branch) ?? [];
      existing.push(entry);
      branchPrs.set(branch, existing);
    }
  }

  if (branchPrs.size === 0) return;

  const wtPaths = getWorktreePaths();
  const seen = new Set<string>();

  for (const [branch, entries] of branchPrs) {
    const wtDir = wtPaths.get(branch);
    if (!wtDir || seen.has(wtDir)) continue;
    seen.add(wtDir);

    await upsertEnvLocal(wtDir, "PR_DATA", JSON.stringify(entries));
  }

  console.log(`[pr] synced ${seen.size} worktree(s) with PR data from ${allRepoResults.length} repo(s)`);
}

/** Start periodic PR status sync. Returns cleanup function. */
export function startPrMonitor(
  getWorktreePaths: () => Map<string, string>,
  linkedRepos: LinkedRepoConfig[],
  intervalMs: number = 20_000,
): () => void {
  const run = (): void => {
    syncPrStatus(getWorktreePaths, linkedRepos).catch((err: unknown) => {
      console.error(`[pr] sync error: ${err}`);
    });
  };

  // Run once immediately (non-blocking)
  run();

  const timer = setInterval(run, intervalMs);

  return (): void => {
    clearInterval(timer);
  };
}
