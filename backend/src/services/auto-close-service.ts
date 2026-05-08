import { readWorktreeMeta, readWorktreePrs } from "../adapters/fs";
import type { GitGateway } from "../adapters/git";
import { buildProjectSessionName, buildWorktreeWindowName, type TmuxGateway, type TmuxWindowSummary } from "../adapters/tmux";
import { log } from "../lib/log";
import type { LifecycleService } from "./lifecycle-service";
import type { NotificationService } from "./notification-service";

export interface AutoCloseDependencies {
  lifecycleService: LifecycleService;
  git: GitGateway;
  tmux: TmuxGateway;
  projectRoot: string;
  notifications: NotificationService;
  isClosing: (branch: string) => boolean;
  markClosing: (branch: string) => void;
  unmarkClosing: (branch: string) => void;
}

/** Check all worktrees with `onMergeAction === "close"` for merged PRs and close
 *  their tmux window. The worktree itself is left on disk so it can be re-opened
 *  later. Called after PR sync completes. */
export async function runAutoClose(deps: AutoCloseDependencies): Promise<void> {
  const worktrees = deps.git.listWorktrees(deps.projectRoot)
    .filter((e) => !e.bare && e.branch !== null && e.path !== deps.projectRoot);

  let windows: TmuxWindowSummary[] = [];
  try {
    windows = deps.tmux.listWindows();
  } catch {
    windows = [];
  }
  const sessionName = buildProjectSessionName(deps.projectRoot);
  const openWindowNames = new Set(
    windows.filter((w) => w.sessionName === sessionName).map((w) => w.windowName),
  );

  for (const entry of worktrees) {
    const branch = entry.branch!;
    if (deps.isClosing(branch)) continue;

    const gitDir = deps.git.resolveWorktreeGitDir(entry.path);
    const meta = await readWorktreeMeta(gitDir);
    if (meta?.onMergeAction !== "close") continue;

    if (!openWindowNames.has(buildWorktreeWindowName(branch))) continue;

    const prs = await readWorktreePrs(gitDir);
    if (prs.length === 0) continue;
    if (!prs.every((pr) => pr.state === "merged")) continue;

    deps.markClosing(branch);
    try {
      log.info(`[auto-close] closing merged worktree session: ${branch}`);
      await deps.lifecycleService.closeWorktree(branch);
      deps.notifications.notify({
        branch,
        type: "worktree_auto_closed",
        message: `Worktree session auto-closed after merge: ${branch}`,
      });
      log.info(`[auto-close] closed worktree session: ${branch}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`[auto-close] failed to close worktree ${branch}: ${msg}`);
    } finally {
      deps.unmarkClosing(branch);
    }
  }
}
