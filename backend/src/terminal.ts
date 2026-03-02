import { log } from "./lib/log";

interface TerminalSession {
  proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
  groupedSessionName: string;
  scrollback: string[];
  scrollbackBytes: number;
  onData: ((data: string) => void) | null;
  onExit: ((exitCode: number) => void) | null;
  cancelled: boolean;
}

interface AttachCmdOptions {
  gName: string;
  worktreeName: string;
  tmuxSession: string;
  cols: number;
  rows: number;
  initialPane?: number;
}

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

// Scope session names per backend instance using the dashboard port so multiple
// dashboards sharing the same tmux server don't collide or kill each other's sessions.
const DASH_PORT = Bun.env.BACKEND_PORT || "5111";
const SESSION_PREFIX = `wm-dash-${DASH_PORT}-`;
const MAX_SCROLLBACK_BYTES = 1 * 1024 * 1024; // 1 MB
const sessions = new Map<string, TerminalSession>();
let sessionCounter = 0;

function groupedName(): string {
  return `${SESSION_PREFIX}${++sessionCounter}`;
}

function buildAttachCmd(opts: AttachCmdOptions): string {
  const windowTarget = `wm-${opts.worktreeName}`;
  const paneTarget = `${opts.gName}:${windowTarget}.${opts.initialPane ?? 0}`;
  return [
    `tmux new-session -d -s "${opts.gName}" -t "${opts.tmuxSession}"`,
    `tmux set-option -t "${opts.tmuxSession}" window-size latest`,
    `tmux set-option -t "${opts.gName}" mouse on`,
    `tmux set-option -t "${opts.gName}" set-clipboard on`,
    `tmux select-window -t "${opts.gName}:${windowTarget}"`,
    // Unzoom if a previous session left a pane zoomed (zoom state is shared across grouped sessions)
    `if [ "$(tmux display-message -t '${opts.gName}:${windowTarget}' -p '#{window_zoomed_flag}')" = "1" ]; then tmux resize-pane -Z -t '${opts.gName}:${windowTarget}'; fi`,
    `tmux select-pane -t "${paneTarget}"`,
    // On mobile, zoom the selected pane to fill the window
    ...(opts.initialPane !== undefined ? [`tmux resize-pane -Z -t "${paneTarget}"`] : []),
    `stty rows ${opts.rows} cols ${opts.cols}`,
    `exec tmux attach-session -t "${opts.gName}"`,
  ].join(" && ");
}

async function asyncTmux(args: string[]): Promise<{ exitCode: number; stderr: string }> {
  const proc = Bun.spawn(args, { stdin: "ignore", stdout: "ignore", stderr: "pipe" });
  const exitCode = await proc.exited;
  const stderr = (await new Response(proc.stderr).text()).trim();
  return { exitCode, stderr };
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

/**
 * Pure: parse `tmux list-windows -a` output to find the session owning
 * a worktree window.  Skips wm-dash-* viewer sessions.
 * Returns the session name, or null if not found.
 */
export function parseTmuxSessionForWorktree(
  tmuxOutput: string,
  worktreeName: string,
): string | null {
  const windowName = `wm-${worktreeName}`;
  const lines = tmuxOutput.trim().split("\n").filter(Boolean);
  // First pass: exact window match, skip viewer sessions
  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const session = line.slice(0, colonIdx);
    const name = line.slice(colonIdx + 1);
    if (name === windowName && !session.startsWith("wm-dash-")) {
      return session;
    }
  }
  // Fallback: any non-viewer session with a wm-* window
  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const session = line.slice(0, colonIdx);
    const name = line.slice(colonIdx + 1);
    if (name.startsWith("wm-") && !session.startsWith("wm-dash-")) {
      return session;
    }
  }
  return null;
}

/** Find the tmux session that owns the window for a given worktree.
 *  Skips wm-dash-* grouped/viewer sessions to find the real workmux session. */
async function findTmuxSessionForWorktree(worktreeName: string): Promise<string> {
  try {
    const proc = Bun.spawn(
      ["tmux", "list-windows", "-a", "-F", "#{session_name}:#{window_name}"],
      { stdout: "pipe", stderr: "pipe" },
    );
    if (await proc.exited !== 0) return "0";
    const output = await new Response(proc.stdout).text();
    return parseTmuxSessionForWorktree(output, worktreeName) ?? "0";
  } catch {
    // No tmux server running
  }
  return "0";
}

