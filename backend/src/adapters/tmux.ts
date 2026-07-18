import { createHash } from "node:crypto";
import { basename, resolve } from "node:path";
import type { PaneSplit } from "../domain/config";
import { leakedProjectEnvKeys, stripProjectEnv } from "./project-env";

export interface TmuxWindowSummary {
  sessionName: string;
  windowName: string;
  paneCount: number;
}

export interface TmuxGateway {
  ensureServer(): void;
  ensureSession(sessionName: string, cwd: string): void;
  hasWindow(sessionName: string, windowName: string): boolean;
  killWindow(sessionName: string, windowName: string): void;
  createWindow(opts: {
    sessionName: string;
    windowName: string;
    cwd: string;
    command?: string;
  }): void;
  splitWindow(opts: {
    target: string;
    split: PaneSplit;
    sizePct?: number;
    cwd: string;
    command?: string;
  }): void;
  setWindowOption(sessionName: string, windowName: string, option: string, value: string): void;
  runCommand(target: string, command: string): void;
  selectPane(target: string): void;
  listWindows(): TmuxWindowSummary[];
  /** Resolve the tmux pane id (`%N`) currently occupying a target (e.g. a pane index). */
  getPaneId(target: string): string;
  /** Create a detached "parked" pane that holds a tab's session off-screen, returning its pane id.
   *  Creates the parking window on first use, then splits it for subsequent panes. */
  createParkedPane(opts: { sessionName: string; parkingWindow: string; cwd: string; command: string }): string;
  /** Exchange the contents of two panes in place (used to bring a tab into the visible agent slot). */
  swapPanes(source: string, destination: string): void;
  /** Remove a pane (used when deleting a tab). Tolerates an already-gone pane. */
  killPane(target: string): void;
}

let cachedTmuxSpawnEnv: Record<string, string> | null = null;
let cachedUtf8Locale: string | null = null;
let globalEnvScrubbed = false;

/** Base environment for spawning tmux control commands, stripped of the launch
 *  project's `.env` keys (see {@link stripProjectEnv}). Whichever tmux command
 *  first starts the server fixes the global environment for the server's
 *  lifetime, so every tmux invocation must use the stripped env. Cached — the
 *  leaked keys are fixed at launch. When no project keys were loaded this is the
 *  full parent env (nothing to strip). */
function tmuxSpawnEnv(): Record<string, string> {
  return (cachedTmuxSpawnEnv ??= stripProjectEnv(Bun.env));
}

/** Choose the best UTF-8 locale from a `locale -a` listing, used only when the
 *  environment carries no UTF-8 locale of its own. Preference: a neutral
 *  `C.UTF-8`/`C.utf8` (no locale-specific collation/messages leak into panes),
 *  then `en_US.*`, then any UTF-8 locale the host reports. Returns the *exact*
 *  listed name so `setlocale` accepts it. This keeps the fallback valid across
 *  platforms — older macOS lacks `C.UTF-8` (but has `en_US.UTF-8`); minimal
 *  Linux images often lack `en_US.UTF-8` (but glibc >= 2.35 ships `C.UTF-8`).
 *  `C.UTF-8` is only the last-resort literal when nothing is listed. */
export function chooseUtf8Locale(available: string[]): string {
  const trimmed = available.map((entry) => entry.trim()).filter(Boolean);
  const byLower = new Map(trimmed.map((entry) => [entry.toLowerCase(), entry]));
  const preferred = ["c.utf-8", "c.utf8", "en_us.utf-8", "en_us.utf8"];
  return (
    preferred.map((key) => byLower.get(key)).find((entry): entry is string => Boolean(entry))
    ?? trimmed.find((entry) => /\.utf-?8$/i.test(entry))
    ?? "C.UTF-8"
  );
}

/** Best UTF-8 locale actually installed on this host (from `locale -a`), cached
 *  for the process lifetime. Falls back to a bare `C.UTF-8` if `locale(1)` can't
 *  be run. */
function detectUtf8Locale(): string {
  if (cachedUtf8Locale) return cachedUtf8Locale;
  let available: string[] = [];
  try {
    const result = Bun.spawnSync(["locale", "-a"], { stdout: "pipe", stderr: "pipe" });
    if (result.exitCode === 0) {
      available = new TextDecoder().decode(result.stdout).split("\n");
    }
  } catch {
    // locale(1) unavailable — fall back to the literal in chooseUtf8Locale.
  }
  return (cachedUtf8Locale = chooseUtf8Locale(available));
}

