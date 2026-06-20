import * as p from "@clack/prompts";
import { apiPaths, AgentsUiConversationEventSchema, createApi, parseLinearTarget, type AgentsUiConversationMessage, type AgentsUiConversationEvent, type AgentsUiWorktreeConversationResponse, type CreateWorktreeRequest, type PostWorktreeToLinearTarget, type ProjectWorktreeSnapshot } from "@webmux/api-contract";
import { createLinearIssue, fetchTeamByKey, type LinearIssue } from "../../backend/src/services/linear-service";
import { buildSeedFromLinear, defaultSeedFromLinearDeps } from "../../backend/src/services/conversation-export-service";
import { findDuplicateLinearIssue, polishLinearIssueTitle } from "../../backend/src/services/linear-title-service";
import { CommandUsageError, formatServerError } from "./shared";

export interface ParsedOneshotCommand {
  branch: string | null;
  prompt: string | null;
  resume: boolean;
  body: CreateWorktreeRequest;
  keepOpen: boolean;
  fromLinearIssueId: string | null;
  postToLinearTarget: PostWorktreeToLinearTarget | null;
}

export function getOneshotUsage(): string {
  return [
    "Usage:",
    "  webmux oneshot [branch] --prompt <text> [--agent <id>] [--base <branch>] [--profile <name>]",
    "                          [--env KEY=VALUE]... [--keep-open] [--linear <issue-id|team-key>]",
    "  webmux oneshot --resume <branch> --prompt <text>",
    "",
    "Runs an agent worktree start-to-finish, streaming the conversation to stdout.",
    "Does not change the focused tmux session. The server-side oneshot watcher",
    "closes the worktree session (and posts the conversation back to Linear, if",
    "--linear is set) once the agent finishes — even if this CLI is killed mid-run.",
    "Opening the worktree in the browser and interacting with it disarms the watcher.",
    "",
    "Exit codes: 0 if the agent opened a PR / the user took over via the browser;",
    "1 if the agent went idle without opening a PR; 130 on Ctrl-C (worktree keeps",
    "running, resume with `webmux oneshot --resume <branch>`).",
    "",
    "Options:",
    "  --resume <branch>        Resume an existing local worktree instead of creating one",
    "  --prompt <text>          Initial agent prompt (required; follow-up nudge when --resume)",
    "  --agent <id>             Agent id to launch",
    "  --base <branch>          Base branch for a new worktree (defaults to config)",
    "  --profile <name>         Worktree profile from .webmux.yaml",
    "  --env KEY=VALUE          Runtime env override (repeatable)",
    "  --keep-open              Don't auto-close the worktree session when the agent finishes",
    "  --linear ID|TEAM         Tie this oneshot to Linear:",
    "                             ENG-123  — load the issue body as context, post results back",
    "                             ENG      — create a new issue in that team when done.",
    "                                        When autoName is configured, the title is polished",
    "                                        and likely duplicates are surfaced before creation.",
    "  --branch <name>          Override the branch when --linear resolves to one",
    "  --help                   Show this help message",
  ].join("\n");
}

function readOptionValue(args: string[], index: number, flag: string): {
  value: string;
  nextIndex: number;
} {
  const arg = args[index];
  if (!arg) throw new CommandUsageError(`${flag} requires a value`);
  const prefix = `${flag}=`;
  if (arg.startsWith(prefix)) return { value: arg.slice(prefix.length), nextIndex: index };
  const value = args[index + 1];
  if (value === undefined) throw new CommandUsageError(`${flag} requires a value`);
  return { value, nextIndex: index + 1 };
}

