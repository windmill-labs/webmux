import { join } from "node:path";

/** webmux's XDG-style config directory (`~/.config/webmux`). Home to the
 *  control token and the optional global env file. Distinct from the
 *  `~/.webmux` runtime-state dir (projects registry, live-instance registry),
 *  which holds transient state rather than user config. */
export function webmuxConfigDir(): string {
  return join(Bun.env.HOME ?? "/root", ".config", "webmux");
}

/** Optional global env file webmux reads at server startup for machine-wide
 *  secrets (e.g. `LINEAR_API_KEY`). Loaded after the launch project's `.env`
 *  so a project can still override a machine-wide default. */
export function webmuxConfigEnvPath(): string {
  return join(webmuxConfigDir(), ".env");
}
