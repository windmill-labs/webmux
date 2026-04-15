import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { log } from "../lib/log";

export interface ClaudeCliConversationMessage {
  id: string;
  turnId: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string | null;
}

export interface ClaudeCliSession {
  sessionId: string;
  cwd: string;
  path: string;
  gitBranch: string | null;
  createdAt: string | null;
  lastSeenAt: string | null;
  messages: ClaudeCliConversationMessage[];
}

export interface ClaudeCliSessionSummary {
  sessionId: string;
  cwd: string;
  path: string;
  lastSeenAt: string;
}

export interface ClaudeCliRunCallbacks {
  onAssistantDelta?: (delta: string) => void;
  onComplete?: (sessionId: string) => void;
  onError?: (message: string) => void;
  onSessionId?: (sessionId: string) => void;
}

export interface ClaudeCliRunHandle {
  completion: Promise<void>;
  interrupt: () => void;
  sessionId: Promise<string>;
}

export interface ClaudeCliGateway {
  listSessions(cwd: string): Promise<ClaudeCliSessionSummary[]>;
  readSession(sessionId: string, cwd: string): Promise<ClaudeCliSession | null>;
  sendMessage(
    params: {
      cwd: string;
      prompt: string;
      resumeSessionId?: string | null;
    },
    callbacks: ClaudeCliRunCallbacks,
  ): ClaudeCliRunHandle;
}

interface ClaudeStoredRecord {
  cwd?: unknown;
  gitBranch?: unknown;
  message?: unknown;
  sessionId?: unknown;
  timestamp?: unknown;
  type?: unknown;
  uuid?: unknown;
}

interface ClaudeStoredMessage {
  content?: unknown;
  role?: unknown;
  stop_reason?: unknown;
}

interface ClaudeParsedTurn {
  assistant: ClaudeCliConversationMessage | null;
  user: ClaudeCliConversationMessage;
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}

function readString(raw: unknown): string | null {
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

function extractClaudeMessageText(raw: unknown): string {
  if (typeof raw === "string") {
    return raw.trim();
  }

  if (!Array.isArray(raw)) {
    return "";
  }

  return raw
    .map((entry) => {
      if (!isRecord(entry)) return "";
      if (entry.type !== "text") return "";
      return typeof entry.text === "string" ? entry.text : "";
    })
    .join("")
    .trim();
}

function isTopLevelClaudeUserPrompt(raw: ClaudeStoredRecord): raw is ClaudeStoredRecord & {
  message: ClaudeStoredMessage & { content: string; role: "user" };
  type: "user";
  uuid: string;
} {
  if (raw.type !== "user" || !isRecord(raw.message)) return false;
  return raw.message.role === "user"
    && typeof raw.message.content === "string"
    && typeof raw.uuid === "string"
    && raw.message.content.trim().length > 0;
}

function isClaudeAssistantRecord(raw: ClaudeStoredRecord): raw is ClaudeStoredRecord & {
  message: ClaudeStoredMessage & { role: "assistant" };
  type: "assistant";
  uuid: string;
} {
  if (raw.type !== "assistant" || !isRecord(raw.message)) return false;
  return raw.message.role === "assistant" && typeof raw.uuid === "string";
}

export function encodeClaudeProjectDir(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, "-");
}

function readClaudeProjectsRoot(): string {
  const home = Bun.env.HOME;
  if (!home) {
    throw new Error("HOME is required to resolve Claude sessions");
  }

  return join(home, ".claude", "projects");
}

async function listJsonlFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .map((entry) => join(dir, entry.name));
  } catch {
    return [];
  }
}

async function findClaudeSessionPath(sessionId: string, cwd: string): Promise<string | null> {
  const projectsRoot = readClaudeProjectsRoot();
  const primaryPath = join(projectsRoot, encodeClaudeProjectDir(cwd), `${sessionId}.jsonl`);
  try {
    await stat(primaryPath);
    return primaryPath;
  } catch {
    // Fall through to a broader scan.
  }

  const projectDirs = await readdir(projectsRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of projectDirs) {
    if (!entry.isDirectory()) continue;
    const candidate = join(projectsRoot, entry.name, `${sessionId}.jsonl`);
    try {
      await stat(candidate);
      return candidate;
    } catch {
      continue;
    }
  }

  return null;
}

