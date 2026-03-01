import { $ } from "bun";
import { readEnvLocal, writeEnvLocal, readAllWorktreeEnvs, allocatePorts } from "./env";
import { expandTemplate, type ProfileConfig, type SandboxProfileConfig, type ServiceConfig } from "./config";
import { launchContainer, removeContainer } from "./docker";
import { log } from "./lib/log";

export interface Worktree {
  branch: string;
  agent: string;
  mux: string;
  unmerged: string;
  path: string;
}

export interface WorktreeStatus {
  worktree: string;
  status: string;
  elapsed: string;
  title: string;
}

const WORKTREE_HEADERS = ["BRANCH", "AGENT", "MUX", "UNMERGED", "PATH"] as const;
const STATUS_HEADERS   = ["WORKTREE", "STATUS", "ELAPSED", "TITLE"] as const;

function parseTable<T>(
  output: string,
  mapper: (cols: string[]) => T,
  expectedHeaders?: readonly string[],
): T[] {
  const lines = output.trim().split("\n").filter(Boolean);
  if (lines.length < 2) return [];

  const headerLine = lines[0];

  if (expectedHeaders) {
    const actual = headerLine.trim().split(/\s+/).map(h => h.toUpperCase());
    const match = expectedHeaders.every((h, i) => actual[i] === h.toUpperCase());
    if (!match) {
      log.warn(`[parseTable] unexpected headers: got [${actual.join(", ")}], expected [${expectedHeaders.join(", ")}]`);
    }
  }

  // Find column positions based on header spacing
  const colStarts: number[] = [];
  let inSpace = true;
  for (let i = 0; i < headerLine.length; i++) {
    if (headerLine[i] !== " " && inSpace) {
      colStarts.push(i);
      inSpace = false;
    } else if (headerLine[i] === " " && !inSpace) {
      inSpace = true;
    }
  }

  return lines.slice(1).map(line => {
    const cols = colStarts.map((start, idx) => {
      const end = idx + 1 < colStarts.length ? colStarts[idx + 1] : line.length;
      return line.slice(start, end).trim();
    });
    return mapper(cols);
  });
}

/** Build env with TMUX set so workmux can resolve agent states outside tmux. */
function workmuxEnv(): Record<string, string | undefined> {
  if (process.env.TMUX) return process.env;
  const tmpdir = process.env.TMUX_TMPDIR || "/tmp";
  const uid = process.getuid?.() ?? 1000;
  return { ...process.env, TMUX: `${tmpdir}/tmux-${uid}/default,0,0` };
}

export async function listWorktrees(): Promise<Worktree[]> {
  const result = await $`workmux list`.env(workmuxEnv()).text();
  return parseTable(result, (cols) => ({
    branch: cols[0] ?? "",
    agent: cols[1] ?? "",
    mux: cols[2] ?? "",
    unmerged: cols[3] ?? "",
    path: cols[4] ?? "",
  }), WORKTREE_HEADERS);
}

export async function getStatus(): Promise<WorktreeStatus[]> {
  const result = await $`workmux status`.env(workmuxEnv()).text();
  return parseTable(result, (cols) => ({
    worktree: cols[0] ?? "",
    status: cols[1] ?? "",
    elapsed: cols[2] ?? "",
    title: cols[3] ?? "",
  }), STATUS_HEADERS);
}

async function tryExec(args: string[]): Promise<{ ok: true; stdout: string } | { ok: false; error: string }> {
  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const msg = `${args.join(" ")} failed (exit ${exitCode}): ${stderr || stdout}`;
    log.error(`[workmux:exec] ${msg}`);
    return { ok: false, error: msg };
  }
  return { ok: true, stdout: stdout.trim() };
}

export { readEnvLocal } from "./env";