/** Pick a UTF-8 locale for tmux. Under a non-UTF-8 locale — e.g. a macOS launchd
 *  agent that inherits no `LANG`/`LC_*` — tmux rewrites the TAB byte in `-F`
 *  output as `_`, which silently breaks webmux's tab-delimited parsing of
 *  `list-windows` (every window drops, so every session looks closed). Keep a
 *  UTF-8 locale the environment already provides; otherwise use `fallback` (a
 *  UTF-8 locale detected on the host). */
export function pickTmuxLocale(env: Record<string, string | undefined>, fallback: string): string {
  const inherited = env.LC_ALL || env.LC_CTYPE || env.LANG || "";
  return /utf-?8/i.test(inherited) ? inherited : fallback;
}

function runTmux(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  // Pass an explicit env — Bun.spawnSync treats it as the *complete* child
  // environment, not a merge — built from the project-stripped parent env, and
  // pin a UTF-8 locale so tmux keeps the TAB separator in `-F` output.
  const base = tmuxSpawnEnv();
  const result = Bun.spawnSync(["tmux", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...base, LC_ALL: pickTmuxLocale(base, detectUtf8Locale()) },
  });

  return {
    stdout: new TextDecoder().decode(result.stdout).trim(),
    stderr: new TextDecoder().decode(result.stderr).trim(),
    exitCode: result.exitCode,
  };
}

function assertTmuxOk(args: string[], action: string): string {
  const result = runTmux(args);
  if (result.exitCode !== 0) {
    throw new Error(`${action} failed: ${result.stderr || `tmux ${args.join(" ")} exit ${result.exitCode}`}`);
  }
  return result.stdout;
}

function isIgnorableKillWindowError(stderr: string): boolean {
  return stderr.includes("can't find window")
    || stderr.includes("can't find session")
    || stderr.includes("no server running")
    || (stderr.includes("error connecting to") && stderr.includes("No such file or directory"));
}

export function sanitizeTmuxNameSegment(value: string, maxLength = 24): string {
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
  const base = sanitizeTmuxNameSegment(basename(resolved), 18);
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

export function parseWindowSummaries(output: string): TmuxWindowSummary[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [sessionName = "", windowName = "", paneCountRaw = "0"] = line.split("\t");
      return {
        sessionName,
        windowName,
        paneCount: parseInt(paneCountRaw, 10) || 0,
      };
    })
    .filter((entry) => entry.sessionName.length > 0 && entry.windowName.length > 0);
}

export class BunTmuxGateway implements TmuxGateway {
  ensureServer(): void {
    assertTmuxOk(["start-server"], "tmux start-server");
  }

  ensureSession(sessionName: string, cwd: string): void {
    const check = runTmux(["has-session", "-t", sessionName]);
    if (check.exitCode !== 0) {
      assertTmuxOk(
        ["new-session", "-d", "-s", sessionName, "-c", cwd, ";", "set-option", "-t", sessionName, "destroy-unattached", "off"],
        `create tmux session ${sessionName}`,
      );
      this.scrubLeakedGlobalEnv();
      return;
    }

    assertTmuxOk(
      ["set-option", "-t", sessionName, "destroy-unattached", "off"],
      `set destroy-unattached off for ${sessionName}`,
    );
    this.scrubLeakedGlobalEnv();
  }

  /** Self-heal a tmux server that was already running with the launch project's
   *  `.env` keys in its global environment (e.g. a server started by an older
   *  webmux that predates the stripped-env spawn). Removing them from the global
   *  environment cleans every pane created afterwards, in existing and new
   *  sessions alike. Runs once the server is known to be up (`exit-empty` means a
   *  server only persists after a session exists). Tolerant: unsetting a key that
   *  is absent is a no-op.
   *
   *  Runs at most once per backend process: once the global env is scrubbed,
   *  stripped-env spawns keep it clean, so re-scrubbing on every session-ensure /
   *  reconciliation pass would be pure overhead (a tmux spawn per leaked key). */
  private scrubLeakedGlobalEnv(): void {
    if (globalEnvScrubbed) return;
    globalEnvScrubbed = true;
    for (const key of leakedProjectEnvKeys()) {
      runTmux(["set-environment", "-gu", key]);
    }
  }

