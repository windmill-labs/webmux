import { mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "../lib/log";

export interface InstanceEntry {
  prefix: string;
  port: number;
  projectDir: string;
  pid: number;
  startedAt: number;
}

export interface InstanceRegistry {
  register(entry: InstanceEntry): void;
  deregister(port: number): void;
  listLive(): InstanceEntry[];
}

function defaultRegistryDir(): string {
  const home = Bun.env.HOME ?? "/root";
  return join(home, ".webmux", "instances");
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isInstanceEntry(value: unknown): value is InstanceEntry {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.prefix === "string"
    && typeof v.port === "number"
    && typeof v.projectDir === "string"
    && typeof v.pid === "number"
    && typeof v.startedAt === "number";
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

    deregister(port: number): void {
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
