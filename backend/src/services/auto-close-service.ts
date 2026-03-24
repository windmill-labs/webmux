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

/** Check all worktrees for merged PRs and remove clean ones.
 *  Called after PR sync completes — reads the PR files that sync just wrote. */
export async function runAutoClose(deps: AutoCloseDependencies): Promise<void> {
  const worktrees = deps.git.listWorktrees(deps.projectRoot)
    .filter((e) => !e.bare && e.branch !== null && e.path !== deps.projectRoot);

  for (const entry of worktrees) {
    const branch = entry.branch!;
    if (deps.isRemoving(branch)) continue;

    const prs = await readWorktreePrs(deps.git.resolveWorktreeGitDir(entry.path));
    if (!prs.some((pr) => pr.state === "merged")) continue;

    if (deps.git.readWorktreeStatus(entry.path).dirty) {
      log.info(`[auto-close] skipping dirty worktree: ${branch}`);
      continue;
    }

    deps.markRemoving(branch);
    try {
      log.info(`[auto-close] removing merged worktree: ${branch}`);
      await deps.lifecycleService.removeWorktree(branch);
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
