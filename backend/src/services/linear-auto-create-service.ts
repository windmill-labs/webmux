import { startSerializedInterval } from "../lib/async";
import { log } from "../lib/log";
import { branchMatchesIssue, fetchAssignedIssues, type LinearIssue } from "./linear-service";
import type { LifecycleService } from "./lifecycle-service";
import type { GitGateway } from "../adapters/git";

const POLL_INTERVAL_MS = 15_000;

export interface LinearAutoCreateDependencies {
  lifecycleService: LifecycleService;
  git: GitGateway;
  projectRoot: string;
  isActive: () => boolean;
}

/** Issue IDs for which worktrees have been successfully created.
 *  Prevents duplicate creation attempts across poll cycles. */
const processedIssueIds = new Set<string>();

const AUTO_CREATE_LABEL = "webmux";

/** Filter issues to only those in Todo state with the "webmux" label that don't already have a worktree. */
export function filterAutoCreateIssues(
  issues: LinearIssue[],
  existingBranches: string[],
): LinearIssue[] {
  return issues.filter((issue) => {
    if (issue.state.name !== "Todo") return false;
    if (!issue.labels.some((l) => l.name.toLowerCase() === AUTO_CREATE_LABEL)) return false;
    if (processedIssueIds.has(issue.id)) return false;
    return !existingBranches.some((branch) => branchMatchesIssue(branch, issue.branchName));
  });
}

async function runAutoCreate(deps: LinearAutoCreateDependencies): Promise<void> {
  if (!deps.isActive()) {
    log.debug("[linear-auto-create] skipping: no active clients");
    return;
  }

  const result = await fetchAssignedIssues({ skipCache: true });
  if (!result.ok) {
    log.error(`[linear-auto-create] failed to fetch issues: ${result.error}`);
    return;
  }

  const projectRoot = deps.projectRoot;
  const existingBranches = deps.git
    .listWorktrees(projectRoot)
    .filter((entry) => !entry.bare && entry.branch !== null)
    .map((entry) => entry.branch as string);

  const newIssues = filterAutoCreateIssues(result.data, existingBranches);
  if (newIssues.length === 0) {
    log.debug(`[linear-auto-create] no new labeled issues (${result.data.length} assigned, ${existingBranches.length} worktrees)`);
    return;
  }

  log.info(`[linear-auto-create] found ${newIssues.length} new issue(s) with "${AUTO_CREATE_LABEL}" label`);

  for (const issue of newIssues) {
    try {
      log.info(`[linear-auto-create] creating worktree for ${issue.identifier}: ${issue.title}`);
      await deps.lifecycleService.createWorktree({
        mode: "new",
        branch: issue.branchName,
        prompt: `${issue.title}\n\n${issue.description ?? ""}`.trim(),
      });
      processedIssueIds.add(issue.id);
      log.info(`[linear-auto-create] created worktree for ${issue.identifier}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`[linear-auto-create] failed to create worktree for ${issue.identifier}: ${msg}`);
    }
  }
}

/** Start periodic polling for new Linear Todo issues and auto-create worktrees.
 *  Returns a cleanup function that stops the monitor. */
export function startLinearAutoCreateMonitor(
  deps: LinearAutoCreateDependencies,
): () => void {
  log.info("[linear-auto-create] monitor started");
  return startSerializedInterval(
    () => runAutoCreate(deps),
    POLL_INTERVAL_MS,
  );
}

/** Clear the processed issue IDs set. Useful for testing or when re-enabling. */
export function resetProcessedIssues(): void {
  processedIssueIds.clear();
}