export function parseOneshotArgs(args: string[]): ParsedOneshotCommand | null {
  const body: CreateWorktreeRequest = {};
  const envOverrides: Record<string, string> = {};
  let branch: string | null = null;
  let branchFlagUsed = false;
  let prompt: string | null = null;
  let resume = false;
  let resumeBranch: string | null = null;
  let keepOpen = false;
  let fromLinearIssueId: string | null = null;
  let postToLinearTarget: PostWorktreeToLinearTarget | null = null;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg) continue;

    if (arg === "--help" || arg === "-h") return null;

    if (arg === "--resume" || arg.startsWith("--resume=")) {
      const { value, nextIndex } = readOptionValue(args, index, "--resume");
      resume = true;
      resumeBranch = value.trim();
      index = nextIndex;
      continue;
    }

    if (arg === "--prompt" || arg.startsWith("--prompt=")) {
      const { value, nextIndex } = readOptionValue(args, index, "--prompt");
      prompt = value;
      index = nextIndex;
      continue;
    }

    if (arg === "--agent" || arg.startsWith("--agent=")) {
      const { value, nextIndex } = readOptionValue(args, index, "--agent");
      body.agent = value.trim();
      index = nextIndex;
      continue;
    }

    if (arg === "--base" || arg.startsWith("--base=")) {
      const { value, nextIndex } = readOptionValue(args, index, "--base");
      body.baseBranch = value;
      index = nextIndex;
      continue;
    }

    if (arg === "--profile" || arg.startsWith("--profile=")) {
      const { value, nextIndex } = readOptionValue(args, index, "--profile");
      body.profile = value;
      index = nextIndex;
      continue;
    }

    if (arg === "--env" || arg.startsWith("--env=")) {
      const { value, nextIndex } = readOptionValue(args, index, "--env");
      const sep = value.indexOf("=");
      if (sep <= 0) throw new CommandUsageError("--env must use KEY=VALUE");
      envOverrides[value.slice(0, sep)] = value.slice(sep + 1);
      index = nextIndex;
      continue;
    }

    if (arg === "--keep-open") {
      keepOpen = true;
      continue;
    }

    if (arg === "--linear" || arg.startsWith("--linear=")) {
      const { value, nextIndex } = readOptionValue(args, index, "--linear");
      const target = parseLinearTarget(value);
      if (target.kind === "issue") {
        // Issue id → round-trip: load context AND post back to the same issue.
        fromLinearIssueId = target.issueId;
        postToLinearTarget = { kind: "issue", issueId: target.issueId };
      } else if (target.kind === "team") {
        // Team key → post a new issue in that team when done; no seed.
        postToLinearTarget = { kind: "team", teamKey: target.teamKey };
      } else {
        throw new CommandUsageError(
          `--linear expects either an issue id (ENG-123) or a team key (ENG); got "${target.raw}"`,
        );
      }
      index = nextIndex;
      continue;
    }

    if (arg === "--branch" || arg.startsWith("--branch=")) {
      const { value, nextIndex } = readOptionValue(args, index, "--branch");
      if (branch && branch !== value) {
        throw new CommandUsageError(`Conflicting branch values: "${branch}" and "${value}"`);
      }
      branch = value.trim();
      branchFlagUsed = true;
      index = nextIndex;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new CommandUsageError(`Unknown option: ${arg}`);
    }

    if (branch) {
      throw new CommandUsageError(`Unexpected argument: ${arg}`);
    }

    branch = arg;
  }

  if (resume) {
    if (fromLinearIssueId) {
      throw new CommandUsageError("Cannot use --resume with --linear <issue-id>");
    }
    if (branchFlagUsed) {
      throw new CommandUsageError("Cannot use --branch with --resume; --resume already names the branch");
    }
    if (!resumeBranch) throw new CommandUsageError("--resume requires a branch name");
    if (branch && branch !== resumeBranch) {
      throw new CommandUsageError("Cannot pass both a positional branch and --resume");
    }
    // Resuming without a follow-up prompt is broken for Claude: `claude --continue`
    // never fires UserPromptSubmit, so lifecycle stays "closed" and the CLI just
    // times out at 60s. Codex works because `codex resume --last` fires SessionStart
    // unconditionally, but cross-agent parity wins here. Use the dashboard to
    // re-attach an existing session without nudging the agent.
    if (!prompt) {
      throw new CommandUsageError("--resume requires --prompt; use the dashboard to re-attach without re-prompting");
    }
    branch = resumeBranch;
  }

  if (branchFlagUsed && !fromLinearIssueId) {
    throw new CommandUsageError("--branch only applies with --linear; pass the branch as a positional argument otherwise");
  }

  if (!resume && !fromLinearIssueId && !prompt) {
    throw new CommandUsageError("oneshot requires --prompt (or use --linear)");
  }

  if (branch) body.branch = branch;
  if (prompt) body.prompt = prompt;
  if (Object.keys(envOverrides).length > 0) body.envOverrides = envOverrides;

  return {
    branch,
    prompt,
    resume,
    body,
    keepOpen,
    fromLinearIssueId,
    postToLinearTarget,
  };
}

interface ConversationPrintState {
  printedMessageIds: Set<string>;
  streamingItemId: string | null;
  streamingText: string;
  streamingTurnId: string | null;
  streamingNeedsHeader: boolean;
  lastStreamRevision: number;
}

function timestamp(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function formatLogLine(role: string, text: string): string {
  return `[${timestamp()}] [${role}] ${text}`;
}

// Per-tool key to surface in the compact one-liner (e.g., Bash → command,
// Read → file_path). Tools not listed fall back to a generic summary.
const TOOL_PRIMARY_KEY: Record<string, string[]> = {
  bash: ["command"],
  bashoutput: ["bash_id"],
  killshell: ["shell_id"],
  read: ["file_path"],
  edit: ["file_path"],
  multiedit: ["file_path"],
  write: ["file_path"],
  notebookedit: ["notebook_path"],
  glob: ["pattern"],
  grep: ["pattern"],
  webfetch: ["url"],
  websearch: ["query"],
  task: ["description", "subagent_type"],
  exitplanmode: ["plan"],
};

function truncateInline(text: string, limit: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= limit) return collapsed;
  return `${collapsed.slice(0, limit)}…`;
}