function parseClaudeSessionRecords(text: string): ClaudeStoredRecord[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as ClaudeStoredRecord;
        return [parsed];
      } catch (error) {
        log.warn(`[agents] failed to parse Claude session line: ${line.slice(0, 120)}`);
        return [];
      }
    });
}

export function buildClaudeSessionFromText(
  input: {
    path: string;
    sessionId: string;
    text: string;
  },
): ClaudeCliSession {
  const records = parseClaudeSessionRecords(input.text);
  const turns: ClaudeParsedTurn[] = [];
  let cwd: string | null = null;
  let gitBranch: string | null = null;
  let createdAt: string | null = null;
  let lastSeenAt: string | null = null;
  let currentTurn: ClaudeParsedTurn | null = null;

  for (const record of records) {
    cwd ??= readString(record.cwd);
    gitBranch ??= readString(record.gitBranch);
    if (!createdAt) {
      createdAt = readString(record.timestamp);
    }
    lastSeenAt = readString(record.timestamp) ?? lastSeenAt;

    if (isTopLevelClaudeUserPrompt(record)) {
      if (currentTurn) {
        turns.push(currentTurn);
      }

      currentTurn = {
        user: {
          id: record.uuid,
          turnId: record.uuid,
          role: "user",
          text: record.message.content.trim(),
          createdAt: readString(record.timestamp),
        },
        assistant: null,
      };
      continue;
    }

    if (!currentTurn || !isClaudeAssistantRecord(record)) {
      continue;
    }

    const text = extractClaudeMessageText(record.message.content);
    if (text.length === 0 || record.message.stop_reason !== "end_turn") {
      continue;
    }

    currentTurn.assistant = {
      id: record.uuid,
      turnId: currentTurn.user.turnId,
      role: "assistant",
      text,
      createdAt: readString(record.timestamp),
    };
  }

  if (currentTurn) {
    turns.push(currentTurn);
  }

  return {
    sessionId: input.sessionId,
    cwd: cwd ?? "",
    path: input.path,
    gitBranch,
    createdAt,
    lastSeenAt,
    messages: turns.flatMap((turn) => turn.assistant ? [turn.user, turn.assistant] : [turn.user]),
  };
}

export class ClaudeCliClient implements ClaudeCliGateway {
  async listSessions(cwd: string): Promise<ClaudeCliSessionSummary[]> {
    const projectsRoot = readClaudeProjectsRoot();
    const primaryDir = join(projectsRoot, encodeClaudeProjectDir(cwd));
    const primaryFiles = await listJsonlFiles(primaryDir);
    if (primaryFiles.length > 0) {
      return await this.summarizeSessionFiles(primaryFiles, cwd);
    }

    const projectDirs = await readdir(projectsRoot, { withFileTypes: true }).catch(() => []);
    const matchedFiles: string[] = [];
    for (const entry of projectDirs) {
      if (!entry.isDirectory()) continue;
      const files = await listJsonlFiles(join(projectsRoot, entry.name));
      for (const filePath of files) {
        const session = await this.readSessionFile(filePath);
        if (session?.cwd === cwd) {
          matchedFiles.push(filePath);
        }
      }
    }

    return await this.summarizeSessionFiles(matchedFiles, cwd);
  }

  async readSession(sessionId: string, cwd: string): Promise<ClaudeCliSession | null> {
    const filePath = await findClaudeSessionPath(sessionId, cwd);
    if (!filePath) return null;
    return await this.readSessionFile(filePath);
  }

