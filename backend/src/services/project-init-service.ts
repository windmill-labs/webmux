import { log } from "../lib/log";

export type ProjectInitPhase = "creating_config" | "analyzing" | "ready" | "failed";

export interface ProjectInitState {
  /** Canonical (git-root) path being set up — the tracker key. */
  path: string;
  phase: ProjectInitPhase;
  /** Set once the project is registered (phase "ready"). */
  prefix: string | null;
  name: string | null;
  /** Set when phase is "failed". */
  error: string | null;
  updatedAt: number;
}

const DEFAULT_TERMINAL_TTL_MS = 60_000;

function isTerminal(phase: ProjectInitPhase): boolean {
  return phase === "ready" || phase === "failed";
}

/** Hub-level record of in-flight (and recently-finished) on-add project setups,
 *  so the UI and CLI can observe progress. Terminal entries (ready/failed) are
 *  kept briefly so a poller can see the outcome, then evicted by TTL; in-flight
 *  entries never expire. */
export class ProjectInitTracker {
  private readonly inits = new Map<string, ProjectInitState>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(opts: { ttlMs?: number; now?: () => number } = {}) {
    this.ttlMs = opts.ttlMs ?? DEFAULT_TERMINAL_TTL_MS;
    this.now = opts.now ?? Date.now;
  }

  set(path: string, update: { phase: ProjectInitPhase; prefix?: string; name?: string; error?: string }): void {
    const existing = this.inits.get(path);
    this.inits.set(path, {
      path,
      phase: update.phase,
      prefix: update.prefix ?? existing?.prefix ?? null,
      name: update.name ?? existing?.name ?? null,
      error: update.error ?? (update.phase === "failed" ? existing?.error ?? null : null),
      updatedAt: this.now(),
    });
  }

  get(path: string): ProjectInitState | null {
    return this.inits.get(path) ?? null;
  }

  /** True while a setup is mid-flight for `path` (not yet ready/failed). */
  isActive(path: string): boolean {
    const state = this.inits.get(path);
    return state !== undefined && !isTerminal(state.phase);
  }

  /** Live view: drops terminal entries past their TTL so the map doesn't grow
   *  unbounded across many project setups. */
  list(): ProjectInitState[] {
    const cutoff = this.now() - this.ttlMs;
    for (const [path, state] of this.inits) {
      if (isTerminal(state.phase) && state.updatedAt < cutoff) this.inits.delete(path);
    }
    return [...this.inits.values()];
  }
}

/** I/O the orchestration needs, injected so it stays unit-testable. */
export interface ProjectInitDeps {
  /** Whether the agent CLI used for analysis is available on PATH. */
  analyzerAvailable: () => boolean;
  /** Write the starter .webmux.yaml at the repo root. */
  scaffold: (root: string) => Promise<void>;
  /** Run the headless agent to flesh out the scaffolded config. */
  analyze: (root: string) => Promise<void>;
  /** Register + persist the project (config is now on disk); returns its prefix/name. */
  register: (root: string) => { prefix: string; name: string };
}

/** Drive an on-add project setup, updating `tracker` so the UI/CLI can watch:
 *  scaffold the config → analyze the repo with the agent (best-effort; skipped
 *  if unavailable, non-fatal on error so the starter config still ships) →
 *  register the project → ready. A scaffold/register failure is terminal. */
export async function runProjectInit(
  tracker: ProjectInitTracker,
  root: string,
  deps: ProjectInitDeps,
): Promise<void> {
  log.info(`[project-init] setting up ${root}`);
  try {
    tracker.set(root, { phase: "creating_config" });
    await deps.scaffold(root);

    if (deps.analyzerAvailable()) {
      tracker.set(root, { phase: "analyzing" });
      try {
        await deps.analyze(root);
      } catch (err: unknown) {
        // Analysis is a best-effort enrichment; keep the starter config and
        // finish setup rather than stranding the user with no project. Recoverable,
        // so warn (not error) — setup still succeeds.
        log.warn(`[project-init] analysis failed for ${root}, keeping starter config: ${String(err)}`);
      }
    }

    const { prefix, name } = deps.register(root);
    tracker.set(root, { phase: "ready", prefix, name });
    log.info(`[project-init] ${root} ready as "${prefix}"`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`[project-init] setup failed for ${root}: ${message}`);
    tracker.set(root, { phase: "failed", error: message });
  }
}