function summarizeToolInput(toolName: string, jsonText: string): string {
  let input: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(jsonText);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      input = parsed as Record<string, unknown>;
    }
  } catch {
    return truncateInline(jsonText, 100);
  }
  if (!input) return truncateInline(jsonText, 100);

  if (toolName.toLowerCase() === "askuserquestion" && Array.isArray(input.questions)) {
    const headers: string[] = [];
    for (const question of input.questions) {
      if (question && typeof question === "object" && !Array.isArray(question)) {
        const header = (question as Record<string, unknown>).header;
        if (typeof header === "string") headers.push(header);
      }
    }
    if (headers.length > 0) return truncateInline(headers.join(", "), 120);
  }

  const keys = TOOL_PRIMARY_KEY[toolName.toLowerCase()];
  if (keys) {
    const values: string[] = [];
    for (const key of keys) {
      const v = input[key];
      if (typeof v === "string" && v.length > 0) values.push(v);
    }
    if (values.length > 0) return truncateInline(values.join(" "), 120);
  }

  // Generic fallback: surface short string fields as key=value pairs.
  const parts: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string") parts.push(`${key}=${truncateInline(value, 40)}`);
  }
  if (parts.length === 0) return "";
  return truncateInline(parts.join(" "), 120);
}

function summarizeToolResult(text: string): string {
  const lines = text.split("\n").map((l) => l.trimEnd()).filter((l) => l.length > 0);
  if (lines.length === 0) return "(empty)";
  const first = truncateInline(lines[0]!, 200);
  return lines.length > 1 ? `${first} (+${lines.length - 1} lines)` : first;
}

function formatConversationLine(message: AgentsUiConversationMessage): string {
  const kind = message.kind ?? "text";
  if (kind === "toolUse") {
    const tool = message.toolName ?? "tool";
    const summary = summarizeToolInput(tool, message.text);
    return `[${timestamp()}] ● ${tool}(${summary})`;
  }
  if (kind === "toolResult") {
    return `[${timestamp()}]   ⎿ ${summarizeToolResult(message.text)}`;
  }
  return formatLogLine(message.role, message.text);
}

function flushStreamingLine(state: ConversationPrintState): void {
  if (state.streamingItemId !== null) {
    process.stdout.write("\n");
    state.streamingItemId = null;
    state.streamingText = "";
    state.streamingTurnId = null;
    state.streamingNeedsHeader = false;
  }
}

function messageKind(message: AgentsUiConversationMessage): NonNullable<AgentsUiConversationMessage["kind"]> {
  return message.kind ?? "text";
}

function isSameStreamingMessage(
  state: ConversationPrintState,
  message: AgentsUiConversationMessage,
): boolean {
  if (state.streamingItemId === null) return false;
  if (state.streamingItemId === message.id) return true;
  if (message.role !== "assistant" || messageKind(message) !== "text") return false;
  if (state.streamingText.length === 0) return false;
  return message.turnId === state.streamingTurnId
    && (state.streamingText.startsWith(message.text) || message.text.startsWith(state.streamingText));
}

function printNewMessages(
  state: ConversationPrintState,
  messages: AgentsUiConversationMessage[],
): void {
  for (const message of messages) {
    if (state.printedMessageIds.has(message.id)) continue;
    if (isSameStreamingMessage(state, message)) {
      // Streaming has been printing this incrementally; mark printed and finish line if completed.
      state.printedMessageIds.add(message.id);
      if (message.status === "completed") flushStreamingLine(state);
      continue;
    }
    flushStreamingLine(state);
    if (message.text.trim().length === 0) {
      state.printedMessageIds.add(message.id);
      continue;
    }
    process.stdout.write(`${formatConversationLine(message)}\n`);
    state.printedMessageIds.add(message.id);
  }
}

