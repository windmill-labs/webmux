import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { run, type RunResult } from "./shared.ts";
import { generateServiceFile, parseInstalledServiceConfig, type Platform } from "./service.ts";

export type ServicePlatform = Platform;

/** Indirection over `run` so tests can inject a stub recorder without
 *  spawning real systemctl/launchctl. Production code uses the default. */
export interface ServiceRunner {
  run(bin: string, args: string[]): RunResult;
}

const defaultRunner: ServiceRunner = { run };

export interface InstalledService {
  /** Full unit name. systemd: "webmux-foo" (no .service suffix). launchd: the
   *  plist Label, e.g. "com.webmux.foo". */
  name: string;
  filePath: string;
  platform: ServicePlatform;
}

const DEFAULT_SYSTEMD_DIR = join(homedir(), ".config", "systemd", "user");
const DEFAULT_LAUNCHD_DIR = join(homedir(), "Library", "LaunchAgents");

/** Enumerate webmux service units installed for the current user, across both
 *  platforms (one platform's dir is typically absent). Best-effort: unreadable
 *  directories return nothing rather than throwing. */
export function listInstalledServices(opts: {
  systemdDir?: string;
  launchdDir?: string;
} = {}): InstalledService[] {
  const out: InstalledService[] = [];
  const systemdDir = opts.systemdDir ?? DEFAULT_SYSTEMD_DIR;
  const launchdDir = opts.launchdDir ?? DEFAULT_LAUNCHD_DIR;

  if (existsSync(systemdDir)) {
    try {
      for (const name of readdirSync(systemdDir)) {
        // The single service is `webmux.service`; `webmux-<project>.service`
        // are legacy per-project units (kept working until they're migrated).
        if (!/^webmux(-.+)?\.service$/.test(name)) continue;
        out.push({
          name: name.slice(0, -".service".length),
          filePath: join(systemdDir, name),
          platform: "linux",
        });
      }
    } catch {
      // unreadable dir — skip
    }
  }

  if (existsSync(launchdDir)) {
    try {
      for (const name of readdirSync(launchdDir)) {
        if (!name.startsWith("com.webmux.") || !name.endsWith(".plist")) continue;
        out.push({
          name: name.slice(0, -".plist".length),
          filePath: join(launchdDir, name),
          platform: "darwin",
        });
      }
    } catch {
      // unreadable dir — skip
    }
  }

  return out;
}

/** Pure command builder for restarting a service. Kept separate from the
 *  I/O call so it can be unit-tested without spawning processes. */
export function restartCommand(service: InstalledService, uid: number): { bin: string; args: string[] } {
  if (service.platform === "linux") {
    return { bin: "systemctl", args: ["--user", "restart", service.name] };
  }
  return { bin: "launchctl", args: ["kickstart", "-k", `gui/${uid}/${service.name}`] };
}

export interface RestartOutcome {
  service: InstalledService;
  ok: boolean;
  error?: string;
}

/** Restart a single installed service. Best-effort: a failure (service not
 *  loaded, masked, etc.) is reported back rather than thrown. */
export function restartInstalledService(
  service: InstalledService,
  runner: ServiceRunner = defaultRunner,
): RestartOutcome {
  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  const { bin, args } = restartCommand(service, uid);
  const result = runner.run(bin, args);
  if (!result.success) {
    return {
      service,
      ok: false,
      error: result.stderr.toString().trim() || `${bin} ${args.join(" ")} failed`,
    };
  }
  return { service, ok: true };
}

export interface UpdateOutcome {
  service: InstalledService;
  regenerated: boolean;
  restarted: boolean;
  error?: string;
}

function reloadAfterRegenerate(
  service: InstalledService,
  runner: ServiceRunner,
): { ok: boolean; error?: string } {
  if (service.platform === "linux") {
    const result = runner.run("systemctl", ["--user", "daemon-reload"]);
    return result.success
      ? { ok: true }
      : { ok: false, error: result.stderr.toString().trim() || "daemon-reload failed" };
  }
  // launchd: kickstart -k doesn't re-read the plist. Force unload + load so
  // the new content takes effect. unload may fail when the service isn't
  // currently loaded — that's expected during the first refresh, treat as
  // non-fatal and let `load` decide success.
  runner.run("launchctl", ["unload", service.filePath]);
  const loadResult = runner.run("launchctl", ["load", "-w", service.filePath]);
  if (loadResult.success) return { ok: true };
  // If load fails after we unloaded, the service is now offline. Surface a
  // recovery command rather than just the raw stderr so the user can fix it
  // without digging through launchd docs.
  const stderr = loadResult.stderr.toString().trim() || "load failed";
  return {
    ok: false,
    error: `${stderr}\n  service is now unloaded — recover with: launchctl load -w "${service.filePath}"`,
  };
}

/** Bring an installed unit file in sync with the current `generateServiceFile`
 *  template (preserving the user's port and project), reload the service
 *  manager so the change takes effect, and restart so the running process
 *  picks up both the new binary and any unit-file changes. Falls back to a
 *  plain restart when the unit can't be parsed *or* when `webmuxPath` is
 *  empty — both cases would otherwise corrupt the unit's `ExecStart`. */
export async function updateInstalledService(
  service: InstalledService,
  webmuxPath: string,
  runner: ServiceRunner = defaultRunner,
): Promise<UpdateOutcome> {
  // Empty webmuxPath would write `ExecStart=  serve --port N` into the unit
  // and silently break the next restart. Happens when `which webmux` returns
  // nothing after a botched global install. Skip regeneration entirely; the
  // existing unit's ExecStart is still valid, so a plain restart picks up the
  // new binary in place.
  const canRegenerate = webmuxPath.length > 0;
  const config = canRegenerate
    ? parseInstalledServiceConfig(service.filePath, service.platform, webmuxPath)
    : null;
  let regenerated = false;

  if (config !== null) {
    let currentContent = "";
    try {
      currentContent = readFileSync(service.filePath, "utf8");
    } catch {
      // unreadable — fall through to plain restart
    }
    const expected = generateServiceFile(config);
    if (currentContent !== expected) {
      try {
        await Bun.write(service.filePath, expected);
        regenerated = true;
      } catch (err: unknown) {
        return {
          service,
          regenerated: false,
          restarted: false,
          error: `could not rewrite ${service.filePath}: ${String(err)}`,
        };
      }
    }
  }

  if (regenerated) {
    const reload = reloadAfterRegenerate(service, runner);
    if (!reload.ok) {
      return { service, regenerated, restarted: false, error: reload.error };
    }
    // On launchd the load step already (re)started the service. systemd
    // still needs an explicit restart so an already-running process picks
    // up the new ExecStart.
    if (service.platform === "darwin") {
      return { service, regenerated, restarted: true };
    }
  }

  const outcome = restartInstalledService(service, runner);
  return {
    service,
    regenerated,
    restarted: outcome.ok,
    error: outcome.error,
  };
}
