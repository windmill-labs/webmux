/** The launch project's `.env`/`.env.local` keys that webmux's CLI loaded into
 *  its own process env, passed down to the backend as a comma-separated list in
 *  WEBMUX_PROJECT_ENV_KEYS. These are application secrets webmux does not need in
 *  the tmux server: if the tmux *global* environment ever captures them (the
 *  server inherits webmux's env from whatever process first starts it) they leak
 *  into every session and pane of every project. WEBMUX_PROJECT_ENV_KEYS itself
 *  is stripped too — it only holds key *names*, not values, but there is no
 *  reason to let a webmux-internal marker reach the global env either. */
export function leakedProjectEnvKeys(): Set<string> {
  const raw = Bun.env.WEBMUX_PROJECT_ENV_KEYS;
  if (!raw) return new Set();
  const keys = new Set<string>(["WEBMUX_PROJECT_ENV_KEYS"]);
  for (const key of raw.split(",").map((entry) => entry.trim()).filter(Boolean)) {
    keys.add(key);
  }
  return keys;
}

/** Copy `base` (typically `Bun.env`) with the launch project's `.env` keys
 *  removed, so a tmux server or client spawned by webmux never carries — nor
 *  captures into its global environment — another project's secrets. Snapshots
 *  `base` at call time; the leaked keys are fixed at launch, so a later mutation
 *  to one of those vars is intentionally not reflected. */
export function stripProjectEnv(base: Record<string, string | undefined>): Record<string, string> {
  const keys = leakedProjectEnvKeys();
  const env: Record<string, string> = {};
  for (const [key, val] of Object.entries(base)) {
    if (val !== undefined && !keys.has(key)) env[key] = val;
  }
  return env;
}
