import type { MultiplexerKind } from "../domain/config";

export type MultiplexerSwitchStage = "close" | "restore";

export interface MultiplexerSwitchFailure {
  branch: string;
  stage: MultiplexerSwitchStage;
  message: string;
}

export interface MultiplexerSwitchProgress {
  stage: MultiplexerSwitchStage | "persist";
  branch?: string;
}

export interface MultiplexerSwitchDependencies {
  /** Branches with a live window, read through the **outgoing** gateway. */
  listOpenBranches: () => Promise<string[]>;
  /** Tear a branch's window down on the **outgoing** gateway. */
  closeWorktree: (branch: string) => Promise<void>;
  /** Write the new choice to the local config overlay. */
  persistMultiplexer: (multiplexer: MultiplexerKind) => Promise<void>;
  /** Re-open a branch on the **incoming** gateway. Must be bound to a runtime
   *  built *after* {@link persistMultiplexer}, or it will reopen on the old one. */
  openWorktree: (branch: string) => Promise<void>;
  onProgress?: (progress: MultiplexerSwitchProgress) => void;
}

export type MultiplexerSwitchResult =
  | { ok: true; changed: false; multiplexer: MultiplexerKind }
  | {
      ok: true;
      changed: true;
      from: MultiplexerKind;
      to: MultiplexerKind;
      closed: string[];
      restored: string[];
      failures: MultiplexerSwitchFailure[];
    }
  | { ok: false; error: string; failures: MultiplexerSwitchFailure[] };

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Move a project's open worktrees from one multiplexer to another.
 *
 *  A pane cannot be handed between multiplexers — the PTY belongs to whichever
 *  server spawned it — so this is a teardown and rebuild: snapshot which branches
 *  are open, close them on the outgoing gateway, flip the config, then re-open
 *  them on the incoming one. Agent conversations survive because re-opening
 *  relaunches in resume mode; scrollback and running processes do not.
 *
 *  Ordering is load-bearing. Closing happens **before** the config flips: once it
 *  has flipped, webmux only speaks to the new multiplexer and can no longer reach
 *  the old one's windows, which would strand them with no way to clean up. For the
 *  same reason a failure to close aborts the switch outright rather than pressing
 *  on — leaving the config pointed at a multiplexer that isn't holding the panes
 *  is worse than not switching at all.
 *
 *  Restore failures are reported but not fatal: by then the old panes are gone, so
 *  there is nothing to roll back to. */
export async function switchMultiplexer(
  from: MultiplexerKind,
  to: MultiplexerKind,
  deps: MultiplexerSwitchDependencies,
): Promise<MultiplexerSwitchResult> {
  if (from === to) {
    return { ok: true, changed: false, multiplexer: to };
  }

  let branches: string[];
  try {
    branches = await deps.listOpenBranches();
  } catch (error) {
    return { ok: false, error: `could not list open worktrees: ${toMessage(error)}`, failures: [] };
  }

  const closed: string[] = [];
  const closeFailures: MultiplexerSwitchFailure[] = [];
  for (const branch of branches) {
    deps.onProgress?.({ stage: "close", branch });
    try {
      await deps.closeWorktree(branch);
      closed.push(branch);
    } catch (error) {
      closeFailures.push({ branch, stage: "close", message: toMessage(error) });
    }
  }

  if (closeFailures.length > 0) {
    return {
      ok: false,
      error: `left the project on ${from}: ${closeFailures.length} worktree(s) could not be closed`,
      failures: closeFailures,
    };
  }

  deps.onProgress?.({ stage: "persist" });
  try {
    await deps.persistMultiplexer(to);
  } catch (error) {
    return { ok: false, error: `could not write the config: ${toMessage(error)}`, failures: [] };
  }

  const restored: string[] = [];
  const failures: MultiplexerSwitchFailure[] = [];
  for (const branch of closed) {
    deps.onProgress?.({ stage: "restore", branch });
    try {
      await deps.openWorktree(branch);
      restored.push(branch);
    } catch (error) {
      failures.push({ branch, stage: "restore", message: toMessage(error) });
    }
  }

  return { ok: true, changed: true, from, to, closed, restored, failures };
}
