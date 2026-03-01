import type { ServiceConfig } from "./config";

/** Read key=value pairs from a worktree's .env.local file. */
export async function readEnvLocal(wtDir: string): Promise<Record<string, string>> {
  try {
    const text = (await Bun.file(`${wtDir}/.env.local`).text()).trim();
    const env: Record<string, string> = {};
    for (const line of text.split("\n")) {
      const match = line.match(/^(\w+)=(.*)$/);
      if (match) env[match[1]] = match[2];
    }
    return env;
  } catch {
    return {};
  }
}

/** Batch-write multiple key=value pairs to a worktree's .env.local (upsert each key). */
export async function writeEnvLocal(wtDir: string, entries: Record<string, string>): Promise<void> {
  const filePath = `${wtDir}/.env.local`;
  let lines: string[] = [];
  try {
    const content = (await Bun.file(filePath).text()).trim();
    if (content) lines = content.split("\n");
  } catch {
    // File doesn't exist yet
  }

  for (const [key, value] of Object.entries(entries)) {
    const pattern = new RegExp(`^${key}=`);
    const idx = lines.findIndex((l) => pattern.test(l));
    if (idx >= 0) {
      lines[idx] = `${key}=${value}`;
    } else {
      lines.push(`${key}=${value}`);
    }
  }

  await Bun.write(filePath, lines.join("\n") + "\n");
}

/** Read .env.local from all worktree paths, optionally excluding one directory. */
export async function readAllWorktreeEnvs(
  worktreePaths: string[],
  excludeDir?: string,
): Promise<Record<string, string>[]> {
  const results: Record<string, string>[] = [];
  for (const p of worktreePaths) {
    if (excludeDir && p === excludeDir) continue;
    results.push(await readEnvLocal(p));
  }
  return results;
}

/**
 * Pure: compute port assignments for a new worktree.
 * Uses the first allocatable service as a reference to reverse-compute
 * occupied slot indices. Index 0 is reserved for main. Returns a map
 * of portEnv → port value for all services that have portStart set.
 */
export function allocatePorts(
  existingEnvs: Record<string, string>[],
  services: ServiceConfig[],
): Record<string, string> {
  const allocatable = services.filter((s) => s.portStart != null);
  if (allocatable.length === 0) return {};

  // Use the first allocatable service to discover occupied slot indices
  const ref = allocatable[0];
  const refStart = ref.portStart!;
  const refStep = ref.portStep ?? 1;

  const occupied = new Set<number>();
  for (const env of existingEnvs) {
    const raw = env[ref.portEnv];
    if (raw == null) continue;
    const port = Number(raw);
    if (!Number.isInteger(port) || port < refStart) continue;
    const diff = port - refStart;
    if (diff % refStep !== 0) continue;
    occupied.add(diff / refStep);
  }

  // Find the first free slot starting from 1 (0 is reserved for main)
  let slot = 1;
  while (occupied.has(slot)) slot++;

  const result: Record<string, string> = {};
  for (const svc of allocatable) {
    const start = svc.portStart!;
    const step = svc.portStep ?? 1;
    result[svc.portEnv] = String(start + slot * step);
  }
  return result;
}
