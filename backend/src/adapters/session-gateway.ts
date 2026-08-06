import { createHash } from "node:crypto";
import { basename, resolve } from "node:path";
import type { PaneSplit } from "../domain/config";

export interface SessionWindowSummary {
  sessionName: string;
  windowName: string;
  paneCount: number;
}

/** Multiplexer-agnostic control surface webmux drives to build, inspect and tear
 *  down a worktree's panes.
 *
 *  Sessions/windows are addressed by the names built below; individual panes are
 *  addressed by *opaque* handles the gateway itself mints ({@link getPaneId},
 *  {@link createParkedPane}) or by a `session:window.index` target string
 *  ({@link buildPaneTarget}). Callers must treat handles as opaque — tmux returns
 *  `%N`, herdr returns `w1:p2`.
 *
 *  Every method is async: tmux shells out, herdr round-trips a unix socket. */
export interface SessionGateway {
  /** Bring the multiplexer server up if it is not already running. */
  ensureServer(): Promise<void>;
  ensureSession(sessionName: string, cwd: string): Promise<void>;
  hasWindow(sessionName: string, windowName: string): Promise<boolean>;
  killWindow(sessionName: string, windowName: string): Promise<void>;
  /** Create a window and apply whatever backend-specific options webmux relies on
   *  (pane indexing, rename suppression). Replaces any existing window of the
   *  same name only if the caller killed it first. */
  createWindow(opts: {
    sessionName: string;
    windowName: string;
    cwd: string;
    command?: string;
  }): Promise<void>;
  splitWindow(opts: {
    target: string;
    split: PaneSplit;
    sizePct?: number;
    cwd: string;
    command?: string;
  }): Promise<void>;
  runCommand(target: string, command: string): Promise<void>;
  selectPane(target: string): Promise<void>;
  listWindows(): Promise<SessionWindowSummary[]>;
  /** Resolve the opaque pane handle currently occupying a target. */
  getPaneId(target: string): Promise<string>;
  /** Create a detached "parked" pane that holds a tab's session off-screen,
   *  returning its handle. Creates the parking window on first use, then splits
   *  it for subsequent panes. */
  createParkedPane(opts: { sessionName: string; parkingWindow: string; cwd: string; command: string }): Promise<string>;
  /** Exchange the contents of two panes in place (used to bring a tab into the
   *  visible agent slot). */
  swapPanes(source: string, destination: string): Promise<void>;
  /** Remove a pane. Tolerates an already-gone pane. */
  killPane(target: string): Promise<void>;
}

export function sanitizeNameSegment(value: string, maxLength = 24): string {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "");
  const trimmed = sanitized.slice(0, maxLength);
  return trimmed || "x";
}

export function buildProjectSessionName(projectRoot: string): string {
  const resolved = resolve(projectRoot);
  const base = sanitizeNameSegment(basename(resolved), 18);
  const hash = createHash("sha1").update(resolved).digest("hex").slice(0, 8);
  return `wm-${base}-${hash}`;
}

export function buildWorktreeWindowName(branch: string): string {
  return `wm-${branch}`;
}

/** Hidden window that holds a worktree's parked (inactive) tab panes. */
export function buildWorktreeParkingWindowName(branch: string): string {
  return `wm-${branch}-tabs`;
}

export function buildWindowTarget(sessionName: string, windowName: string): string {
  return `${sessionName}:${windowName}`;
}

export function buildPaneTarget(sessionName: string, windowName: string, paneIndex: number): string {
  return `${sessionName}:${windowName}.${paneIndex}`;
}

export interface ParsedPaneTarget {
  sessionName: string;
  windowName: string;
  paneIndex: number | null;
}

/** Split a `session:window[.index]` target back into its parts. Returns null for
 *  anything that isn't one — notably opaque pane handles, which gateways mint in
 *  their own format and must resolve directly. Window names may contain dots
 *  (branches do), so only a trailing all-digit segment counts as a pane index. */
export function parsePaneTarget(target: string): ParsedPaneTarget | null {
  const separator = target.indexOf(":");
  if (separator <= 0) return null;

  const sessionName = target.slice(0, separator);
  const rest = target.slice(separator + 1);
  if (rest.length === 0) return null;

  const lastDot = rest.lastIndexOf(".");
  const trailing = lastDot >= 0 ? rest.slice(lastDot + 1) : "";
  if (lastDot > 0 && trailing.length > 0 && /^\d+$/.test(trailing)) {
    return { sessionName, windowName: rest.slice(0, lastDot), paneIndex: parseInt(trailing, 10) };
  }
  return { sessionName, windowName: rest, paneIndex: null };
}
