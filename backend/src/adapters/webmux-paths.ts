import { createHash } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

export interface RuntimeStateDirInput {
  homeDir: string;
  tempDir: string;
  projectDir: string;
  isolatedDev: boolean;
}

export function resolveRuntimeStateDir(input: RuntimeStateDirInput): string {
  if (!input.isolatedDev) return join(input.homeDir, ".webmux");
  const scope = createHash("sha1").update(resolve(input.projectDir)).digest("hex").slice(0, 12);
  return join(input.tempDir, "webmux-dev", scope);
}

export function webmuxRuntimeStateDir(): string {
  return resolveRuntimeStateDir({
    homeDir: homedir(),
    tempDir: tmpdir(),
    projectDir: Bun.env.WEBMUX_DEV_STATE_SCOPE ?? Bun.env.WEBMUX_PROJECT_DIR ?? process.cwd(),
    isolatedDev: Bun.env.WEBMUX_DEV_ISOLATED === "1",
  });
}

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