function handleConversationEvent(
  event: AgentsUiConversationEvent,
  state: ConversationPrintState,
  stderr: (line: string) => void,
): void {
  if (event.type === "messageDelta") {
    if (event.revision <= state.lastStreamRevision) return;
    state.lastStreamRevision = event.revision;
    if (state.streamingItemId !== event.itemId) {
      flushStreamingLine(state);
      state.streamingItemId = event.itemId;
      state.streamingText = "";
      state.streamingTurnId = event.turnId;
      state.streamingNeedsHeader = true;
    }
    if (state.streamingNeedsHeader) {
      process.stdout.write(`[${timestamp()}] [assistant] `);
      state.streamingNeedsHeader = false;
    }
    process.stdout.write(event.delta);
    state.streamingText += event.delta;
    return;
  }
  if (event.type === "messageUpsert") {
    if (event.revision <= state.lastStreamRevision) return;
    state.lastStreamRevision = event.revision;
    printNewMessages(state, [event.message]);
    return;
  }
  if (event.type === "conversationStatus") {
    if (event.revision <= state.lastStreamRevision) return;
    state.lastStreamRevision = event.revision;
    if (!event.running) flushStreamingLine(state);
    return;
  }
  if (event.type === "error") {
    flushStreamingLine(state);
    stderr(`[${timestamp()}] [error] ${event.message}`);
    return;
  }
}

// Cap reconnects so a permanently-down server can't leave the CLI hanging
// silently. We reset the counter on every successful `open` — only consecutive
// failed attempts (no `open` in between) count toward the limit. 30 × 2s
// gives ~1min to ride out normal restarts (deploy, bun --hot, sleep/wake).
const MAX_CONSECUTIVE_RECONNECTS = 30;
// Surface a stderr warning early so a long-running disconnect isn't silent,
// then again midway so the user has signal during the silent window before fatal.
const RECONNECT_WARN_AT: readonly [number, number] = [3, 15];

function streamConversation(
  branch: string,
  port: number,
  state: ConversationPrintState,
  stderr: (line: string) => void,
  onFatal: (reason: string) => void,
): { close: () => void } {
  let closed = false;
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let consecutiveFailures = 0;

  const connect = (): void => {
    if (closed) return;
    const url = `ws://localhost:${port}${apiPaths.streamAgentsWorktreeConversation.replace(":name", encodeURIComponent(branch))}`;
    const ws = new WebSocket(url);
    socket = ws;
    ws.addEventListener("open", () => {
      consecutiveFailures = 0;
      state.lastStreamRevision = 0;
    });
    ws.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      try {
        const parsed = AgentsUiConversationEventSchema.parse(JSON.parse(event.data));
        handleConversationEvent(parsed, state, stderr);
      } catch {
        stderr(`[${timestamp()}] [error] received malformed conversation stream data`);
      }
    });
    ws.addEventListener("close", () => {
      socket = null;
      if (closed) return;
      consecutiveFailures += 1;
      if (RECONNECT_WARN_AT.includes(consecutiveFailures)) {
        stderr(`[${timestamp()}] [warn] webmux server unreachable, retrying (${consecutiveFailures}/${MAX_CONSECUTIVE_RECONNECTS})`);
      }
      if (consecutiveFailures >= MAX_CONSECUTIVE_RECONNECTS) {
        closed = true;
        onFatal(`webmux server unreachable after ${consecutiveFailures} reconnect attempts`);
        return;
      }
      reconnectTimer = setTimeout(connect, 2000);
    });
    ws.addEventListener("error", () => {
      // Close handler will trigger reconnect.
    });
  };

  connect();

  return {
    close: () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        socket.close();
      }
    },
  };
}

interface PollState {
  seenPrUrls: Set<string>;
  seenMergedUrls: Set<string>;
  hadOpenSession: boolean;
  consecutiveClosedReadings: number;
  idleSinceMs: number | null;
  /** True once we observed `oneshot` armed on the snapshot. Used to detect the
   *  disarm transition (snapshot.oneshot goes from set → null) that signals the
   *  human took over from the browser. */
  watcherWasArmed: boolean;
}

// `idle` can be transient (agent is between tool calls), so wait a beat before
// declaring the run done. `stopped`/`error` are terminal and don't get a grace.
const IDLE_GRACE_MS = 15_000;

function recordPrEvents(
  state: PollState,
  worktree: ProjectWorktreeSnapshot,
  onPrEvent: (line: string) => void,
): void {
  for (const pr of worktree.prs) {
    if (!state.seenPrUrls.has(pr.url)) {
      state.seenPrUrls.add(pr.url);
      onPrEvent(`PR #${pr.number} opened: ${pr.url}`);
    }
    if (pr.state === "merged" && !state.seenMergedUrls.has(pr.url)) {
      state.seenMergedUrls.add(pr.url);
      onPrEvent(`PR #${pr.number} merged: ${pr.url}`);
    }
  }
}

