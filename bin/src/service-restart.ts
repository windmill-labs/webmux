import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { run, type RunResult } from "./shared.ts";

export type ServicePlatform = "linux" | "darwin";

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
