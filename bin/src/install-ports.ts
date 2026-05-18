import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInstanceRegistry } from "../../backend/src/adapters/instance-registry";

export const DEFAULT_SYSTEMD_DIR = join(homedir(), ".config", "systemd", "user");
export const DEFAULT_LAUNCHD_DIR = join(homedir(), "Library", "LaunchAgents");

const SYSTEMD_PORT_RE = /--port\s+(\d+)/;
const LAUNCHD_PORT_RE = /<string>--port<\/string>\s*<string>(\d+)<\/string>/;

/** Lowest port `>= start` not in `taken`. */
export function pickFreePort(start: number, taken: Iterable<number>): number {
  const set = new Set(taken);
  let port = start;
  while (set.has(port)) port += 1;
  return port;
}

/** Ports claimed by other webmux service units already installed on this
 *  machine — systemd unit files on Linux and launchd plists on macOS.
 *  Scanning the unit files (rather than only live processes) means an installed
 *  but currently stopped service still reserves its port. */
export function readInstalledServicePorts(opts: {
  systemdDir?: string;
  launchdDir?: string;
  excludePath?: string;
} = {}): number[] {
  const systemdDir = opts.systemdDir ?? DEFAULT_SYSTEMD_DIR;
  const launchdDir = opts.launchdDir ?? DEFAULT_LAUNCHD_DIR;
  const ports: number[] = [];

  function collect(dir: string, namePredicate: (n: string) => boolean): void {
    if (!existsSync(dir)) return;
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (!namePredicate(name)) continue;
      const full = join(dir, name);
      if (opts.excludePath && full === opts.excludePath) continue;
      const port = readPortFromUnit(full);
      if (port !== null) ports.push(port);
    }
  }

  collect(systemdDir, (n) => n.startsWith("webmux-") && n.endsWith(".service"));
  collect(launchdDir, (n) => n.startsWith("com.webmux.") && n.endsWith(".plist"));
  return ports;
}

/** Parse a `--port N` value out of a service unit file. Dispatches on file
 *  extension so each format gets a tight regex (`--port 5111` for systemd vs
 *  `<string>--port</string>\s*<string>5111</string>` for launchd plists) —
 *  no shared char-window assumption that breaks if either generator's
 *  indentation changes. Returns null when no port is declared or the file
 *  is unreadable. */
export function readPortFromUnit(filePath: string): number | null {
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
  const regex = filePath.endsWith(".plist") ? LAUNCHD_PORT_RE : SYSTEMD_PORT_RE;
  const match = regex.exec(text);
  return match ? parseInt(match[1], 10) : null;
}

/** Combine live-registry ports and installed-unit ports into a single set
 *  to skip when picking a port for a fresh `service install`. */
export function discoverTakenPorts(opts: {
  registryDir?: string;
  systemdDir?: string;
  launchdDir?: string;
  excludeUnitPath?: string;
} = {}): Set<number> {
  const registry = createInstanceRegistry(opts.registryDir);
  const live = registry.listLive().map((entry) => entry.port);
  const installed = readInstalledServicePorts({
    systemdDir: opts.systemdDir,
    launchdDir: opts.launchdDir,
    excludePath: opts.excludeUnitPath,
  });
  return new Set([...live, ...installed]);
}
