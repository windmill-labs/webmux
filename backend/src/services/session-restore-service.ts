import { basename, resolve } from "node:path";
import type { GitGateway, GitWorktreeEntry } from "../adapters/git";
import {
  buildProjectSessionName,
  buildWorktreeWindowName,
  type TmuxGateway,
  type TmuxWindowSummary,
} from "../adapters/tmux";
import { readOpenSessionsState, writeOpenSessionsState } from "../adapters/fs";
import { OPEN_SESSIONS_STATE_VERSION, type OpenSessionsState } from "../domain/model";
import { startSerializedInterval } from "../lib/async";
import { log } from "../lib/log";

/** The branch of a live worktree entry (mirrors the CLI/list convention of
 *  falling back to the directory name when git can't report a branch). */
function entryBranch(entry: Pick<GitWorktreeEntry, "path" | "branch">): string {
  return entry.branch ?? basename(entry.path);
}

/** Compute the set of worktree branches that currently have an open tmux window
 *  in the project session. Pure so it can be unit-tested without git/tmux. */
export function computeOpenBranches(input: {
  worktrees: Array<Pick<GitWorktreeEntry, "path" | "branch" | "bare">>;
  windows: TmuxWindowSummary[];
  sessionName: string;
  projectDir: string;
}): string[] {
  const resolvedProjectDir = resolve(input.projectDir);
  const openWindowNames = new Set(
    input.windows
      .filter((window) => window.sessionName === input.sessionName)
      .map((window) => window.windowName),
  );

  return input.worktrees
    .filter((entry) => !entry.bare && resolve(entry.path) !== resolvedProjectDir)
    .map((entry) => entryBranch(entry))
    .filter((branch) => openWindowNames.has(buildWorktreeWindowName(branch)))
    .sort((left, right) => left.localeCompare(right));
}

export function buildOpenSessionsState(branches: string[], savedAt: Date): OpenSessionsState {
  return {
    schemaVersion: OPEN_SESSIONS_STATE_VERSION,
    savedAt: savedAt.toISOString(),
    branches,
  };
}

export const DEFAULT_SESSION_SNAPSHOT_INTERVAL_MS = 30_000;

export interface SessionSnapshotDependencies {
  git: Pick<GitGateway, "listLiveWorktrees" | "resolveWorktreeGitDir">;
  tmux: Pick<TmuxGateway, "listWindows">;
  projectRoot: string;
  now?: () => Date;
  writeState?: (gitDir: string, state: OpenSessionsState) => Promise<void>;
}

/** Persist the currently-open worktree sessions for `webmux restore`.
 *
 *  Returns the branches written, or null when nothing was written.
 *
 *  An empty open set never overwrites the snapshot: on a reboot the server (and
 *  the snapshot monitor) start before any session is re-opened, so writing an
 *  empty list here would clobber the very data `restore` needs. Keeping the last
 *  non-empty snapshot makes `restore` re-open your last working set. */
export async function saveOpenSessionsSnapshot(
  deps: SessionSnapshotDependencies,
): Promise<string[] | null> {
  const projectRoot = resolve(deps.projectRoot);
  const sessionName = buildProjectSessionName(projectRoot);

  let windows: TmuxWindowSummary[] = [];
  try {
    windows = deps.tmux.listWindows();
  } catch {
    windows = [];
  }

  const worktrees = deps.git.listLiveWorktrees(projectRoot);
  const branches = computeOpenBranches({ worktrees, windows, sessionName, projectDir: projectRoot });
  if (branches.length === 0) return null;

  const now = deps.now ?? ((): Date => new Date());
  const writeState = deps.writeState ?? writeOpenSessionsState;
  const gitDir = deps.git.resolveWorktreeGitDir(projectRoot);
  await writeState(gitDir, buildOpenSessionsState(branches, now()));
  return branches;
}

/** Start periodically saving the open worktree sessions. Returns a cleanup
 *  function that stops the monitor. */
export function startSessionSnapshotMonitor(
  deps: SessionSnapshotDependencies,
  intervalMs: number = DEFAULT_SESSION_SNAPSHOT_INTERVAL_MS,
): () => void {
  log.info(`[session-snapshot] monitor started (interval: ${intervalMs}ms)`);

  const run = async (): Promise<void> => {
    try {
      const branches = await saveOpenSessionsSnapshot(deps);
      if (branches) {
        log.debug(`[session-snapshot] saved ${branches.length} open session(s): ${branches.join(", ")}`);
      }
    } catch (error) {
      log.warn(`[session-snapshot] save failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return startSerializedInterval(run, intervalMs);
}

/** Read the saved open-sessions snapshot for a project. */
export async function readOpenSessionsSnapshot(gitDir: string): Promise<OpenSessionsState> {
  return await readOpenSessionsState(gitDir);
}
