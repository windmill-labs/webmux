import type { GitGateway } from "../adapters/git";
import type { PrEntry } from "../domain/model";
import { log } from "../lib/log";
import type { LifecycleService } from "./lifecycle-service";
import type { NotificationService } from "./notification-service";

export interface AutoRemoveDependencies {
  lifecycleService: LifecycleService;
  git: GitGateway;
  projectRoot: string;
  notifications: NotificationService;
  isRemoving: (branch: string) => boolean;
  markRemoving: (branch: string) => void;
  unmarkRemoving: (branch: string) => void;
  /** Authoritative PR states per branch across all configured repos. Queried live
   *  rather than read from the per-worktree PR cache, so a merge is detected even
   *  when no open-state display sync ever ran (dashboard was never opened). Returns
   *  null when the query was inconclusive (a repo fetch failed) -- removing on
   *  partial state could drop an open cross-repo PR and remove a live worktree. */
  getBranchPrStates: () => Promise<Map<string, PrEntry["state"][]> | null>;
}

/** Check all worktrees for merged PRs and remove clean ones. */
export async function runAutoRemove(deps: AutoRemoveDependencies): Promise<void> {
  const worktrees = deps.git.listLiveWorktrees(deps.projectRoot)
    .filter((e) => !e.bare && e.branch !== null && e.path !== deps.projectRoot);
  if (worktrees.length === 0) return;

  const branchStates = await deps.getBranchPrStates();
  if (branchStates === null) {
    log.debug("[auto-remove] skipping sweep: PR state fetch was inconclusive");
    return;
  }

  for (const entry of worktrees) {
    const branch = entry.branch!;
    if (deps.isRemoving(branch)) continue;

    const states = branchStates.get(branch);
    if (!states || states.length === 0) continue;
    if (!states.every((state) => state === "merged")) continue;

    if (deps.git.readWorktreeStatus(entry.path).dirty) {
      log.info(`[auto-remove] skipping dirty worktree: ${branch}`);
      continue;
    }

    deps.markRemoving(branch);
    try {
      log.info(`[auto-remove] removing merged worktree: ${branch}`);
      await deps.lifecycleService.removeWorktree(branch);
      deps.notifications.notify({
        branch,
        type: "worktree_auto_removed",
        message: `Worktree auto-removed after merge: ${branch}`,
      });
      log.info(`[auto-remove] removed worktree: ${branch}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`[auto-remove] failed to remove worktree ${branch}: ${msg}`);
    } finally {
      deps.unmarkRemoving(branch);
    }
  }
}
