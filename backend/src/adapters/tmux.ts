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

let cachedTmuxSpawnEnv: { value: Record<string, string> | undefined } | null = null;
let globalEnvScrubbed = false;

/** Environment for spawning tmux control commands, stripped of the launch
 *  project's `.env` keys (see {@link stripProjectEnv}). Whichever tmux command
 *  first starts the server fixes the global environment for the server's
 *  lifetime, so every tmux invocation must use the stripped env. Returns
 *  `undefined` (inherit the process env unchanged) on the common path where no
 *  project keys were loaded, so tmux spawns don't copy the whole env for
 *  nothing. */
function tmuxSpawnEnv(): Record<string, string> | undefined {
  if (cachedTmuxSpawnEnv) return cachedTmuxSpawnEnv.value;
  const value = Bun.env.WEBMUX_PROJECT_ENV_KEYS ? stripProjectEnv(Bun.env) : undefined;
  cachedTmuxSpawnEnv = { value };
  return value;
}

function runTmux(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  // Only pass `env` when we have a stripped copy: Bun.spawnSync treats an
  // explicit `env: undefined` as an *empty* environment, not "inherit".
  const spawnEnv = tmuxSpawnEnv();
  const result = Bun.spawnSync(["tmux", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    ...(spawnEnv ? { env: spawnEnv } : {}),
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