  hasWindow(sessionName: string, windowName: string): boolean {
    const result = runTmux(["list-windows", "-t", sessionName, "-F", "#{window_name}"]);
    if (result.exitCode !== 0) return false;
    return result.stdout.split("\n").some((line) => line.trim() === windowName);
  }

  killWindow(sessionName: string, windowName: string): void {
    const result = runTmux(["kill-window", "-t", `${sessionName}:${windowName}`]);
    if (result.exitCode !== 0 && !isIgnorableKillWindowError(result.stderr)) {
      throw new Error(`kill tmux window ${sessionName}:${windowName} failed: ${result.stderr}`);
    }
  }

  createWindow(opts: {
    sessionName: string;
    windowName: string;
    cwd: string;
    command?: string;
  }): void {
    const args = ["new-window", "-d", "-t", opts.sessionName, "-n", opts.windowName, "-c", opts.cwd];
    if (opts.command) args.push(opts.command);
    assertTmuxOk(args, `create tmux window ${opts.sessionName}:${opts.windowName}`);
  }

  splitWindow(opts: {
    target: string;
    split: PaneSplit;
    sizePct?: number;
    cwd: string;
    command?: string;
  }): void {
    const args = ["split-window", "-t", opts.target, opts.split === "right" ? "-h" : "-v", "-c", opts.cwd];
    if (opts.sizePct !== undefined) args.push("-l", `${opts.sizePct}%`);
    if (opts.command) args.push(opts.command);
    assertTmuxOk(args, `split tmux window at ${opts.target}`);
  }

  setWindowOption(sessionName: string, windowName: string, option: string, value: string): void {
    assertTmuxOk(
      ["set-window-option", "-t", `${sessionName}:${windowName}`, option, value],
      `set tmux option ${option} on ${sessionName}:${windowName}`,
    );
  }

  runCommand(target: string, command: string): void {
    assertTmuxOk(["send-keys", "-t", target, "-l", "--", command], `send tmux command to ${target}`);
    assertTmuxOk(["send-keys", "-t", target, "C-m"], `submit tmux command on ${target}`);
  }

  selectPane(target: string): void {
    assertTmuxOk(["select-pane", "-t", target], `select tmux pane ${target}`);
  }

  listWindows(): TmuxWindowSummary[] {
    const output = assertTmuxOk(
      ["list-windows", "-a", "-F", "#{session_name}\t#{window_name}\t#{window_panes}"],
      "list tmux windows",
    );
    return parseWindowSummaries(output);
  }

  getPaneId(target: string): string {
    return assertTmuxOk(
      ["display-message", "-p", "-t", target, "#{pane_id}"],
      `resolve tmux pane id for ${target}`,
    );
  }

  createParkedPane(opts: { sessionName: string; parkingWindow: string; cwd: string; command: string }): string {
    if (!this.hasWindow(opts.sessionName, opts.parkingWindow)) {
      return assertTmuxOk(
        ["new-window", "-d", "-P", "-F", "#{pane_id}", "-t", opts.sessionName, "-n", opts.parkingWindow, "-c", opts.cwd, opts.command],
        `create parking window ${opts.sessionName}:${opts.parkingWindow}`,
      );
    }
    return assertTmuxOk(
      ["split-window", "-d", "-P", "-F", "#{pane_id}", "-t", `${opts.sessionName}:${opts.parkingWindow}`, "-c", opts.cwd, opts.command],
      `create parked pane in ${opts.sessionName}:${opts.parkingWindow}`,
    );
  }

  swapPanes(source: string, destination: string): void {
    assertTmuxOk(["swap-pane", "-s", source, "-t", destination], `swap tmux panes ${source} <-> ${destination}`);
  }

  killPane(target: string): void {
    const result = runTmux(["kill-pane", "-t", target]);
    if (result.exitCode !== 0 && !result.stderr.includes("can't find pane") && !isIgnorableKillWindowError(result.stderr)) {
      throw new Error(`kill tmux pane ${target} failed: ${result.stderr}`);
    }
  }
}
