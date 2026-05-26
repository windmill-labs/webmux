import { startSerializedInterval, type SerializedIntervalDependencies } from "../lib/async";
import { log } from "../lib/log";
import { branchMatchesIssue, fetchAssignedIssues, type LinearIssue } from "./linear-service";
import type { CreateLifecycleWorktreeInput } from "./lifecycle-service";
import type { GitGateway } from "../adapters/git";

export const LINEAR_AUTO_CREATE_POLL_INTERVAL_MS = 60_000;

export interface LinearAutoCreateLifecycleService {
  createWorktree(input: CreateLifecycleWorktreeInput): Promise<{
    branch: string;
    worktreeId: string;
  }>;
}

export interface LinearAutoCreateDependencies {
  lifecycleService: LinearAutoCreateLifecycleService;
  git: Pick<GitGateway, "listWorktrees">;
  projectRoot: string;
  fetchIssues?: typeof fetchAssignedIssues;
  /** Optional handler for the `webmux_oneshot` label variant. Must return the actual
   *  working branch — the oneshot seed may resolve to `attachmentPayload.branch ??
   *  pr.branch ?? issue.branchName`, which is not always `issue.branchName`. When
   *  omitted, oneshot triggering is skipped. */
  runOneshotForIssue?: (issueId: string) => Promise<{ branch: string }>;
  /** Restrict triggering to issues whose team.key is in this list (uppercase).
   *  Undefined or empty → no team filter (all teams). */
  watchTeamKeys?: string[];
  /** Optional callback invoked after a successful oneshot pickup so external automation
   *  can be notified. `branch` is the actual working branch (can differ from
   *  `issue.branchName` — see `runOneshotForIssue`). Failures are logged and
   *  swallowed — they must not block the pickup itself.
   *  Only fires for the `webmux_oneshot` path: regular `webmux` pickups are
   *  user-driven and don't need a Linear-side bookend. */
  onOneshotPickedUp?: (input: { issue: LinearIssue; branch: string }) => Promise<void>;
}

export interface LinearAutoCreateMonitorOptions {
  intervalDeps?: SerializedIntervalDependencies<unknown>;
}

/** Issue IDs the poller has already acted on. Prevents duplicate triggers
 *  (create OR oneshot) across poll cycles. */
const processedIssueIds = new Set<string>();

const AUTO_CREATE_LABEL = "webmux";
const AUTO_ONESHOT_LABEL = "webmux_oneshot";

function hasLabel(issue: LinearIssue, name: string): boolean {
  return issue.labels.some((l) => l.name.toLowerCase() === name);
}

function matchesTeamFilter(issue: LinearIssue, watchTeamKeys: string[] | undefined): boolean {
  if (!watchTeamKeys || watchTeamKeys.length === 0) return true;
  // watchTeamKeys is expected already-uppercase: parseTeamKeyList normalizes
  // and dedupes before this code is reached.
  return watchTeamKeys.includes(issue.team.key.toUpperCase());
}

/** Shared filter: Todo state, the label rule supplied by the caller, not yet
 *  processed, no existing worktree on the branch, and (when configured) the
 *  issue's team is in the watch list. */
function filterTriggerableIssues(
  issues: LinearIssue[],
  existingBranches: string[],
  matchesLabelRule: (issue: LinearIssue) => boolean,
  watchTeamKeys?: string[],
): LinearIssue[] {
  return issues.filter((issue) => {
    if (issue.state.name !== "Todo") return false;
    if (!matchesLabelRule(issue)) return false;
    if (!matchesTeamFilter(issue, watchTeamKeys)) return false;
    if (processedIssueIds.has(issue.id)) return false;
    return !existingBranches.some((branch) => branchMatchesIssue(branch, issue.branchName));
  });
}

/** Filter issues to only those in Todo state with the "webmux" label that don't already
 *  have a worktree, excluding any tagged with the oneshot variant. */
export function filterAutoCreateIssues(
  issues: LinearIssue[],
  existingBranches: string[],
  watchTeamKeys?: string[],
): LinearIssue[] {
  return filterTriggerableIssues(
    issues,
    existingBranches,
    (issue) => hasLabel(issue, AUTO_CREATE_LABEL) && !hasLabel(issue, AUTO_ONESHOT_LABEL),
    watchTeamKeys,
  );
}

/** Filter issues to only those in Todo state with the "webmux_oneshot" label that don't already
 *  have a worktree. The "webmux_oneshot" label wins over "webmux" — issues tagged with both
 *  run via oneshot mode. */
export function filterAutoOneshotIssues(
  issues: LinearIssue[],
  existingBranches: string[],
  watchTeamKeys?: string[],
): LinearIssue[] {
  return filterTriggerableIssues(
    issues,
    existingBranches,
    (issue) => hasLabel(issue, AUTO_ONESHOT_LABEL),
    watchTeamKeys,
  );
}