export async function attach(
  worktreeName: string,
  cols: number,
  rows: number,
  initialPane?: number
): Promise<string> {
  log.debug(`[term] attach(${worktreeName}) cols=${cols} rows=${rows} existing=${sessions.has(worktreeName)}`);
  if (sessions.has(worktreeName)) {
    await detach(worktreeName);
  }

  const tmuxSession = await findTmuxSessionForWorktree(worktreeName);
  const gName = groupedName();
  log.debug(`[term] attach(${worktreeName}) tmuxSession=${tmuxSession} gName=${gName} window=wm-${worktreeName}`);

  // Kill stale session with same name if it exists (leftover from previous server run)
  killTmuxSession(gName);

  const cmd = buildAttachCmd({ gName, worktreeName, tmuxSession, cols, rows, initialPane });

  const proc = Bun.spawn(["script", "-q", "-c", cmd, "/dev/null"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...Bun.env, TERM: "xterm-256color" },
  });

  const session: TerminalSession = {
    proc,
    groupedSessionName: gName,
    scrollback: [],
    scrollbackBytes: 0,
    onData: null,
    onExit: null,
    cancelled: false,
  };

  sessions.set(worktreeName, session);
  log.debug(`[term] attach(${worktreeName}) spawned pid=${proc.pid}`);

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
        log.error(`[term] stdout reader error(${worktreeName})`, err);
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
        log.debug(`[term] stderr(${worktreeName}): ${textDecoder.decode(value).trimEnd()}`);
      }
    } catch { /* stream closed */ }
  })();

  proc.exited.then((exitCode) => {
    log.debug(`[term] proc exited(${worktreeName}) pid=${proc.pid} code=${exitCode}`);
    // Only clean up if this session is still the active one (not replaced by a new attach)
    if (sessions.get(worktreeName) === session) {
      session.onExit?.(exitCode);
      sessions.delete(worktreeName);
    } else {
      log.debug(`[term] proc exited(${worktreeName}) stale session, skipping cleanup`);
    }
    killTmuxSession(gName);
  });

  return worktreeName;
}

export async function detach(worktreeName: string): Promise<void> {
  const session = sessions.get(worktreeName);
  if (!session) {
    log.debug(`[term] detach(${worktreeName}) no session found`);
    return;
  }

  log.debug(`[term] detach(${worktreeName}) killing pid=${session.proc.pid} tmux=${session.groupedSessionName}`);
  session.cancelled = true;
  session.proc.kill();
  sessions.delete(worktreeName);

  killTmuxSession(session.groupedSessionName);
}

export function write(worktreeName: string, data: string): void {
  const session = sessions.get(worktreeName);
  if (!session) {
    log.warn(`[term] write(${worktreeName}) NO SESSION - input dropped (${data.length} bytes)`);
    return;
  }
  try {
    session.proc.stdin.write(textEncoder.encode(data));
    session.proc.stdin.flush();
  } catch (err) {
    log.error(`[term] write(${worktreeName}) stdin closed`, err);
  }
}

export async function resize(worktreeName: string, cols: number, rows: number): Promise<void> {
  const session = sessions.get(worktreeName);
  if (!session) return;
  const windowTarget = `${session.groupedSessionName}:wm-${worktreeName}`;
  const result = await asyncTmux(["tmux", "resize-window", "-t", windowTarget, "-x", String(cols), "-y", String(rows)]);
  if (result.exitCode !== 0) log.warn(`[term] resize failed: ${result.stderr}`);
}

export function getScrollback(worktreeName: string): string {
  return sessions.get(worktreeName)?.scrollback.join("") ?? "";
}

export function setCallbacks(
  worktreeName: string,
  onData: (data: string) => void,
  onExit: (exitCode: number) => void
): void {
  const session = sessions.get(worktreeName);
  if (session) {
    session.onData = onData;
    session.onExit = onExit;
  }
}

export async function selectPane(worktreeName: string, paneIndex: number): Promise<void> {
  const session = sessions.get(worktreeName);
  if (!session) {
    log.debug(`[term] selectPane(${worktreeName}) no session found`);
    return;
  }
  const windowTarget = `wm-${worktreeName}`;
  const target = `${session.groupedSessionName}:${windowTarget}.${paneIndex}`;
  log.debug(`[term] selectPane(${worktreeName}) pane=${paneIndex} target=${target}`);
  const [r1, r2] = await Promise.all([
    asyncTmux(["tmux", "select-pane", "-t", target]),
    asyncTmux(["tmux", "resize-pane", "-Z", "-t", target]),
  ]);
  log.debug(`[term] selectPane(${worktreeName}) select=${r1.exitCode} zoom=${r2.exitCode}`);
}

export function clearCallbacks(worktreeName: string): void {
  const session = sessions.get(worktreeName);
  if (session) {
    session.onData = null;
    session.onExit = null;
  }
}