function buildAgentCmd(env: Record<string, string>, agent: string, profileConfig: ProfileConfig, isSandbox: boolean, prompt?: string): string {
  const systemPrompt = profileConfig.systemPrompt
    ? expandTemplate(profileConfig.systemPrompt, env)
    : "";
  // Escape for double-quoted shell context: backslash, double-quote, dollar, backtick.
  const innerEscaped = systemPrompt.replace(/["\\$`]/g, "\\$&");
  const promptEscaped = prompt ? prompt.replace(/["\\$`]/g, "\\$&") : "";

  // For sandbox, env is passed via Docker -e flags, no inline prefix needed.
  // For non-sandbox, build inline env prefix for passthrough vars.
  // Merge host env with worktree env; worktree env takes precedence.
  const envPrefix = !isSandbox && profileConfig.envPassthrough?.length
    ? buildEnvPrefix(profileConfig.envPassthrough, { ...process.env, ...env })
    : "";

  const promptSuffix = promptEscaped ? ` "${promptEscaped}"` : "";

  if (agent === "codex") {
    return systemPrompt
      ? `${envPrefix}codex --yolo -c "developer_instructions=${innerEscaped}"${promptSuffix}`
      : `${envPrefix}codex --yolo${promptSuffix}`;
  }
  const skipPerms = isSandbox ? " --dangerously-skip-permissions" : "";
  return systemPrompt
    ? `${envPrefix}claude${skipPerms} --append-system-prompt "${innerEscaped}"${promptSuffix}`
    : `${envPrefix}claude${skipPerms}${promptSuffix}`;
}

/** Build an inline env prefix (e.g. "KEY='val' KEY2='val2' ") for vars listed in envPassthrough. */
function buildEnvPrefix(keys: string[], env: Record<string, string | undefined>): string {
  const parts: string[] = [];
  for (const key of keys) {
    const val = env[key];
    if (val) {
      const escaped = val.replace(/'/g, "'\\''");
      parts.push(`${key}='${escaped}'`);
    }
  }
  return parts.length > 0 ? parts.join(" ") + " " : "";
}

/**
 * Pure: parse `git worktree list --porcelain` output into a branch→path map.
 * Detached HEAD entries (line === "detached") are skipped — they have no branch
 * name to key on.
 */
export function parseWorktreePorcelain(output: string): Map<string, string> {
  const paths = new Map<string, string>();
  let currentPath = "";
  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      currentPath = line.slice("worktree ".length);
    } else if (line.startsWith("branch ")) {
      const name = line.slice("branch ".length).replace("refs/heads/", "");
      if (currentPath) paths.set(name, currentPath);
    }
  }
  return paths;
}

/** Find the on-disk path for a worktree branch via `git worktree list`. */
function findWorktreeDir(branch: string): string | null {
  const result = Bun.spawnSync(["git", "worktree", "list", "--porcelain"], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    log.warn(`[workmux] git worktree list failed (exit ${result.exitCode})`);
    return null;
  }
  const output = new TextDecoder().decode(result.stdout);
  return parseWorktreePorcelain(output).get(branch) ?? null;
}

function ensureTmux(): void {
  const check = Bun.spawnSync(["tmux", "list-sessions"], { stdout: "pipe", stderr: "pipe" });
  if (check.exitCode !== 0) {
    const started = Bun.spawnSync(["tmux", "new-session", "-d", "-s", "0"]);
    if (started.exitCode !== 0) {
      log.debug("[workmux] tmux session already exists (concurrent start)");
    } else {
      log.debug("[workmux] restarted tmux session");
    }
  }
}

/** Sanitize user input into a valid git branch name. */
function sanitizeBranchName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[~^:?*\[\]\\]+/g, "")
    .replace(/@\{/g, "")
    .replace(/\.{2,}/g, ".")
    .replace(/\/{2,}/g, "/")
    .replace(/-{2,}/g, "-")
    .replace(/^[.\-/]+|[.\-/]+$/g, "")
    .replace(/\.lock$/i, "");
}

function randomName(len: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < len; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

/** Parse branch name from workmux add output (e.g. "Branch: my-feature"). */
function parseBranchFromOutput(output: string): string | null {
  const match = output.match(/branch:\s*(\S+)/i);
  return match?.[1] ?? null;
}

export interface AddWorktreeOpts {
  prompt?: string;
  profile?: string;
  agent?: string;
  autoName?: boolean;
  profileConfig?: ProfileConfig;
  isSandbox?: boolean;
  sandboxConfig?: SandboxProfileConfig;
  services?: ServiceConfig[];
  mainRepoDir?: string;
}

export async function addWorktree(
  rawBranch: string | undefined,
  opts?: AddWorktreeOpts
): Promise<{ ok: true; branch: string; output: string } | { ok: false; error: string }> {
  ensureTmux();
  const profile = opts?.profile ?? "default";
  const agent = opts?.agent ?? "claude";
  const profileConfig = opts?.profileConfig;
  const isSandbox = opts?.isSandbox === true;
  const hasSystemPrompt = !!profileConfig?.systemPrompt;
  const args: string[] = ["workmux", "add", "-b"]; // -b = background (don't switch tmux)
  let branch = "";
  let useAutoName = false;

  if (isSandbox) {
    // Sandbox: we manage panes ourselves, don't pass -p (we pass prompt to claude directly)
    args.push("-C"); // --no-pane-cmds
    // No -p: workmux can't use it with -C
    // No -A: auto-name needs -p which we can't pass
    if (rawBranch) {
      branch = sanitizeBranchName(rawBranch);
      if (!branch) {
        return { ok: false, error: `"${rawBranch}" is not a valid branch name after sanitization` };
      }
    } else {
      branch = randomName(8);
    }
    args.push(branch);
  } else {
    // Non-sandbox: skip default pane commands for profiles with a system prompt (custom pane setup)
    if (hasSystemPrompt) {
      args.push("-C"); // --no-pane-cmds
    }

    if (opts?.prompt) args.push("-p", opts.prompt);

    // Branch name resolution:
    // 1. User provided a name → sanitize and use it
    // 2. No name + prompt + autoName → let workmux generate via -A
    // 3. No name + (no prompt or no autoName) → random
    useAutoName = !rawBranch && !!opts?.prompt && !!opts?.autoName;

    if (rawBranch) {
      branch = sanitizeBranchName(rawBranch);
      if (!branch) {
        return { ok: false, error: `"${rawBranch}" is not a valid branch name after sanitization` };
      }
      args.push(branch);
    } else if (useAutoName) {
      args.push("-A");
    } else {
      branch = randomName(8);
      args.push(branch);
    }
  }

  log.debug(`[workmux:add] running: ${args.join(" ")}`);
  const execResult = await tryExec(args);
  if (!execResult.ok) return { ok: false, error: execResult.error };
  const result = execResult.stdout;

  // When using -A, extract the branch name from workmux output
  if (useAutoName) {
    const parsed = parseBranchFromOutput(result);
    if (!parsed) {
      return { ok: false, error: `Failed to parse branch name from workmux output: ${JSON.stringify(result)}` };
    }
    branch = parsed;
  }

  const windowTarget = `wm-${branch}`;

  // Read worktree dir from git (tmux pane may not have cd'd yet with -C)
  const wtDir = findWorktreeDir(branch);

  // Allocate ports + write PROFILE/AGENT to .env.local
  if (wtDir) {
    const porcelainResult = Bun.spawnSync(["git", "worktree", "list", "--porcelain"], { stdout: "pipe", stderr: "pipe" });
    const allPaths = [...parseWorktreePorcelain(new TextDecoder().decode(porcelainResult.stdout)).values()];
    const existingEnvs = await readAllWorktreeEnvs(allPaths, wtDir);
    const portAssignments = opts?.services ? allocatePorts(existingEnvs, opts.services) : {};
    await writeEnvLocal(wtDir, { ...portAssignments, PROFILE: profile, AGENT: agent });
  }

  const env = wtDir ? await readEnvLocal(wtDir) : {};
  log.debug(`[workmux:add] branch=${branch} dir=${wtDir ?? "(not found)"} env=${JSON.stringify(env)}`);

  // For profiles with a system prompt, kill extra panes and send commands
  if (hasSystemPrompt && profileConfig) {
    // Kill extra panes (highest index first to avoid shifting)
    const paneCountResult = Bun.spawnSync(
      ["tmux", "list-panes", "-t", windowTarget, "-F", "#{pane_index}"],
      { stdout: "pipe", stderr: "pipe" }
    );
    if (paneCountResult.exitCode === 0) {
      const paneIds = new TextDecoder().decode(paneCountResult.stdout).trim().split("\n");
      // Kill all panes except pane 0
      for (let i = paneIds.length - 1; i >= 1; i--) {
        Bun.spawnSync(["tmux", "kill-pane", "-t", `${windowTarget}.${paneIds[i]}`]);
      }
    }

    // Launch Docker container for sandbox worktrees
    let containerName: string | undefined;
    if (isSandbox && opts?.sandboxConfig && wtDir) {
      const mainRepoDir = opts.mainRepoDir ?? process.cwd();
      containerName = await launchContainer({
        branch,
        wtDir,
        mainRepoDir,
        sandboxConfig: opts.sandboxConfig,
        services: opts.services ?? [],
        env,
      });
    }

    // Build and send agent command (pass prompt for sandbox — we handle it directly)
    const agentCmd = buildAgentCmd(env, agent, profileConfig, isSandbox, isSandbox ? opts?.prompt : undefined);

    if (containerName) {
      // Sandbox: enter container, run entrypoint visibly, then start agent
      const dockerExec = `docker exec -it -w ${wtDir} ${containerName} bash`;
      Bun.spawnSync(["tmux", "send-keys", "-t", `${windowTarget}.0`, dockerExec, "Enter"]);
      // Wait for shell to be ready, then chain entrypoint → agent
      await Bun.sleep(500);
      const entrypointThenAgent = `/usr/local/bin/entrypoint.sh && ${agentCmd}`;
      log.debug(`[workmux] sending to ${windowTarget}.0:\n${entrypointThenAgent}`);
      Bun.spawnSync(["tmux", "send-keys", "-t", `${windowTarget}.0`, entrypointThenAgent, "Enter"]);
      // Shell pane: host shell in worktree dir
      Bun.spawnSync(["tmux", "split-window", "-h", "-t", `${windowTarget}.0`, "-l", "25%", "-c", wtDir ?? process.cwd()]);
    } else {
      // Non-sandbox: run agent directly in pane 0
      log.debug(`[workmux] sending command to ${windowTarget}.0:\n${agentCmd}`);
      Bun.spawnSync(["tmux", "send-keys", "-t", `${windowTarget}.0`, agentCmd, "Enter"]);
      // Open a shell pane on the right (1/3 width) in the worktree dir
      Bun.spawnSync(["tmux", "split-window", "-h", "-t", `${windowTarget}.0`, "-l", "25%", "-c", wtDir ?? process.cwd()]);
    }
    // Keep focus on the agent pane (left)
    Bun.spawnSync(["tmux", "select-pane", "-t", `${windowTarget}.0`]);
  }

  return { ok: true, branch, output: result };
}

export async function removeWorktree(name: string): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
  log.debug(`[workmux:rm] running: workmux rm --force ${name}`);
  await removeContainer(name);
  const result = await tryExec(["workmux", "rm", "--force", name]);
  if (!result.ok) return result;
  return { ok: true, output: result.stdout };
}

const TMUX_TIMEOUT_MS = 5_000;

/** Run a tmux subprocess and await exit with a timeout. Kills the process on timeout. */
async function tmuxExec(args: string[], opts: { stdin?: Uint8Array } = {}): Promise<{ exitCode: number; stderr: string }> {
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
    return { exitCode: -1, stderr: "timed out after 5s (agent may be busy)" };
  }
  const stderr = (await new Response(proc.stderr).text()).trim();
  return { exitCode: result, stderr };
}

export async function sendPrompt(
  branch: string,
  text: string,
  pane = 0,
  preamble?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const windowName = `wm-${branch}`;
  const session = await findWorktreeSession(windowName);
  if (!session) {
    return { ok: false, error: `tmux window "${windowName}" not found` };
  }
  const target = `${session}:${windowName}.${pane}`;
  log.debug(`[send:${branch}] target=${target} textBytes=${text.length}${preamble ? ` preamble=${preamble.length}b` : ""}`);

  // Type the preamble as regular keystrokes so it shows inline in the agent,
  // then paste the bulk payload via a tmux buffer (appears as [pasted text]).
  if (preamble) {
    const { exitCode, stderr } = await tmuxExec(["tmux", "send-keys", "-t", target, "-l", "--", preamble]);
    if (exitCode !== 0) {
      return { ok: false, error: `send-keys preamble failed${stderr ? `: ${stderr}` : ""}` };
    }
  }

  const cleaned = text.replace(/\0/g, "");

  // Use a unique buffer name per invocation to avoid races when concurrent
  // sendPrompt calls overlap (e.g. two worktrees sending at the same time).
  const bufName = `wm-prompt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  // Load text into a named tmux buffer via stdin — avoids all send-keys
  // escaping/chunking issues and handles any text size in a single operation.
  const load = await tmuxExec(["tmux", "load-buffer", "-b", bufName, "-"], { stdin: new TextEncoder().encode(cleaned) });
  if (load.exitCode !== 0) {
    return { ok: false, error: `load-buffer failed${load.stderr ? `: ${load.stderr}` : ""}` };
  }

  // Paste buffer into target pane; -d deletes the buffer after pasting.
  const paste = await tmuxExec(["tmux", "paste-buffer", "-b", bufName, "-t", target, "-d"]);
  if (paste.exitCode !== 0) {
    return { ok: false, error: `paste-buffer failed${paste.stderr ? `: ${paste.stderr}` : ""}` };
  }

  return { ok: true };
}

async function findWorktreeSession(windowName: string): Promise<string | null> {
  const proc = Bun.spawn(
    ["tmux", "list-windows", "-a", "-F", "#{session_name}:#{window_name}"],
    { stdout: "pipe", stderr: "pipe" }
  );
  if (await proc.exited !== 0) return null;
  const output = (await new Response(proc.stdout).text()).trim();
  if (!output) return null;
  for (const line of output.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const session = line.slice(0, colonIdx);
    const name = line.slice(colonIdx + 1);
    if (name === windowName) return session;
  }
  return null;
}

export async function openWorktree(name: string): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
  const result = await tryExec(["workmux", "open", name]);
  if (!result.ok) return result;
  return { ok: true, output: result.stdout };
}

export async function mergeWorktree(name: string): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
  log.debug(`[workmux:merge] running: workmux merge ${name}`);
  await removeContainer(name);
  const result = await tryExec(["workmux", "merge", name]);
  if (!result.ok) return result;
  return { ok: true, output: result.stdout };
}

