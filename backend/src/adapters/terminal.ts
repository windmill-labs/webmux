import { log } from "../lib/log";

interface TerminalSession {
  proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
  groupedSessionName: string;
  windowName: string;
  scrollback: string[];
  scrollbackBytes: number;
  onData: ((data: string) => void) | null;
  onExit: ((exitCode: number) => void) | null;
  cancelled: boolean;
}

interface AttachCmdOptions {
  gName: string;
  windowName: string;
  ownerSessionName: string;
  cols: number;
  rows: number;
  initialPane?: number;
}

export interface TerminalAttachTarget {
  ownerSessionName: string;
  windowName: string;
}

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

// Scope session names per backend instance using the backend port so multiple
// backends sharing the same tmux server don't collide or kill each other's sessions.
const DASH_PORT = Bun.env.PORT || "5111";
const SESSION_PREFIX = `wm-dash-${DASH_PORT}-`;
const MAX_SCROLLBACK_BYTES = 1 * 1024 * 1024; // 1 MB
const TMUX_TIMEOUT_MS = 5_000;
const sessions = new Map<string, TerminalSession>();
let sessionCounter = 0;

function groupedName(): string {
  return `${SESSION_PREFIX}${++sessionCounter}`;
}

function buildAttachCmd(opts: AttachCmdOptions): string {
  const paneTarget = `${opts.gName}:${opts.windowName}.${opts.initialPane ?? 0}`;
  return [
    `tmux new-session -d -s "${opts.gName}" -t "${opts.ownerSessionName}"`,
    `tmux set-option -t "${opts.ownerSessionName}" window-size latest`,
    `tmux set-option -t "${opts.gName}" mouse on`,
    `tmux set-option -t "${opts.gName}" set-clipboard on`,
    `tmux select-window -t "${opts.gName}:${opts.windowName}"`,
    // Unzoom if a previous session left a pane zoomed (zoom state is shared across grouped sessions)
    `if [ "$(tmux display-message -t '${opts.gName}:${opts.windowName}' -p '#{window_zoomed_flag}')" = "1" ]; then tmux resize-pane -Z -t '${opts.gName}:${opts.windowName}'; fi`,
    `tmux select-pane -t "${paneTarget}"`,
    // On mobile, zoom the selected pane to fill the window
    ...(opts.initialPane !== undefined ? [`tmux resize-pane -Z -t "${paneTarget}"`] : []),
    `stty rows ${opts.rows} cols ${opts.cols}`,
    `exec tmux attach-session -t "${opts.gName}"`,
  ].join(" && ");
}

async function tmuxExec(
  args: string[],
  opts: { stdin?: Uint8Array } = {},
): Promise<{ exitCode: number; stderr: string }> {
  const proc = Bun.spawn(args, {
    stdin: opts.stdin ?? "ignore",
    stdout: "ignore",
    stderr: "pipe",
  });

  const timeout = Bun.sleep(TMUX_TIMEOUT_MS).then(() => {
    proc.kill();
    return "timeout" as const;
  });

  const result = await Promise.race([proc.exited, timeout]);
  if (result === "timeout") {
    return { exitCode: -1, stderr: `timed out after ${TMUX_TIMEOUT_MS}ms` };
  }

  const stderr = (await new Response(proc.stderr).text()).trim();
  return { exitCode: result, stderr };
}

/** Kill any orphaned wm-dash-* tmux sessions left from previous server runs. */
export function cleanupStaleSessions(): void {
  try {
    const result = Bun.spawnSync(
      ["tmux", "list-sessions", "-F", "#{session_name}"],
      { stdout: "pipe", stderr: "pipe" }
    );
    if (result.exitCode !== 0) return;
    const lines = textDecoder.decode(result.stdout).trim().split("\n");
    for (const name of lines) {
      if (name.startsWith(SESSION_PREFIX)) {
        Bun.spawnSync(["tmux", "kill-session", "-t", name]);
      }
    }
  } catch {
    // No tmux server running
  }
}

