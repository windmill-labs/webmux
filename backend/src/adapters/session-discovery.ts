import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { isRecord } from "../lib/type-guards";
import { encodeClaudeProjectDir } from "./claude-cli";

/** Built-in agents whose on-disk session history we can discover. */
export type DiscoverableAgentKind = "claude" | "codex";

export interface SessionDiscoveryGateway {
  /** Session ids for `cwd`, newest first. Claude reads `~/.claude/projects/<encoded>/`,
   *  Codex scans `~/.codex/sessions/**` and matches `session_meta.cwd`. */
  listSessionIds(agent: DiscoverableAgentKind, cwd: string): Promise<string[]>;
}

interface StampedSession {
  sessionId: string;
  mtimeMs: number;
}

function home(): string {
  const value = Bun.env.HOME;
  if (!value) throw new Error("HOME is required to resolve agent sessions");
  return value;
}

function newestFirst(sessions: StampedSession[]): string[] {
  return sessions.sort((left, right) => right.mtimeMs - left.mtimeMs).map((entry) => entry.sessionId);
}

async function listClaudeSessionIds(cwd: string): Promise<string[]> {
  const dir = join(home(), ".claude", "projects", encodeClaudeProjectDir(cwd));
  const names = await readdir(dir).catch((): string[] => []);
  const stamped = await Promise.all(
    names
      .filter((name) => name.endsWith(".jsonl"))
      .map(async (name): Promise<StampedSession | null> => {
        const info = await stat(join(dir, name)).catch(() => null);
        return info ? { sessionId: basename(name, ".jsonl"), mtimeMs: info.mtimeMs } : null;
      }),
  );
  return newestFirst(stamped.filter((entry): entry is StampedSession => entry !== null));
}

async function readCodexSessionCwdId(path: string): Promise<{ id: string; cwd: string } | null> {
  try {
    // The `session_meta` record carrying cwd + id is the first line; 16KB covers it.
    const head = await Bun.file(path).slice(0, 16384).text();
    const firstLine = head.split("\n", 1)[0];
    if (!firstLine) return null;
    const parsed: unknown = JSON.parse(firstLine);
    if (!isRecord(parsed) || parsed.type !== "session_meta" || !isRecord(parsed.payload)) return null;
    const { id, cwd } = parsed.payload;
    return typeof id === "string" && typeof cwd === "string" ? { id, cwd } : null;
  } catch {
    return null;
  }
}

async function listCodexSessionIds(cwd: string): Promise<string[]> {
  const root = join(home(), ".codex", "sessions");
  const relPaths = await readdir(root, { recursive: true }).catch((): string[] => []);
  const rollouts = relPaths.filter((rel) => {
    const name = basename(rel);
    return name.startsWith("rollout-") && name.endsWith(".jsonl");
  });
  const stamped = await Promise.all(
    rollouts.map(async (rel): Promise<StampedSession | null> => {
      const path = join(root, rel);
      const meta = await readCodexSessionCwdId(path);
      if (!meta || meta.cwd !== cwd) return null;
      const info = await stat(path).catch(() => null);
      return info ? { sessionId: meta.id, mtimeMs: info.mtimeMs } : null;
    }),
  );
  return newestFirst(stamped.filter((entry): entry is StampedSession => entry !== null));
}

export class FileSessionDiscovery implements SessionDiscoveryGateway {
  async listSessionIds(agent: DiscoverableAgentKind, cwd: string): Promise<string[]> {
    return agent === "claude" ? await listClaudeSessionIds(cwd) : await listCodexSessionIds(cwd);
  }
}

/** Poll for a session id that appears in `cwd` but was not in `before`, returning the
 *  newest such id. Used to learn a freshly-forked session's id when it cannot be pinned
 *  (Codex). Returns null if nothing new shows up within the retry budget. */
export async function captureNewSessionId(
  discovery: SessionDiscoveryGateway,
  agent: DiscoverableAgentKind,
  cwd: string,
  before: string[],
  options: { attempts?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<string | null> {
  const beforeSet = new Set(before);
  const attempts = options.attempts ?? 20;
  const delayMs = options.delayMs ?? 150;
  const sleep = options.sleep ?? ((ms: number) => Bun.sleep(ms));

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const after = await discovery.listSessionIds(agent, cwd);
    const fresh = after.filter((id) => !beforeSet.has(id));
    if (fresh.length > 0) return fresh[0];
    await sleep(delayMs);
  }
  return null;
}
