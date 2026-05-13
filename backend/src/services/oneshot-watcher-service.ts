import { startSerializedInterval } from "../lib/async";
import { log } from "../lib/log";
import { readWorktreeMeta as readWorktreeMetaDefault } from "../adapters/fs";
import type { ProjectRuntime } from "./project-runtime";
import type { LifecycleService } from "./lifecycle-service";
import type { OneshotPostTarget, WorktreeMeta } from "../domain/model";

const POLL_INTERVAL_MS = 3_000;
/** Idle/stopped/error can be transient (agent between tool calls). Wait this long
 *  with a terminal status before firing close + post-back. */
const IDLE_GRACE_MS = 15_000;

export interface OneshotWatcherDependencies {
  projectRuntime: ProjectRuntime;
  lifecycleService: LifecycleService;
  postToLinear: (branch: string, target: OneshotPostTarget) => Promise<void>;
  isActive: () => boolean;
  /** Override for tests. Defaults to the real filesystem adapter. */
  readWorktreeMeta?: (path: string) => Promise<WorktreeMeta | null>;
  /** Override for tests. Defaults to {@link POLL_INTERVAL_MS}. */
  pollIntervalMs?: number;
  /** Override for tests. Defaults to {@link IDLE_GRACE_MS}. */
  idleGraceMs?: number;
  /** Override for tests. Defaults to `Date.now`. */
  now?: () => number;
}

interface WatchState {
  idleSinceMs: number | null;
  inFlight: boolean;
}

const states = new Map<string, WatchState>();

function getState(branch: string): WatchState {
  let state = states.get(branch);
  if (!state) {
    state = { idleSinceMs: null, inFlight: false };
    states.set(branch, state);
  }
  return state;
}

async function processWorktree(
  branch: string,
  path: string,
  agentLifecycle: string,
  hasPr: boolean,
  deps: OneshotWatcherDependencies,
): Promise<void> {
  const readMeta = deps.readWorktreeMeta ?? readWorktreeMetaDefault;
  const idleGrace = deps.idleGraceMs ?? IDLE_GRACE_MS;
  const now = deps.now ?? (() => Date.now());

  const meta = await readMeta(path);
  if (!meta?.oneshot) {
    // Disarmed (or never armed) — drop any tracked state and skip.
    states.delete(branch);
    return;
  }

  const state = getState(branch);
  if (state.inFlight) return;

  const isTerminal = agentLifecycle === "stopped" || agentLifecycle === "error";
  const isIdle = agentLifecycle === "idle";
  if (!isTerminal && !isIdle) {
    state.idleSinceMs = null;
    return;
  }
  if (state.idleSinceMs === null) state.idleSinceMs = now();
  const stable = isTerminal || now() - state.idleSinceMs >= idleGrace;
  if (!stable) return;

  state.inFlight = true;
  try {
    const reason = isTerminal
      ? `agent ${agentLifecycle}`
      : hasPr
        ? "agent idle after opening PR"
        : "agent idle without opening a PR";
    log.info(`[oneshot-watcher] ${branch}: ${reason} — firing end-of-run actions`);

    if (meta.oneshot.postToLinearOnDone) {
      try {
        await deps.postToLinear(branch, meta.oneshot.postToLinearOnDone);
        log.info(`[oneshot-watcher] ${branch}: posted conversation to Linear`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        log.error(`[oneshot-watcher] ${branch}: post-to-Linear failed — ${msg}`);
      }
    }

    if (meta.oneshot.autoCloseOnDone) {
      try {
        await deps.lifecycleService.closeWorktree(branch);
        log.info(`[oneshot-watcher] ${branch}: closed session`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        log.error(`[oneshot-watcher] ${branch}: close failed — ${msg}`);
      }
    }

    // Disarm so the watcher doesn't re-trigger on the next poll, even if close
    // didn't fully succeed (e.g. user reopens manually — that interaction would
    // disarm anyway, but the explicit clear here removes the race).
    await deps.lifecycleService.disarmOneshot(branch);
  } finally {
    states.delete(branch);
  }
}

export async function runOneshotWatch(deps: OneshotWatcherDependencies): Promise<void> {
  if (!deps.isActive()) return;
  const worktrees = deps.projectRuntime.listWorktrees();
  for (const wt of worktrees) {
    if (wt.source !== "oneshot") continue;
    const hasPr = wt.prs.length > 0;
    await processWorktree(wt.branch, wt.path, wt.agent.lifecycle, hasPr, deps);
  }
}

/** Start periodic polling for armed oneshot worktrees. Returns a cleanup function. */
export function startOneshotWatcher(deps: OneshotWatcherDependencies): () => void {
  log.info("[oneshot-watcher] monitor started");
  return startSerializedInterval(
    () => runOneshotWatch(deps),
    deps.pollIntervalMs ?? POLL_INTERVAL_MS,
  );
}

/** Test/reset helper — clears the per-branch idle timer state. */
export function resetOneshotWatcherState(): void {
  states.clear();
}
