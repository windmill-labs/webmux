import type { GitGateway } from "../adapters/git";
import { startSerializedInterval } from "../lib/async";
import { log } from "../lib/log";

export type AutoPullResult =
  | { status: "updated"; from: string; to: string }
  | { status: "already_up_to_date" }
  | { status: "fetch_failed"; error: string }
  | { status: "merge_failed"; error: string };

export interface AutoPullDependencies {
  git: GitGateway;
  projectRoot: string;
  mainBranch: string;
}

/** Pull the main branch via fetch + fast-forward merge. */
export function pullMainBranch(deps: AutoPullDependencies): AutoPullResult {
  const { git, projectRoot, mainBranch } = deps;

  const beforeCommit = git.readWorktreeStatus(projectRoot).currentCommit;

  const fetchResult = git.fetchBranch(projectRoot, "origin", mainBranch);
  if (!fetchResult.ok) {
    return { status: "fetch_failed", error: fetchResult.stderr };
  }

  const mergeResult = git.fastForwardMerge(projectRoot, `origin/${mainBranch}`);
  if (!mergeResult.ok) {
    return { status: "merge_failed", error: mergeResult.stderr };
  }

  const afterStatus = git.readWorktreeStatus(projectRoot);
  const afterCommit = afterStatus.currentCommit;

  if (beforeCommit === afterCommit) {
    return { status: "already_up_to_date" };
  }

  return { status: "updated", from: beforeCommit ?? "unknown", to: afterCommit ?? "unknown" };
}

/** Force-pull the main branch via fetch + hard reset. Discards local state. */
export function forcePullMainBranch(deps: AutoPullDependencies): AutoPullResult {
  const { git, projectRoot, mainBranch } = deps;

  const beforeCommit = git.readWorktreeStatus(projectRoot).currentCommit;

  const fetchResult = git.fetchBranch(projectRoot, "origin", mainBranch);
  if (!fetchResult.ok) {
    return { status: "fetch_failed", error: fetchResult.stderr };
  }

  const resetResult = git.hardReset(projectRoot, `origin/${mainBranch}`);
  if (!resetResult.ok) {
    return { status: "merge_failed", error: resetResult.stderr };
  }

  const afterCommit = git.readWorktreeStatus(projectRoot).currentCommit;
  if (beforeCommit === afterCommit) {
    return { status: "already_up_to_date" };
  }
  return { status: "updated", from: beforeCommit ?? "unknown", to: afterCommit ?? "unknown" };
}

/** Start periodic auto-pull of the main branch.
 *  Returns a cleanup function that stops the monitor. */
export function startAutoPullMonitor(
  deps: AutoPullDependencies,
  intervalMs: number,
): () => void {
  log.info(`[auto-pull] monitor started (interval: ${intervalMs}ms)`);

  const run = async (): Promise<void> => {
    const result = pullMainBranch(deps);
    switch (result.status) {
      case "updated":
        log.info(`[auto-pull] updated ${deps.mainBranch}: ${result.from.slice(0, 8)} → ${result.to.slice(0, 8)}`);
        break;
      case "already_up_to_date":
        log.debug("[auto-pull] already up to date");
        break;
      case "fetch_failed":
        log.warn(`[auto-pull] fetch failed: ${result.error}`);
        break;
      case "merge_failed":
        log.warn(`[auto-pull] merge failed (ff-only): ${result.error}`);
        break;
    }
  };

  return startSerializedInterval(run, intervalMs);
}
