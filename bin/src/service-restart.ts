import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { run, type RunResult } from "./shared.ts";
import { generateServiceFile, parseInstalledServiceConfig, type Platform } from "./service.ts";

export type ServicePlatform = Platform;

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
        if (!name.startsWith("webmux-") || !name.endsWith(".service")) continue;
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
export function restartInstalledService(service: InstalledService): RestartOutcome {
  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  const { bin, args } = restartCommand(service, uid);
  const result: RunResult = run(bin, args);
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

function reloadAfterRegenerate(service: InstalledService): RunResult | null {
  if (service.platform === "linux") {
    return run("systemctl", ["--user", "daemon-reload"]);
  }
  // launchd: kickstart -k doesn't re-read the plist. Force unload + load so
  // the new content takes effect. unload may fail when the service isn't
  // currently loaded — that's expected during the first refresh, treat as
  // non-fatal and let `load` decide success.
  run("launchctl", ["unload", service.filePath]);
  return run("launchctl", ["load", "-w", service.filePath]);
}

/** Bring an installed unit file in sync with the current `generateServiceFile`
 *  template (preserving the user's port and project), reload the service
 *  manager so the change takes effect, and restart so the running process
 *  picks up both the new binary and any unit-file changes. Falls back to a
 *  plain restart when the unit can't be parsed — that still gets the new
 *  binary loaded even if regeneration is skipped. */
export function updateInstalledService(
  service: InstalledService,
  webmuxPath: string,
): UpdateOutcome {
  const config = parseInstalledServiceConfig(service.filePath, service.platform, webmuxPath);
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
        writeFileSync(service.filePath, expected);
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
    const reload = reloadAfterRegenerate(service);
    if (reload && !reload.success) {
      return {
        service,
        regenerated,
        restarted: false,
        error: reload.stderr.toString().trim() || "reload failed",
      };
    }
    // On launchd the load step already (re)started the service. systemd
    // still needs an explicit restart so an already-running process picks
    // up the new ExecStart.
    if (service.platform === "darwin") {
      return { service, regenerated, restarted: true };
    }
  }

  const outcome = restartInstalledService(service);
  return {
    service,
    regenerated,
    restarted: outcome.ok,
    error: outcome.error,
  };
}
