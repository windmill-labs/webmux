import { readWorktreePrs } from "../adapters/fs";
import type { GitGateway } from "../adapters/git";
import { startSerializedInterval } from "../lib/async";
import { log } from "../lib/log";
import type { LifecycleService } from "./lifecycle-service";
import type { NotificationService } from "./notification-service";

const POLL_INTERVAL_MS = 15_000;

export interface AutoCloseDependencies {
  lifecycleService: LifecycleService;
  git: GitGateway;
  projectRoot: string;
  notifications: NotificationService;
  isActive: () => boolean;
  isRemoving: (branch: string) => boolean;
  markRemoving: (branch: string) => void;
  unmarkRemoving: (branch: string) => void;
}

/** Branches for which auto-close has already been attempted (prevents duplicate work). */
const processedBranches = new Set<string>();

/** Find worktree branches that have a merged PR.
 *  Pure function — reads per-worktree PR files and returns branches eligible for auto-close. */
export async function findMergedWorktrees(
  git: GitGateway,
  projectRoot: string,
): Promise<string[]> {
  const resolvedRoot = projectRoot;
  const entries = git.listWorktrees(resolvedRoot)
    .filter((e) => !e.bare && e.branch !== null && e.path !== resolvedRoot);

  const merged: string[] = [];
  for (const entry of entries) {
    const gitDir = git.resolveWorktreeGitDir(entry.path);
    const prs = await readWorktreePrs(gitDir);
    if (prs.some((pr) => pr.state === "merged")) {
      merged.push(entry.branch!);
    }
  }
  return merged;
}

async function runAutoClose(deps: AutoCloseDependencies): Promise<void> {
  if (!deps.isActive()) {
    log.debug("[auto-close] skipping: no active clients");
    return;
  }

  const mergedBranches = await findMergedWorktrees(deps.git, deps.projectRoot);
  const candidates = mergedBranches.filter((b) => !processedBranches.has(b) && !deps.isRemoving(b));

  if (candidates.length === 0) {
    log.debug("[auto-close] no merged worktrees to clean up");
    return;
  }

  log.info(`[auto-close] found ${candidates.length} merged worktree(s) to remove`);

  for (const branch of candidates) {
    const status = deps.git.readWorktreeStatus(
      deps.git.listWorktrees(deps.projectRoot)
        .find((e) => e.branch === branch)!.path,
    );

    if (status.dirty) {
      log.info(`[auto-close] skipping dirty worktree: ${branch}`);
      continue;
    }

    deps.markRemoving(branch);
    try {
      log.info(`[auto-close] removing merged worktree: ${branch}`);
      await deps.lifecycleService.removeWorktree(branch);
      processedBranches.add(branch);
      deps.notifications.notify({
        branch,
        type: "worktree_auto_removed",
        message: `Worktree auto-removed after merge: ${branch}`,
      });
      log.info(`[auto-close] removed worktree: ${branch}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`[auto-close] failed to remove worktree ${branch}: ${msg}`);
    } finally {
      deps.unmarkRemoving(branch);
    }
  }
}

/** Start periodic polling for merged worktrees and auto-remove them.
 *  Returns a cleanup function that stops the monitor. */
export function startAutoCloseMonitor(deps: AutoCloseDependencies): () => void {
  log.info("[auto-close] monitor started");
  return startSerializedInterval(
    () => runAutoClose(deps),
    POLL_INTERVAL_MS,
  );
}

/** Clear the processed branches set. Useful when re-enabling the monitor. */
export function resetProcessedBranches(): void {
  processedBranches.clear();
}