function pollProjectState(
  branch: string,
  port: number,
  state: PollState,
  callbacks: {
    onSessionClosed: () => void;
    onWorktreeRemoved: () => void;
    onPrEvent: (line: string) => void;
    onAgentStuck: (reason: string) => void;
    onAgentDone: (reason: string) => void;
    onUserTookOver: () => void;
  },
  stderr: (line: string) => void,
): { stop: () => void } {
  const api = createApi(`http://localhost:${port}`);
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const forcePrSync = async (): Promise<void> => {
    try {
      const refreshed = await api.syncWorktreePrs({ params: { name: branch } });
      recordPrEvents(state, refreshed, callbacks.onPrEvent);
    } catch (err: unknown) {
      // Surface the cause: a silent swallow would let us mis-classify the run
      // as "agent stuck without opening a PR" when the real issue was that
      // syncWorktreePrs couldn't reach the server.
      const msg = err instanceof Error ? err.message : String(err);
      stderr(`[${timestamp()}] [warn] failed to sync PRs from server: ${msg}`);
    }
  };

  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      const response = await api.fetchWorktrees();
      const worktree = response.worktrees.find((w: ProjectWorktreeSnapshot) => w.branch === branch);
      if (!worktree) {
        if (state.hadOpenSession) {
          callbacks.onWorktreeRemoved();
          return;
        }
      } else {
        if (worktree.mux) {
          state.hadOpenSession = true;
          state.consecutiveClosedReadings = 0;
        }
        recordPrEvents(state, worktree, callbacks.onPrEvent);
        // Track the watcher's arm/disarm transition. Disarm + still-running mux
        // means the human took over via the browser; disarm + closed mux means
        // the watcher itself fired close/post — let the onSessionClosed path
        // handle it so we don't print a misleading "user took over" message.
        if (worktree.oneshot) {
          state.watcherWasArmed = true;
        } else if (state.watcherWasArmed && worktree.mux) {
          callbacks.onUserTookOver();
          return;
        }
        // A single mux=false reading can be a transient tmux/server hiccup;
        // require two consecutive readings before declaring the session closed.
        // With the 3s poll cadence this adds ~3-6s lag between the watcher
        // closing the session and the CLI exiting — small price for not
        // emitting spurious "session closed" events on reconcile gaps.
        if (state.hadOpenSession && !worktree.mux) {
          state.consecutiveClosedReadings += 1;
          if (state.consecutiveClosedReadings >= 2) {
            callbacks.onSessionClosed();
            return;
          }
        }
        const status = worktree.status;
        // The agent's job is over once it goes idle/stopped/error. Exit
        // success if a PR was opened, failure otherwise.
        const isTerminal = status === "stopped" || status === "error";
        const isIdle = status === "idle";
        if (isTerminal || isIdle) {
          if (state.idleSinceMs === null) state.idleSinceMs = Date.now();
          const isStable = isTerminal || (Date.now() - state.idleSinceMs >= IDLE_GRACE_MS);
          if (isStable) {
            // Force one PR sync to catch a PR the agent may have just opened.
            await forcePrSync();
            if (state.seenPrUrls.size > 0) {
              callbacks.onAgentDone(`agent ${status} after opening PR`);
            } else {
              callbacks.onAgentStuck(`agent ${status} without opening a PR`);
            }
            return;
          }
        } else {
          state.idleSinceMs = null;
        }
      }
    } catch {
      // Server may be momentarily unreachable; retry next tick.
    }
    timer = setTimeout(tick, 3000);
  };

  void tick();

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

async function ensureWorktreeReady(
  branch: string,
  port: number,
  stderr: (line: string) => void,
): Promise<{ ready: true; worktree: ProjectWorktreeSnapshot } | { ready: false }> {
  const api = createApi(`http://localhost:${port}`);
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await api.fetchWorktrees();
      const worktree = response.worktrees.find((w: ProjectWorktreeSnapshot) => w.branch === branch);
      // `closed` is the default lifecycle for a freshly upserted worktree before
      // the agent's first event arrives — don't return ready in that window or
      // the watcher (also driven by `closed`) and our own poller could race on
      // a cold-start session.
      if (
        worktree &&
        worktree.mux &&
        worktree.status !== "creating" &&
        worktree.status !== "closed"
      ) {
        return { ready: true, worktree };
      }
    } catch {
      // ignore
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  stderr(`[${timestamp()}] [error] timed out waiting for ${branch} session to start`);
  return { ready: false };
}

function printConversationHistory(
  initial: AgentsUiWorktreeConversationResponse,
  state: ConversationPrintState,
): void {
  printNewMessages(state, initial.conversation.messages);
}

/**
 * Polls `fetchAgentsWorktreeConversationHistory` on an interval and feeds new
 * messages through the same `printNewMessages` path the WS uses. Claude uses
 * this only as a fallback for terminal-routed runs that cannot publish live WS
 * deltas.
 */
