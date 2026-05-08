import { apiPaths, AgentsUiConversationEventSchema, createApi, type AgentsUiConversationMessage, type AgentsUiConversationEvent, type AgentsUiWorktreeConversationResponse, type CreateWorktreeRequest, type OnMergeAction, type ProjectWorktreeSnapshot } from "@webmux/api-contract";

export interface ParsedOneshotCommand {
  branch: string | null;
  prompt: string | null;
  resume: boolean;
  body: CreateWorktreeRequest;
  onMergeAction: OnMergeAction | null;
  keepOpen: boolean;
}

class CommandUsageError extends Error {}

export function getOneshotUsage(): string {
  return [
    "Usage:",
    "  webmux oneshot [branch] --prompt <text> [--agent <id>] [--base <branch>] [--profile <name>]",
    "                          [--env KEY=VALUE]... [--close-on-merge|--remove-on-merge|--keep-open]",
    "  webmux oneshot --resume <branch> [--prompt <text>]",
    "",
    "Runs an agent worktree start-to-finish, streaming the conversation to stdout.",
    "Does not change the focused tmux session. Exits when the session closes",
    "(after auto-merge action) or on Ctrl-C.",
    "",
    "Options:",
    "  --resume <branch>        Resume an existing worktree instead of creating one",
    "  --prompt <text>          Initial agent prompt (or follow-up when --resume)",
    "  --agent <id>             Agent id to launch",
    "  --base <branch>          Base branch for a new worktree (defaults to config)",
    "  --profile <name>         Worktree profile from .webmux.yaml",
    "  --env KEY=VALUE          Runtime env override (repeatable)",
    "  --close-on-merge         Close the session on PR merge (default for oneshot)",
    "  --remove-on-merge        Remove the worktree on PR merge",
    "  --keep-open              Stream until interrupted; do not auto-close on merge",
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
  let prompt: string | null = null;
  let resume = false;
  let resumeBranch: string | null = null;
  let onMergeAction: OnMergeAction | null = null;
  let onMergeActionExplicit = false;
  let keepOpen = false;

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

    if (arg === "--close-on-merge") {
      if (keepOpen) {
        throw new CommandUsageError("Cannot use --keep-open with --close-on-merge or --remove-on-merge");
      }
      if (onMergeActionExplicit && onMergeAction !== "close") {
        throw new CommandUsageError("Conflicting on-merge options");
      }
      onMergeAction = "close";
      onMergeActionExplicit = true;
      continue;
    }

    if (arg === "--remove-on-merge") {
      if (keepOpen) {
        throw new CommandUsageError("Cannot use --keep-open with --close-on-merge or --remove-on-merge");
      }
      if (onMergeActionExplicit && onMergeAction !== "remove") {
        throw new CommandUsageError("Conflicting on-merge options");
      }
      onMergeAction = "remove";
      onMergeActionExplicit = true;
      continue;
    }

    if (arg === "--keep-open") {
      if (onMergeActionExplicit) {
        throw new CommandUsageError("Cannot use --keep-open with --close-on-merge or --remove-on-merge");
      }
      keepOpen = true;
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
    if (!resumeBranch) throw new CommandUsageError("--resume requires a branch name");
    if (branch && branch !== resumeBranch) {
      throw new CommandUsageError("Cannot pass both a positional branch and --resume");
    }
    branch = resumeBranch;
  }

  if (!resume && !prompt) {
    throw new CommandUsageError("oneshot requires --prompt (or use --resume)");
  }

  // Default for new oneshot: close-on-merge so the command has a natural exit.
  if (!resume && !onMergeActionExplicit && !keepOpen) {
    onMergeAction = "close";
  }

  if (branch) body.branch = branch;
  if (prompt) body.prompt = prompt;
  if (Object.keys(envOverrides).length > 0) body.envOverrides = envOverrides;
  if (!resume && onMergeAction !== null) body.onMergeAction = onMergeAction;

  return {
    branch,
    prompt,
    resume,
    body,
    onMergeAction,
    keepOpen,
  };
}

interface OneshotRunContext {
  parsed: ParsedOneshotCommand;
  port: number;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

interface ConversationPrintState {
  printedMessageIds: Set<string>;
  streamingItemId: string | null;
  streamingNeedsHeader: boolean;
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

function flushStreamingLine(state: ConversationPrintState): void {
  if (state.streamingItemId !== null) {
    process.stdout.write("\n");
    state.streamingItemId = null;
    state.streamingNeedsHeader = false;
  }
}

function printNewMessages(
  state: ConversationPrintState,
  messages: AgentsUiConversationMessage[],
): void {
  for (const message of messages) {
    if (state.printedMessageIds.has(message.id)) continue;
    if (state.streamingItemId === message.id) {
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
    process.stdout.write(`${formatLogLine(message.role, message.text)}\n`);
    state.printedMessageIds.add(message.id);
  }
}

function handleConversationEvent(
  event: AgentsUiConversationEvent,
  state: ConversationPrintState,
  stderr: (line: string) => void,
): void {
  if (event.type === "snapshot") {
    printNewMessages(state, event.data.conversation.messages);
    return;
  }
  if (event.type === "messageDelta") {
    if (state.streamingItemId !== event.itemId) {
      flushStreamingLine(state);
      state.streamingItemId = event.itemId;
      state.streamingNeedsHeader = true;
    }
    if (state.streamingNeedsHeader) {
      process.stdout.write(`[${timestamp()}] [assistant] `);
      state.streamingNeedsHeader = false;
    }
    process.stdout.write(event.delta);
    return;
  }
  if (event.type === "error") {
    flushStreamingLine(state);
    stderr(`[${timestamp()}] [error] ${event.message}`);
    return;
  }
}

function streamConversation(
  branch: string,
  port: number,
  state: ConversationPrintState,
  stderr: (line: string) => void,
): { close: () => void } {
  let closed = false;
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const connect = (): void => {
    if (closed) return;
    const url = `ws://localhost:${port}${apiPaths.streamAgentsWorktreeConversation.replace(":name", encodeURIComponent(branch))}`;
    const ws = new WebSocket(url);
    socket = ws;
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
}

function pollProjectState(
  branch: string,
  port: number,
  state: PollState,
  callbacks: {
    onSessionClosed: () => void;
    onWorktreeRemoved: () => void;
    onPrEvent: (line: string) => void;
  },
): { stop: () => void } {
  const api = createApi(`http://localhost:${port}`);
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

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
        if (worktree.mux) state.hadOpenSession = true;
        for (const pr of worktree.prs) {
          if (!state.seenPrUrls.has(pr.url)) {
            state.seenPrUrls.add(pr.url);
            callbacks.onPrEvent(`PR #${pr.number} opened: ${pr.url}`);
          }
          if (pr.state === "merged" && !state.seenMergedUrls.has(pr.url)) {
            state.seenMergedUrls.add(pr.url);
            callbacks.onPrEvent(`PR #${pr.number} merged: ${pr.url}`);
          }
        }
        if (state.hadOpenSession && !worktree.mux) {
          callbacks.onSessionClosed();
          return;
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
): Promise<boolean> {
  const api = createApi(`http://localhost:${port}`);
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await api.fetchWorktrees();
      const worktree = response.worktrees.find((w: ProjectWorktreeSnapshot) => w.branch === branch);
      if (worktree && worktree.mux && worktree.status !== "creating") return true;
    } catch {
      // ignore
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  stderr(`[${timestamp()}] [error] timed out waiting for ${branch} session to start`);
  return false;
}

function printConversationHistory(
  initial: AgentsUiWorktreeConversationResponse,
  state: ConversationPrintState,
): void {
  printNewMessages(state, initial.conversation.messages);
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

  try {
    if (parsed.resume) {
      if (!branch) throw new Error("--resume requires a branch name");
      stdout(`[${timestamp()}] [event] resuming ${branch}`);
      await api.openWorktree({ params: { name: branch } });
      if (parsed.prompt) {
        // Wait for the agent to be ready before pushing a follow-up prompt.
        const ready = await ensureWorktreeReady(branch, port, stderr);
        if (!ready) return 1;
        await api.sendWorktreePrompt({
          params: { name: branch },
          body: { text: parsed.prompt },
        });
        stdout(`[${timestamp()}] [event] sent prompt`);
      }
    } else {
      stdout(`[${timestamp()}] [event] creating worktree${branch ? ` ${branch}` : ""}...`);
      const result = await api.createWorktree({ body: parsed.body });
      branch = result.primaryBranch;
      stdout(`[${timestamp()}] [event] created ${branch}`);
    }
  } catch (error) {
    stderr(`[${timestamp()}] [error] ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  if (!branch) {
    stderr(`[${timestamp()}] [error] could not resolve branch`);
    return 1;
  }

  const ready = await ensureWorktreeReady(branch, port, stderr);
  if (!ready) return 1;

  const conversationState: ConversationPrintState = {
    printedMessageIds: new Set(),
    streamingItemId: null,
    streamingNeedsHeader: false,
  };

  // Print initial history once before opening the WS so the user sees their prompt right away.
  try {
    const initial = await api.fetchAgentsWorktreeConversationHistory({ params: { name: branch } });
    printConversationHistory(initial, conversationState);
  } catch {
    // Conversation history may not yet be available for non-codex agents — fall through to streaming.
  }

  const stream = streamConversation(branch, port, conversationState, stderr);

  let exitCode = 0;
  let exiting = false;
  const finalize = (code: number): void => {
    if (exiting) return;
    exiting = true;
    exitCode = code;
    stream.close();
    poller.stop();
    flushStreamingLine(conversationState);
  };

  const pollState: PollState = {
    seenPrUrls: new Set(),
    seenMergedUrls: new Set(),
    hadOpenSession: false,
  };

  const poller = pollProjectState(branch, port, pollState, {
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
  });

  const onSignal = (): void => {
    stdout(`\n[${timestamp()}] [event] interrupted — worktree ${branch} keeps running`);
    stdout(`[${timestamp()}] [event] resume with: webmux oneshot --resume ${branch}`);
    finalize(130);
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  return await new Promise<number>((resolve) => {
    const checkExit = (): void => {
      if (exiting) {
        process.off("SIGINT", onSignal);
        process.off("SIGTERM", onSignal);
        resolve(exitCode);
        return;
      }
      setTimeout(checkExit, 250);
    };
    checkExit();
  });
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
