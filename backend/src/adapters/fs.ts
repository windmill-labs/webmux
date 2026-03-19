import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type {
  CiCheck,
  ControlEnvMap,
  PrComment,
  PrEntry,
  WorktreeMeta,
  WorktreeStoragePaths,
} from "../domain/model";

const SAFE_ENV_VALUE_RE = /^[A-Za-z0-9_./:@%+=,-]+$/;
const DOTENV_LINE_RE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)/;

function stringifyAllocatedPorts(ports: Record<string, number>): Record<string, string> {
  const entries = Object.entries(ports).map(([key, value]) => [key, String(value)]);
  return Object.fromEntries(entries);
}

function quoteEnvValue(value: string): string {
  if (value.length > 0 && SAFE_ENV_VALUE_RE.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function parseDotenv(content: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of content.split("\n")) {
    if (line.trimStart().startsWith("#")) continue;
    const match = DOTENV_LINE_RE.exec(line);
    if (!match) continue;
    const key = match[1];
    let value = match[2];
    if (value.length >= 2
      && ((value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    } else {
      value = value.trimEnd();
    }
    env[key] = value;
  }
  return env;
}

export async function loadDotenvLocal(worktreePath: string): Promise<Record<string, string>> {
  try {
    const content = await Bun.file(join(worktreePath, ".env.local")).text();
    return parseDotenv(content);
  } catch {
    return {};
  }
}

export function getWorktreeStoragePaths(gitDir: string): WorktreeStoragePaths {
  const webmuxDir = join(gitDir, "webmux");
  return {
    gitDir,
    webmuxDir,
    metaPath: join(webmuxDir, "meta.json"),
    runtimeEnvPath: join(webmuxDir, "runtime.env"),
    controlEnvPath: join(webmuxDir, "control.env"),
    prsPath: join(webmuxDir, "prs.json"),
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
  dotenvValues: Record<string, string> = {},
): Record<string, string> {
  return {
    ...dotenvValues,
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

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}

function isPrComment(raw: unknown): raw is PrComment {
  if (!isRecord(raw)) return false;
  return (raw.type === "comment" || raw.type === "inline")
    && typeof raw.author === "string"
    && typeof raw.body === "string"
    && typeof raw.createdAt === "string"
    && (raw.path === undefined || typeof raw.path === "string")
    && (raw.line === undefined || raw.line === null || typeof raw.line === "number")
    && (raw.diffHunk === undefined || typeof raw.diffHunk === "string")
    && (raw.isReply === undefined || typeof raw.isReply === "boolean");
}

function isCiCheck(raw: unknown): raw is CiCheck {
  if (!isRecord(raw)) return false;
  return typeof raw.name === "string"
    && (raw.status === "pending"
      || raw.status === "success"
      || raw.status === "failed"
      || raw.status === "skipped")
    && (raw.url === null || typeof raw.url === "string")
    && (raw.runId === null || typeof raw.runId === "number");
}

function isPrEntry(raw: unknown): raw is PrEntry {
  if (!isRecord(raw)) return false;
  return typeof raw.repo === "string"
    && typeof raw.number === "number"
    && (raw.state === "open" || raw.state === "closed" || raw.state === "merged")
    && typeof raw.url === "string"
    && typeof raw.updatedAt === "string"
    && (raw.ciStatus === "none"
      || raw.ciStatus === "pending"
      || raw.ciStatus === "success"
      || raw.ciStatus === "failed")
    && Array.isArray(raw.ciChecks)
    && raw.ciChecks.every((check) => isCiCheck(check))
    && Array.isArray(raw.comments)
    && raw.comments.every((comment) => isPrComment(comment));
}

export async function readWorktreePrs(gitDir: string): Promise<PrEntry[]> {
  const { prsPath } = getWorktreeStoragePaths(gitDir);
  try {
    const raw: unknown = await Bun.file(prsPath).json();
    return Array.isArray(raw) && raw.every((entry) => isPrEntry(entry))
      ? raw
      : [];
  } catch {
    return [];
  }
}

export async function writeWorktreePrs(gitDir: string, prs: PrEntry[]): Promise<void> {
  const { prsPath } = await ensureWorktreeStorageDirs(gitDir);
  await Bun.write(prsPath, JSON.stringify(prs, null, 2) + "\n");
}