function pollConversationHistory(
  branch: string,
  port: number,
  state: ConversationPrintState,
): { stop: () => void } {
  const api = createApi(`http://localhost:${port}`);
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      const response = await api.fetchAgentsWorktreeConversationHistory({ params: { name: branch } });
      printNewMessages(state, response.conversation.messages);
    } catch {
      // History may briefly 4xx during initialization — keep polling.
    }
    if (!stopped) timer = setTimeout(tick, 2000);
  };

  void tick();

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

type DuplicateChoice = "use_existing" | "create_new" | "cancel";

async function promptDuplicateChoice(
  candidate: LinearIssue,
  polishedTitle: string,
): Promise<DuplicateChoice> {
  if (!process.stdin.isTTY) {
    process.stderr.write(
      `[${timestamp()}] [warn] non-interactive shell; ignoring possible duplicate ${candidate.identifier}: "${candidate.title}" (${candidate.url})\n`,
    );
    return "create_new";
  }
  p.note(
    `${candidate.identifier}: ${candidate.title}\n${candidate.url}`,
    "Possible existing match",
  );
  const choice = await p.select<DuplicateChoice>({
    message: "Found a possible existing match. What should webmux do?",
    initialValue: "use_existing",
    options: [
      {
        value: "use_existing",
        label: `Use existing (${candidate.identifier})`,
        hint: "Treat this oneshot as resuming the existing issue",
      },
      {
        value: "create_new",
        label: "Create new issue",
        hint: `Title: "${polishedTitle}"`,
      },
      {
        value: "cancel",
        label: "Cancel",
        hint: "Don't start the oneshot",
      },
    ],
  });
  if (p.isCancel(choice)) return "cancel";
  return choice;
}

