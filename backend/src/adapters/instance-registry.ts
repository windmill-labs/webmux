// Sync Node fs APIs on purpose: register/deregister run from synchronous startup
// and `process.on("exit")` paths where async (Bun.write) would not flush in time.
import { mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { log } from "../lib/log";

/** A live webmux server, self-registered under `~/.webmux/instances/<port>.json`.
 *
 *  This registry is a transitional **migration sensor**: webmux now runs one
 *  multi-project server per machine, so the only reason to track other live
 *  servers is to detect leftover single-project instances (from the old
 *  one-server-per-project model) and consolidate them via `webmux project
 *  migrate`. `projectDir` is the repo that instance was started for — what
 *  migration recovers into the surviving server. Nothing new should be built on
 *  this; it goes away once the migration path is retired. */
export interface InstanceEntry {
  port: number;
  projectDir: string;
  pid: number;
}

export interface InstanceRegistry {
  register(entry: InstanceEntry): void;
  /** Delete the entry at `port`. When `expectedPid` is provided, the entry is
   *  only deleted if its `pid` matches — guards against a late shutdown handler
   *  clobbering a successor process that has reused the same port. */
  deregister(port: number, expectedPid?: number): void;
  listLive(): InstanceEntry[];
}

function defaultRegistryDir(): string {
  return join(homedir(), ".webmux", "instances");
}

/** A live PID is one we can signal. `ESRCH` means "no such process" — that's
 *  the only signal we treat as "dead". Other errors (notably `EPERM` for a PID
 *  we don't own, e.g. a `sudo`-started peer) mean the process exists but we
 *  can't touch it — still alive from the registry's perspective. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    return (err as { code?: string } | null)?.code !== "ESRCH";
  }
}

function isInstanceEntry(value: unknown): value is InstanceEntry {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.port === "number"
    && typeof v.projectDir === "string"
    && typeof v.pid === "number";
}

export function createInstanceRegistry(dir: string = defaultRegistryDir()): InstanceRegistry {
  function ensureDir(): void {
    mkdirSync(dir, { recursive: true });
  }

  function entryPath(port: number): string {
    return join(dir, `${port}.json`);
  }

  function readEntry(filename: string): InstanceEntry | null {
    try {
      const raw = readFileSync(join(dir, filename), "utf8");
      const parsed: unknown = JSON.parse(raw);
      return isInstanceEntry(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  return {
    register(entry: InstanceEntry): void {
      ensureDir();
      const finalPath = entryPath(entry.port);
      const tmpPath = `${finalPath}.${process.pid}.${Date.now()}.tmp`;
      const text = `${JSON.stringify(entry, null, 2)}\n`;
      writeFileSync(tmpPath, text);
      renameSync(tmpPath, finalPath);
    },

    deregister(port: number, expectedPid?: number): void {
      if (expectedPid !== undefined) {
        const filename = `${port}.json`;
        const entry = readEntry(filename);
        if (entry && entry.pid !== expectedPid) {
          // The entry belongs to a successor process that reused our port.
          // Leave it alone.
          return;
        }
      }
      try {
        unlinkSync(entryPath(port));
      } catch (err: unknown) {
        const code = (err as { code?: string } | null)?.code;
        if (code !== "ENOENT") {
          log.debug(`[instance-registry] deregister(${port}) failed: ${String(err)}`);
        }
      }
    },

    listLive(): InstanceEntry[] {
      let filenames: string[];
      try {
        filenames = readdirSync(dir).filter((name) => name.endsWith(".json"));
      } catch {
        return [];
      }

      const live: InstanceEntry[] = [];
      for (const filename of filenames) {
        const entry = readEntry(filename);
        if (!entry) continue;
        if (!isAlive(entry.pid)) {
          try {
            unlinkSync(join(dir, filename));
          } catch {
            // best effort — another process may have cleaned it already
          }
          continue;
        }
        live.push(entry);
      }
      return live;
    },
  };
}
