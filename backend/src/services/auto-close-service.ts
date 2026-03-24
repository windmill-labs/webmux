import { readWorktreePrs } from "../adapters/fs";
import type { GitGateway } from "../adapters/git";
import { log } from "../lib/log";
import type { LifecycleService } from "./lifecycle-service";
import type { NotificationService } from "./notification-service";

export interface AutoCloseDependencies {
  lifecycleService: LifecycleService;
  git: GitGateway;
  projectRoot: string;
  notifications: NotificationService;
  isRemoving: (branch: string) => boolean;
  markRemoving: (branch: string) => void;
  unmarkRemoving: (branch: string) => void;
}

/** Branches for which auto-close has already been attempted (prevents duplicate work). */
const processedBranches = new Set<string>();

/** Find worktree branches that have a merged PR.
 *  Reads per-worktree PR files and returns branches eligible for auto-close. */
export async function findMergedWorktrees(
  git: GitGateway,
  projectRoot: string,
): Promise<string[]> {
  const entries = git.listWorktrees(projectRoot)
    .filter((e) => !e.bare && e.branch !== null && e.path !== projectRoot);

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

/** Run a single auto-close cycle. Called after PR sync completes. */
export async function runAutoClose(deps: AutoCloseDependencies): Promise<void> {
  const mergedBranches = await findMergedWorktrees(deps.git, deps.projectRoot);
  const candidates = mergedBranches.filter((b) => !processedBranches.has(b) && !deps.isRemoving(b));

  if (candidates.length === 0) {
    log.debug("[auto-close] no merged worktrees to clean up");
    return;
  }

  log.info(`[auto-close] found ${candidates.length} merged worktree(s) to remove`);

  const currentWorktrees = deps.git.listWorktrees(deps.projectRoot);
  for (const branch of candidates) {
    const entry = currentWorktrees.find((e) => e.branch === branch);
    if (!entry) {
      log.warn(`[auto-close] worktree disappeared before status check: ${branch}`);
      continue;
    }

    const status = deps.git.readWorktreeStatus(entry.path);
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

  // Prune processed branches that no longer have worktrees
  const activeBranches = new Set(currentWorktrees.map((e) => e.branch).filter(Boolean));
  for (const branch of processedBranches) {
    if (!activeBranches.has(branch)) {
      processedBranches.delete(branch);
    }
  }
}

/** Clear the processed branches set. Useful when re-enabling. */
export function resetProcessedBranches(): void {
  processedBranches.clear();
}