export async function runOneshot(parsed: ParsedOneshotCommand, port: number): Promise<number> {
  const stdout = (line: string): void => {
    process.stdout.write(`${line}\n`);
  };
  const stderr = (line: string): void => {
    process.stderr.write(`${line}\n`);
  };

  const api = createApi(`http://localhost:${port}`);
  let branch = parsed.branch;
  const body: CreateWorktreeRequest = { ...parsed.body };
  let fromLinearIssueId = parsed.fromLinearIssueId;
  let postToLinearTarget = parsed.postToLinearTarget;

  try {
    // Preflight: the final `postWorktreeToLinear` call runs on the server, so
    // the server's LINEAR_API_KEY must be set. Without this check, the user
    // could run for hours before discovering the post-back will fail. We fold
    // this availability check into the autoName fetch since both gate the same
    // --linear flow and the combined endpoint avoids a second round-trip.
    let autoName: Awaited<ReturnType<typeof api.fetchAutoNameConfig>>["autoName"] = null;
    if (postToLinearTarget) {
      const projectAutoName = await api.fetchAutoNameConfig();
      if (projectAutoName.linearAvailability === "missing_api_key") {
        stderr(`[${timestamp()}] [error] server has no LINEAR_API_KEY — the post-back to Linear at the end of the run will fail. Set the env var on the webmux server and restart it.`);
        return 1;
      }
      if (projectAutoName.linearAvailability === "disabled") {
        stderr(`[${timestamp()}] [error] Linear integration is disabled on the webmux server.`);
        return 1;
      }
      autoName = projectAutoName.autoName;
    }

    // Resolve Linear in-process (using LINEAR_API_KEY from the CLI shell's env)
    // to stay consistent with `webmux add --from-linear`. The server still
    // accepts a `fromLinear.issueId` payload — it just doesn't need to re-fetch
    // because we pass the resolved branch + conversationContext explicitly.
    if (postToLinearTarget?.kind === "team") {
      if (!parsed.prompt) {
        stderr(`[${timestamp()}] [error] --linear ${postToLinearTarget.teamKey} requires --prompt to derive an issue title`);
        return 1;
      }

      const polished = await polishLinearIssueTitle({ prompt: parsed.prompt, autoName });
      if (!polished) {
        stderr(`[${timestamp()}] [error] could not derive a title from --prompt`);
        return 1;
      }
      if (polished.source === "llm") {
        stdout(`[${timestamp()}] [event] polished title: "${polished.title}"`);
      }

      if (parsed.resume) {
        // The resumed worktree has no Linear issue of its own (we'd have routed
        // through the issue-id path otherwise), so we're tracking this run as a
        // fresh issue. Make that explicit — the title comes from --prompt, not
        // from whatever the resumed session was originally about.
        stdout(`[${timestamp()}] [event] no Linear issue for this resume; creating a fresh ${postToLinearTarget.teamKey}-N for the post-back`);
      }

      const team = await fetchTeamByKey(postToLinearTarget.teamKey);
      if (!team.ok) {
        stderr(`[${timestamp()}] [error] Linear team lookup failed: ${team.error}`);
        return 1;
      }

      // Dedup check: only meaningful when an autoName LLM is available — the
      // LLM is what filters keyword candidates down to actual semantic matches.
      let duplicate: LinearIssue | null = null;
      if (autoName) {
        duplicate = await findDuplicateLinearIssue({
          polishedTitle: polished.title,
          prompt: parsed.prompt,
          teamId: team.data.id,
          autoName,
        });
      }

      if (duplicate) {
        const choice = await promptDuplicateChoice(duplicate, polished.title);
        if (choice === "cancel") {
          stdout(`[${timestamp()}] [event] cancelled by user`);
          return 0;
        }
        if (choice === "use_existing") {
          stdout(`[${timestamp()}] [event] using existing Linear issue ${duplicate.identifier} → ${duplicate.url}`);
          fromLinearIssueId = duplicate.identifier;
          postToLinearTarget = { kind: "issue", issueId: duplicate.identifier };
        } else {
          stdout(`[${timestamp()}] [event] user chose to create a new issue despite candidate ${duplicate.identifier}`);
        }
      }

      // If we didn't switch to an existing issue, create a new one.
      if (postToLinearTarget.kind === "team") {
        stdout(`[${timestamp()}] [event] creating Linear issue in team ${postToLinearTarget.teamKey}...`);
        const created = await createLinearIssue({
          teamId: team.data.id,
          title: polished.title,
          description: "",
        });
        if (!created.ok) {
          stderr(`[${timestamp()}] [error] Linear issue creation failed: ${created.error}`);
          return 1;
        }
        stdout(`[${timestamp()}] [event] created Linear issue ${created.data.identifier} → ${created.data.url}`);
        fromLinearIssueId = created.data.identifier;
        postToLinearTarget = { kind: "issue", issueId: created.data.identifier };
      }
    }

    if (fromLinearIssueId) {
      stdout(`[${timestamp()}] [event] resolving Linear issue ${fromLinearIssueId}...`);
      const seedResult = await buildSeedFromLinear({ issueId: fromLinearIssueId }, defaultSeedFromLinearDeps);
      if (!seedResult.ok) {
        stderr(`[${timestamp()}] [error] Linear seed lookup failed: ${seedResult.error}`);
        return 1;
      }
      const seed = seedResult.data;
      stdout(`[${timestamp()}] [event] seed source: ${seed.source}${seed.branch ? ` branch=${seed.branch}` : ""}${seed.prUrl ? ` pr=${seed.prUrl}` : ""}`);

      const resolvedBranch = branch ?? seed.branch ?? null;
      if (!resolvedBranch) {
        stderr(`[${timestamp()}] [error] Linear issue did not resolve to a branch; pass --branch to override.`);
        return 1;
      }
      branch = resolvedBranch;
      body.branch = resolvedBranch;
      // Use "existing" mode when the seed pointed to an existing branch (webmux session or open PR).
      if (seed.source !== "none") body.mode = "existing";
      body.fromLinear = {
        issueId: fromLinearIssueId,
        ...(seed.conversationMarkdown ? { conversationContext: seed.conversationMarkdown } : {}),
      };
    }

    // If a worktree already exists for this branch (e.g. resuming the same
    // Linear issue), open it and send the prompt as a follow-up. Claude's
    // --continue keeps the existing JSONL session, so we deliberately skip
    // the Linear conversation seed — the agent already has that history in
    // its own session and re-injecting it would just duplicate content.
    const existingWorktree = branch
      ? (await api.fetchWorktrees()).worktrees.find((w) => w.branch === branch)
      : undefined;

    // Hand the server the close+post responsibilities so the run can finish
    // safely even if this CLI is killed. The watcher disarms itself the moment
    // a user interacts with the session in the browser.
    const oneshotConfig = {
      autoCloseOnDone: !parsed.keepOpen,
      ...(postToLinearTarget ? { postToLinearOnDone: postToLinearTarget } : {}),
    };

    if (parsed.resume || existingWorktree) {
      if (!branch) throw new Error("resume requires a branch name");
      const reason = parsed.resume ? "resuming" : `worktree exists, resuming ${branch}`;
      stdout(`[${timestamp()}] [event] ${reason}`);
      if (fromLinearIssueId) {
        stdout(`[${timestamp()}] [event] skipping Linear seed — agent's existing session history already covers it`);
      }
      // Pass the prompt directly to the agent's CLI (`claude --continue
      // <prompt>` / `codex resume --last -- <prompt>`) so it's processed
      // before the TUI starts. Avoids the paste/Enter race against Claude's
      // input loop.
      await api.openWorktree({
        params: { name: branch },
        body: {
          ...(parsed.prompt ? { prompt: parsed.prompt } : {}),
          oneshot: oneshotConfig,
        },
      });
      if (parsed.prompt) stdout(`[${timestamp()}] [event] sent prompt`);
    } else {
      stdout(`[${timestamp()}] [event] creating worktree${branch ? ` ${branch}` : ""}...`);
      const result = await api.createWorktree({
        body: { ...body, source: "oneshot", oneshot: oneshotConfig },
      });
      branch = result.primaryBranch;
      stdout(`[${timestamp()}] [event] created ${branch}`);
    }
  } catch (error) {
    stderr(`[${timestamp()}] [error] ${formatServerError(error, port)}`);
    return 1;
  }

  if (!branch) {
    stderr(`[${timestamp()}] [error] could not resolve branch`);
    return 1;
  }

  const ready = await ensureWorktreeReady(branch, port, stderr);
  if (!ready.ready) return 1;

  const conversationState: ConversationPrintState = {
    printedMessageIds: new Set(),
    streamingItemId: null,
    streamingText: "",
    streamingTurnId: null,
    streamingNeedsHeader: false,
    lastStreamRevision: 0,
  };

  // Print initial history once before opening the WS so the user sees their prompt right away.
  try {
    const initial = await api.fetchAgentsWorktreeConversationHistory({ params: { name: branch } });
    printConversationHistory(initial, conversationState);
  } catch {
    // Conversation history may not yet be available for non-codex agents — fall through to streaming.
  }

  let resolveExit!: (code: number) => void;
  const exitPromise = new Promise<number>((resolve) => {
    resolveExit = resolve;
  });
  let exiting = false;
  let stream: { close: () => void } | null = null;
  let historyPoller: { stop: () => void } | null = null;
  let poller: { stop: () => void } | null = null;
  const finalize = (code: number): void => {
    if (exiting) return;
    exiting = true;
    stream?.close();
    historyPoller?.stop();
    poller?.stop();
    flushStreamingLine(conversationState);
    resolveExit(code);
  };

  stream = streamConversation(branch, port, conversationState, stderr, (reason) => {
    stderr(`[${timestamp()}] [fatal] ${reason}`);
    finalize(1);
  });
  // History polling is only needed for Claude — Codex publishes live deltas via WS,
  // so polling there just spams the server every 2s for no benefit. Claude also
  // streams over WS now, but polling remains a fallback for terminal-routed runs.
  if (ready.worktree.agentName === "claude") {
    historyPoller = pollConversationHistory(branch, port, conversationState);
  }

  const pollState: PollState = {
    seenPrUrls: new Set(),
    seenMergedUrls: new Set(),
    hadOpenSession: false,
    consecutiveClosedReadings: 0,
    idleSinceMs: null,
    watcherWasArmed: false,
  };

  poller = pollProjectState(branch, port, pollState, {
    onSessionClosed: () => {
      stdout(`[${timestamp()}] [event] session closed — exiting`);
      finalize(0);
    },
    onWorktreeRemoved: () => {
      stdout(`[${timestamp()}] [event] worktree removed — exiting`);
      finalize(0);
    },
    onPrEvent: (line) => {
      flushStreamingLine(conversationState);
      stdout(`[${timestamp()}] [event] ${line}`);
    },
    onAgentDone: (reason) => {
      flushStreamingLine(conversationState);
      stdout(`[${timestamp()}] [event] ${reason} — exiting`);
      finalize(0);
    },
    onAgentStuck: (reason) => {
      flushStreamingLine(conversationState);
      stderr(`[${timestamp()}] [error] ${reason}`);
      finalize(1);
    },
    onUserTookOver: () => {
      flushStreamingLine(conversationState);
      stdout(`[${timestamp()}] [event] user took over from the browser — exiting`);
      finalize(0);
    },
  }, stderr);

  const onSignal = (): void => {
    stdout(`\n[${timestamp()}] [event] interrupted — worktree ${branch} keeps running`);
    stdout(`[${timestamp()}] [event] resume with: webmux oneshot --resume ${branch}`);
    finalize(130);
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  const finalExit = await exitPromise;
  process.off("SIGINT", onSignal);
  process.off("SIGTERM", onSignal);

  // Auto-close + Linear post-back are now driven by the server-side oneshot
  // watcher (see backend/src/services/oneshot-watcher-service.ts). The CLI
  // armed the watcher on create/open via `oneshot: { ... }` in the request
  // body, so the run can finish safely even if this CLI is killed.

  return finalExit;
}

export async function runOneshotCommand(args: string[], port: number): Promise<number> {
  let parsed: ParsedOneshotCommand | null;
  try {
    parsed = parseOneshotArgs(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(getOneshotUsage());
    return 1;
  }

  if (!parsed) {
    console.log(getOneshotUsage());
    return 0;
  }

  return await runOneshot(parsed, port);
}
