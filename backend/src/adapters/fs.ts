import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { ControlEnvMap, WorktreeMeta, WorktreeStoragePaths } from "../domain/model";

const SAFE_ENV_VALUE_RE = /^[A-Za-z0-9_./:@%+=,-]+$/;

function stringifyAllocatedPorts(ports: Record<string, number>): Record<string, string> {
  const entries = Object.entries(ports).map(([key, value]) => [key, String(value)]);
  return Object.fromEntries(entries);
}

function quoteEnvValue(value: string): string {
  if (value.length > 0 && SAFE_ENV_VALUE_RE.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function getWorktreeStoragePaths(gitDir: string): WorktreeStoragePaths {
  const webmuxDir = join(gitDir, "webmux");
  return {
    gitDir,
    webmuxDir,
    metaPath: join(webmuxDir, "meta.json"),
    runtimeEnvPath: join(webmuxDir, "runtime.env"),
    controlEnvPath: join(webmuxDir, "control.env"),
  };
}

export async function ensureWorktreeStorageDirs(gitDir: string): Promise<WorktreeStoragePaths> {
  const paths = getWorktreeStoragePaths(gitDir);
  await mkdir(paths.webmuxDir, { recursive: true });
  return paths;
}

export async function readWorktreeMeta(gitDir: string): Promise<WorktreeMeta | null> {
  const { metaPath } = getWorktreeStoragePaths(gitDir);
  try {
    return await Bun.file(metaPath).json() as WorktreeMeta;
  } catch {
    return null;
  }
}

export async function writeWorktreeMeta(gitDir: string, meta: WorktreeMeta): Promise<void> {
  const { metaPath } = await ensureWorktreeStorageDirs(gitDir);
  await Bun.write(metaPath, JSON.stringify(meta, null, 2) + "\n");
}

export function buildRuntimeEnvMap(
  meta: WorktreeMeta,
  extraEnv: Record<string, string> = {},
): Record<string, string> {
  return {
    ...meta.startupEnvValues,
    ...stringifyAllocatedPorts(meta.allocatedPorts),
    ...extraEnv,
    WEBMUX_WORKTREE_ID: meta.worktreeId,
    WEBMUX_BRANCH: meta.branch,
    WEBMUX_PROFILE: meta.profile,
    WEBMUX_AGENT: meta.agent,
    WEBMUX_RUNTIME: meta.runtime,
  };
}

export function buildControlEnvMap(input: {
  controlUrl: string;
  controlToken: string;
  worktreeId: string;
  branch: string;
}): ControlEnvMap {
  return {
    WEBMUX_CONTROL_URL: input.controlUrl,
    WEBMUX_CONTROL_TOKEN: input.controlToken,
    WEBMUX_WORKTREE_ID: input.worktreeId,
    WEBMUX_BRANCH: input.branch,
  };
}

export function renderEnvFile(env: Record<string, string>): string {
  const lines = Object.entries(env)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${quoteEnvValue(value)}`);
  return lines.join("\n") + "\n";
}

export async function writeRuntimeEnv(gitDir: string, env: Record<string, string>): Promise<void> {
  const { runtimeEnvPath } = await ensureWorktreeStorageDirs(gitDir);
  await Bun.write(runtimeEnvPath, renderEnvFile(env));
}

export async function writeControlEnv(gitDir: string, env: ControlEnvMap): Promise<void> {
  const { controlEnvPath } = await ensureWorktreeStorageDirs(gitDir);
  await Bun.write(controlEnvPath, renderEnvFile(env));
}