  sendMessage(
    params: {
      cwd: string;
      prompt: string;
      resumeSessionId?: string | null;
    },
    callbacks: ClaudeCliRunCallbacks,
  ): ClaudeCliRunHandle {
    const args = ["claude", "-p", "--verbose", "--output-format", "stream-json", "--include-partial-messages"];
    if (params.resumeSessionId) {
      args.push("-r", params.resumeSessionId);
    }

    const proc = Bun.spawn(args, {
      cwd: params.cwd,
      env: Bun.env,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    let resolvedSessionId: string | null = null;
    let sessionIdResolve: ((value: string) => void) | null = null;
    let sessionIdReject: ((reason?: unknown) => void) | null = null;
    let interrupted = false;
    const sessionId = new Promise<string>((resolve, reject) => {
      sessionIdResolve = resolve;
      sessionIdReject = reject;
    });

    const resolveSessionId = (value: string): void => {
      if (resolvedSessionId === value) return;
      resolvedSessionId = value;
      sessionIdResolve?.(value);
      sessionIdResolve = null;
      sessionIdReject = null;
      callbacks.onSessionId?.(value);
    };

    const rejectSessionId = (error: Error): void => {
      sessionIdReject?.(error);
      sessionIdResolve = null;
      sessionIdReject = null;
    };

    const completion = (async () => {
      const stdoutReader = proc.stdout.getReader();
      const stderrReader = proc.stderr.getReader();
      let stdoutBuffer = "";
      let stderrBuffer = "";

      const stdoutLoop = (async () => {
        while (true) {
          const { done, value } = await stdoutReader.read();
          if (done) break;
          stdoutBuffer += decoder.decode(value);

          while (true) {
            const newlineIndex = stdoutBuffer.indexOf("\n");
            if (newlineIndex === -1) break;
            const line = stdoutBuffer.slice(0, newlineIndex).trim();
            stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
            if (line.length === 0) continue;
            this.handleStreamLine(line, callbacks, resolveSessionId);
          }
        }
      })();

      const stderrLoop = (async () => {
        while (true) {
          const { done, value } = await stderrReader.read();
          if (done) break;
          stderrBuffer += decoder.decode(value);
        }
      })();

      await Promise.all([stdoutLoop, stderrLoop]);
      const exitCode = await proc.exited;

      if (exitCode !== 0 && !interrupted) {
        const message = stderrBuffer.trim() || `claude exited with code ${exitCode}`;
        rejectSessionId(new Error(message));
        callbacks.onError?.(message);
      }
    })();

    void proc.stdin.write(encoder.encode(params.prompt.endsWith("\n") ? params.prompt : `${params.prompt}\n`));
    proc.stdin.end();

    return {
      completion,
      interrupt: () => {
        interrupted = true;
        proc.kill();
      },
      sessionId,
    };
  }

  private async summarizeSessionFiles(filePaths: string[], cwd: string): Promise<ClaudeCliSessionSummary[]> {
    const items = await Promise.all(filePaths.map(async (filePath) => {
      const info = await stat(filePath).catch(() => null);
      if (!info) return null;
      return {
        sessionId: basename(filePath, ".jsonl"),
        cwd,
        path: filePath,
        lastSeenAt: info.mtime.toISOString(),
      };
    }));

    return items
      .filter((item): item is ClaudeCliSessionSummary => item !== null)
      .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt));
  }

  private async readSessionFile(filePath: string): Promise<ClaudeCliSession | null> {
    try {
      const text = await Bun.file(filePath).text();
      return buildClaudeSessionFromText({
        path: filePath,
        sessionId: basename(filePath, ".jsonl"),
        text,
      });
    } catch {
      return null;
    }
  }

  private handleStreamLine(
    line: string,
    callbacks: ClaudeCliRunCallbacks,
    resolveSessionId: (value: string) => void,
  ): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      log.warn(`[agents] failed to parse Claude stream line: ${line.slice(0, 120)}`);
      return;
    }

    if (!isRecord(parsed)) return;

    const sessionId = readString(parsed.session_id);
    if (sessionId) {
      resolveSessionId(sessionId);
    }

    if (parsed.type === "stream_event" && isRecord(parsed.event)) {
      const event = parsed.event;
      if (event.type === "content_block_delta" && isRecord(event.delta) && event.delta.type === "text_delta") {
        const delta = readString(event.delta.text);
        if (delta) {
          callbacks.onAssistantDelta?.(delta);
        }
      }
      return;
    }

    if (parsed.type === "result") {
      const resultSessionId = readString(parsed.session_id);
      if (resultSessionId) {
        resolveSessionId(resultSessionId);
        callbacks.onComplete?.(resultSessionId);
      }

      if (parsed.is_error === true) {
        callbacks.onError?.(readString(parsed.result) ?? "Claude returned an error");
      }
      return;
    }

    if (parsed.type === "error") {
      callbacks.onError?.(readString(parsed.message) ?? "Claude returned an error");
    }
  }
}