/** Kill a tmux session by name, logging unexpected failures. */
function killTmuxSession(name: string): void {
  const result = Bun.spawnSync(["tmux", "kill-session", "-t", name], { stderr: "pipe" });
  if (result.exitCode !== 0) {
    const stderr = textDecoder.decode(result.stderr).trim();
    if (!stderr.includes("can't find session")) {
      log.warn(`[term] killTmuxSession(${name}) exit=${result.exitCode} ${stderr}`);
    }
  }
}

export async function attach(
  attachId: string,
  target: TerminalAttachTarget,
  cols: number,
  rows: number,
  initialPane?: number
): Promise<void> {
  log.debug(`[term] attach(${attachId}) cols=${cols} rows=${rows} existing=${sessions.has(attachId)}`);
  if (sessions.has(attachId)) {
    await detach(attachId);
  }

  const gName = groupedName();
  log.debug(
    `[term] attach(${attachId}) ownerSession=${target.ownerSessionName} gName=${gName} window=${target.windowName}`,
  );

  // Kill stale session with same name if it exists (leftover from previous server run)
  killTmuxSession(gName);

  const cmd = buildAttachCmd({
    gName,
    ownerSessionName: target.ownerSessionName,
    windowName: target.windowName,
    cols,
    rows,
    initialPane,
  });

  // macOS `script` fails with "tcgetattr: Operation not supported on socket"
  // when stdin is a socket pair (Bun.spawn uses socketpair, not pipe).
  // Python's pty.spawn handles non-TTY stdin gracefully.
  const scriptArgs = process.platform === "darwin"
    ? ["python3", "-c", "import pty,sys;pty.spawn(sys.argv[1:])", "bash", "-c", cmd]
    : ["script", "-q", "-c", cmd, "/dev/null"];

  const proc = Bun.spawn(scriptArgs, {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...Bun.env, TERM: "xterm-256color" },
  });

  const session: TerminalSession = {
    proc,
    groupedSessionName: gName,
    windowName: target.windowName,
    scrollback: [],
    scrollbackBytes: 0,
    onData: null,
    onExit: null,
    cancelled: false,
  };

  sessions.set(attachId, session);
  log.debug(`[term] attach(${attachId}) spawned pid=${proc.pid}`);

  // Read stdout → push to scrollback + callback
  (async () => {
    const reader = proc.stdout.getReader();
    try {
      while (true) {
        if (session.cancelled) break;
        const { done, value } = await reader.read();
        if (done) break;
        const str = textDecoder.decode(value);
        session.scrollbackBytes += textEncoder.encode(str).byteLength;
        session.scrollback.push(str);
        while (session.scrollbackBytes > MAX_SCROLLBACK_BYTES && session.scrollback.length > 0) {
          const removed = session.scrollback.shift()!;
          session.scrollbackBytes -= textEncoder.encode(removed).byteLength;
        }
        session.onData?.(str);
      }
    } catch (err) {
      // Stream closed normally — no action needed.
      // Log anything unexpected so it surfaces during debugging.
      if (!session.cancelled) {
        log.error(`[term] stdout reader error(${attachId})`, err);
      }
    }
  })();

  // Read stderr → log for diagnostics
  (async () => {
    const reader = proc.stderr.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        log.debug(`[term] stderr(${attachId}): ${textDecoder.decode(value).trimEnd()}`);
      }
    } catch { /* stream closed */ }
  })();

  proc.exited.then((exitCode) => {
    log.debug(`[term] proc exited(${attachId}) pid=${proc.pid} code=${exitCode}`);
    // Only clean up if this session is still the active one (not replaced by a new attach)
    if (sessions.get(attachId) === session) {
      session.onExit?.(exitCode);
      sessions.delete(attachId);
    } else {
      log.debug(`[term] proc exited(${attachId}) stale session, skipping cleanup`);
    }
    killTmuxSession(gName);
  });
}

export async function detach(attachId: string): Promise<void> {
  const session = sessions.get(attachId);
  if (!session) {
    log.debug(`[term] detach(${attachId}) no session found`);
    return;
  }

  log.debug(`[term] detach(${attachId}) killing pid=${session.proc.pid} tmux=${session.groupedSessionName}`);
  session.cancelled = true;
  session.proc.kill();
  sessions.delete(attachId);

  killTmuxSession(session.groupedSessionName);
}