export async function runLinearAutoCreateOnce(deps: LinearAutoCreateDependencies): Promise<void> {
  const fetchIssues = deps.fetchIssues ?? fetchAssignedIssues;
  const result = await fetchIssues({ skipCache: true });
  if (!result.ok) {
    log.error(`[linear-auto-create] failed to fetch issues: ${result.error}`);
    return;
  }

  // Evict dedup entries for issues that are no longer eligible (label removed,
  // state moved out of Todo, or issue disappeared). Without this the dedup set
  // would grow forever and removing+re-adding a label couldn't retrigger,
  // which the README promises.
  const eligibleIssueIds = new Set(
    result.data
      .filter(
        (issue) =>
          issue.state.name === "Todo" &&
          (hasLabel(issue, AUTO_CREATE_LABEL) || hasLabel(issue, AUTO_ONESHOT_LABEL)),
      )
      .map((issue) => issue.id),
  );
  for (const id of processedIssueIds) {
    if (!eligibleIssueIds.has(id)) processedIssueIds.delete(id);
  }

  const projectRoot = deps.projectRoot;
  // Raw listWorktrees on purpose: a stale registration still holds its branch
  // in git's view, so we must treat it as taken to avoid re-creating a worktree
  // for an already-registered branch. listLiveWorktrees would skip it.
  const existingBranches = deps.git
    .listWorktrees(projectRoot)
    .filter((entry) => !entry.bare && entry.branch !== null)
    .map((entry) => entry.branch as string);

  const oneshotIssues = deps.runOneshotForIssue
    ? filterAutoOneshotIssues(result.data, existingBranches, deps.watchTeamKeys)
    : [];
  const createIssues = filterAutoCreateIssues(result.data, existingBranches, deps.watchTeamKeys);

  if (oneshotIssues.length === 0 && createIssues.length === 0) {
    log.debug(`[linear-auto-create] no new labeled issues (${result.data.length} assigned, ${existingBranches.length} worktrees)`);
    return;
  }

  if (oneshotIssues.length > 0) {
    log.info(`[linear-auto-create] found ${oneshotIssues.length} new issue(s) with "${AUTO_ONESHOT_LABEL}" label`);
    for (const issue of oneshotIssues) {
      try {
        log.info(`[linear-auto-create] launching oneshot for ${issue.identifier}: ${issue.title}`);
        const { branch } = await deps.runOneshotForIssue!(issue.identifier);
        processedIssueIds.add(issue.id);
        log.info(`[linear-auto-create] launched oneshot for ${issue.identifier} on ${branch}`);
        await notifyOneshotPickup(deps, issue, branch);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error(`[linear-auto-create] failed to launch oneshot for ${issue.identifier}: ${msg}`);
        // Mark as processed so a permanent failure (e.g. "Branch already exists"
        // for an out-of-band local branch) doesn't retry every 60s forever.
        // The label-eviction pass still lets the user retrigger by removing
        // and re-adding the label after fixing the underlying issue.
        processedIssueIds.add(issue.id);
      }
    }
  }

  if (createIssues.length > 0) {
    log.info(`[linear-auto-create] found ${createIssues.length} new issue(s) with "${AUTO_CREATE_LABEL}" label`);
    for (const issue of createIssues) {
      try {
        log.info(`[linear-auto-create] creating worktree for ${issue.identifier}: ${issue.title}`);
        await deps.lifecycleService.createWorktree({
          mode: "new",
          branch: issue.branchName,
          prompt: `${issue.title}\n\n${issue.description ?? ""}`.trim(),
        });
        processedIssueIds.add(issue.id);
        log.info(`[linear-auto-create] created worktree for ${issue.identifier}`);
        // No Linear pickup comment for the regular `webmux` path — the user
        // triggered this themselves by labeling, so the comment would just be
        // noise. The oneshot bookend (above) is for the autonomous case where
        // there's no human in the loop.
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error(`[linear-auto-create] failed to create worktree for ${issue.identifier}: ${msg}`);
        // See the oneshot branch above — dedup on permanent failures.
        processedIssueIds.add(issue.id);
      }
    }
  }
}

async function notifyOneshotPickup(
  deps: LinearAutoCreateDependencies,
  issue: LinearIssue,
  branch: string,
): Promise<void> {
  if (!deps.onOneshotPickedUp) return;
  try {
    await deps.onOneshotPickedUp({ issue, branch });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(`[linear-auto-create] pickup notification failed for ${issue.identifier}: ${msg}`);
  }
}

/** Start periodic polling for new Linear Todo issues and auto-create worktrees.
 *  Returns a cleanup function that stops the monitor. */
export function startLinearAutoCreateMonitor(
  deps: LinearAutoCreateDependencies,
  options: LinearAutoCreateMonitorOptions = {},
): () => void {
  log.info(`[linear-auto-create] monitor started (interval: ${LINEAR_AUTO_CREATE_POLL_INTERVAL_MS}ms)`);
  return startSerializedInterval<unknown>(
    () => runLinearAutoCreateOnce(deps),
    LINEAR_AUTO_CREATE_POLL_INTERVAL_MS,
    options.intervalDeps,
  );
}

/** Clear the processed issue IDs set. Useful for testing or when re-enabling. */
export function resetProcessedIssues(): void {
  processedIssueIds.clear();
}