export function write(attachId: string, data: string): void {
  const session = sessions.get(attachId);
  if (!session) {
    log.warn(`[term] write(${attachId}) NO SESSION - input dropped (${data.length} bytes)`);
    return;
  }
  try {
    session.proc.stdin.write(textEncoder.encode(data));
    session.proc.stdin.flush();
  } catch (err) {
    log.error(`[term] write(${attachId}) stdin closed`, err);
  }
}

/** Send raw hex bytes to the active tmux pane via `tmux send-keys -H`,
 *  bypassing tmux's input parser (needed for CSI u sequences). */
export async function sendKeys(attachId: string, hexBytes: string[]): Promise<void> {
  const session = sessions.get(attachId);
  if (!session) return;
  const windowTarget = `${session.groupedSessionName}:${session.windowName}`;
  await tmuxExec(["tmux", "send-keys", "-t", windowTarget, "-H", ...hexBytes]);
}

export async function resize(attachId: string, cols: number, rows: number): Promise<void> {
  const session = sessions.get(attachId);
  if (!session) return;
  const windowTarget = `${session.groupedSessionName}:${session.windowName}`;
  const result = await tmuxExec(["tmux", "resize-window", "-t", windowTarget, "-x", String(cols), "-y", String(rows)]);
  if (result.exitCode !== 0) log.warn(`[term] resize failed: ${result.stderr}`);
}

export function getScrollback(attachId: string): string {
  return sessions.get(attachId)?.scrollback.join("") ?? "";
}

export function setCallbacks(
  attachId: string,
  onData: (data: string) => void,
  onExit: (exitCode: number) => void
): void {
  const session = sessions.get(attachId);
  if (session) {
    session.onData = onData;
    session.onExit = onExit;
  }
}

export async function selectPane(attachId: string, paneIndex: number): Promise<void> {
  const session = sessions.get(attachId);
  if (!session) {
    log.debug(`[term] selectPane(${attachId}) no session found`);
    return;
  }
  const target = `${session.groupedSessionName}:${session.windowName}.${paneIndex}`;
  log.debug(`[term] selectPane(${attachId}) pane=${paneIndex} target=${target}`);
  const [r1, r2] = await Promise.all([
    tmuxExec(["tmux", "select-pane", "-t", target]),
    tmuxExec(["tmux", "resize-pane", "-Z", "-t", target]),
  ]);
  log.debug(`[term] selectPane(${attachId}) select=${r1.exitCode} zoom=${r2.exitCode}`);
}

export function clearCallbacks(attachId: string): void {
  const session = sessions.get(attachId);
  if (session) {
    session.onData = null;
    session.onExit = null;
  }
}

export async function sendPrompt(
  worktreeId: string,
  target: TerminalAttachTarget,
  text: string,
  paneIndex = 0,
  preamble?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const paneTarget = `${target.ownerSessionName}:${target.windowName}.${paneIndex}`;
  log.debug(`[term] sendPrompt(${worktreeId}) target=${paneTarget} textBytes=${text.length}`);

  if (preamble) {
    const preambleResult = await tmuxExec(["tmux", "send-keys", "-t", paneTarget, "-l", "--", preamble]);
    if (preambleResult.exitCode !== 0) {
      return { ok: false, error: `send-keys preamble failed${preambleResult.stderr ? `: ${preambleResult.stderr}` : ""}` };
    }
  }

  const cleaned = text.replace(/\0/g, "");
  const bufferName = `wm-prompt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const load = await tmuxExec(["tmux", "load-buffer", "-b", bufferName, "-"], {
    stdin: new TextEncoder().encode(cleaned),
  });
  if (load.exitCode !== 0) {
    return { ok: false, error: `load-buffer failed${load.stderr ? `: ${load.stderr}` : ""}` };
  }

  const paste = await tmuxExec(["tmux", "paste-buffer", "-b", bufferName, "-t", paneTarget, "-d"]);
  if (paste.exitCode !== 0) {
    return { ok: false, error: `paste-buffer failed${paste.stderr ? `: ${paste.stderr}` : ""}` };
  }

  return { ok: true };
}
