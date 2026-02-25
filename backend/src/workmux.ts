import { $ } from "bun";
import { readEnvLocal } from "./env";
import { expandTemplate, type ProfileConfig, type SandboxProfileConfig, type ServiceConfig } from "./config";
import { launchContainer, removeContainer } from "./docker";

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

function parseTable<T>(output: string, mapper: (cols: string[]) => T): T[] {
  const lines = output.trim().split("\n").filter(Boolean);
  if (lines.length < 2) return [];

  const headerLine = lines[0];

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
  }));
}

export async function getStatus(): Promise<WorktreeStatus[]> {
  const result = await $`workmux status`.env(workmuxEnv()).text();
  return parseTable(result, (cols) => ({
    worktree: cols[0] ?? "",
    status: cols[1] ?? "",
    elapsed: cols[2] ?? "",
    title: cols[3] ?? "",
  }));
}

async function runChecked(args: string[]): Promise<string> {
  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const msg = `${args.join(" ")} failed (exit ${exitCode}): ${stderr || stdout}`;
    console.error(`[workmux:exec] ${msg}`);
    throw new Error(msg);
  }
  return stdout.trim();
}

export { readEnvLocal } from "./env";

function buildAgentCmd(env: Record<string, string>, agent: string, profileConfig: ProfileConfig, isSandbox: boolean): string {
  const systemPrompt = profileConfig.systemPrompt
    ? expandTemplate(profileConfig.systemPrompt, env)
    : "";
  const innerEscaped = systemPrompt.replace(/["\\$`]/g, "\\$&");

  // For sandbox, env is passed via Docker -e flags, no inline prefix needed.
  // For non-sandbox, build inline env prefix for passthrough vars.
  const envPrefix = !isSandbox && profileConfig.envPassthrough?.length
    ? buildEnvPrefix(profileConfig.envPassthrough)
    : "";

  if (agent === "codex") {
    return systemPrompt
      ? `${envPrefix}codex --yolo -c '"developer_instructions=${innerEscaped}"'`
      : `${envPrefix}codex --yolo`;
  }
  const skipPerms = isSandbox ? " --dangerously-skip-permissions" : "";
  return systemPrompt
    ? `${envPrefix}claude${skipPerms} --append-system-prompt '"${innerEscaped}"'`
    : `${envPrefix}claude${skipPerms}`;
}

/** Build an inline env prefix (e.g. "KEY=val KEY2=val2 ") for vars listed in envPassthrough. */
function buildEnvPrefix(keys: string[]): string {
  const parts: string[] = [];
  for (const key of keys) {
    const val = process.env[key];
    if (val) {
      const escaped = val.replace(/'/g, "'\\''");
      parts.push(`${key}='${escaped}'`);
    }
  }
  return parts.length > 0 ? parts.join(" ") + " " : "";
}

/** Find the on-disk path for a worktree branch via `git worktree list`. */
function findWorktreeDir(branch: string): string {
  const result = Bun.spawnSync(["git", "worktree", "list", "--porcelain"], { stdout: "pipe" });
  const output = new TextDecoder().decode(result.stdout);
  let currentPath = "";
  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      currentPath = line.slice("worktree ".length);
    } else if (line.startsWith("branch ")) {
      const name = line.slice("branch ".length).replace("refs/heads/", "");
      if (name === branch || currentPath.endsWith(`/${branch}`)) {
        return currentPath;
      }
    }
  }
  return "";
}

function ensureTmux(): void {
  const check = Bun.spawnSync(["tmux", "list-sessions"], { stdout: "pipe", stderr: "pipe" });
  if (check.exitCode !== 0) {
    Bun.spawnSync(["tmux", "new-session", "-d", "-s", "0"]);
    console.log("[workmux] restarted tmux session");
  }
}

/** Sanitize user input into a valid git branch name. */
function sanitizeBranchName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[~^:?*\[\]\\]+/g, "")
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

/** Parse "Branch: <name>" from workmux add output. */
function parseBranchFromOutput(output: string): string | null {
  const match = output.match(/Branch:\s*(\S+)/);
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

export interface AddWorktreeResult {
  branch: string;
  output: string;
}

export async function addWorktree(
  rawBranch: string | undefined,
  opts?: AddWorktreeOpts
): Promise<AddWorktreeResult> {
  ensureTmux();
  const profile = opts?.profile ?? "default";
  const agent = opts?.agent ?? "claude";
  const profileConfig = opts?.profileConfig;
  const isSandbox = opts?.isSandbox === true;
  const hasSystemPrompt = !!profileConfig?.systemPrompt;
  const args: string[] = ["workmux", "add", "-b"]; // -b = background (don't switch tmux)

  // Skip default pane commands for profiles with a system prompt (custom pane setup)
  if (hasSystemPrompt) {
    args.push("-C"); // --no-pane-cmds
  }

  // No -S flag — we manage Docker ourselves

  if (opts?.prompt) args.push("-p", opts.prompt);

  // Branch name resolution:
  // 1. User provided a name → sanitize and use it
  // 2. No name + prompt + autoName → let workmux generate via -A
  // 3. No name + (no prompt or no autoName) → random
  const useAutoName = !rawBranch && !!opts?.prompt && !!opts?.autoName;
  let branch = "";

  if (rawBranch) {
    branch = sanitizeBranchName(rawBranch);
    args.push(branch);
  } else if (useAutoName) {
    args.push("-A");
  } else {
    branch = randomName(8);
    args.push(branch);
  }

  console.log(`[workmux:add] running: ${args.join(" ")}`);
  const result = await runChecked(args);
  console.log(`[workmux:add] result: ${result}`);

  // When using -A, extract the branch name from workmux output
  if (useAutoName) {
    const parsed = parseBranchFromOutput(result);
    if (!parsed) throw new Error("Failed to parse branch name from workmux output");
    branch = parsed;
  }

  const windowTarget = `wm-${branch}`;

  // Read worktree dir from git (tmux pane may not have cd'd yet with -C)
  const wtDir = findWorktreeDir(branch);
  const env = readEnvLocal(wtDir);
  console.log(`[workmux:add] branch=${branch} dir=${wtDir} env=${JSON.stringify(env)}`);

  // Append profile to .env.local (worktree-env creates it, we just add to it)
  if (wtDir) {
    const envPath = `${wtDir}/.env.local`;
    const existing = await Bun.file(envPath).text().catch(() => "");
    if (!existing.includes("PROFILE=")) {
      await Bun.write(envPath, existing.trimEnd() + `\nPROFILE=${profile}\nAGENT=${agent}\n`);
    }
  }

  // For profiles with a system prompt, kill extra panes and send commands
  if (hasSystemPrompt && profileConfig) {
    // Kill extra panes (highest index first to avoid shifting)
    const paneCountResult = Bun.spawnSync(
      ["tmux", "list-panes", "-t", windowTarget, "-F", "#{pane_index}"],
      { stdout: "pipe" }
    );
    const paneIds = new TextDecoder().decode(paneCountResult.stdout).trim().split("\n");
    // Kill all panes except pane 0
    for (let i = paneIds.length - 1; i >= 1; i--) {
      Bun.spawnSync(["tmux", "kill-pane", "-t", `${windowTarget}.${paneIds[i]}`]);
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

    // Build and send agent command
    const agentCmd = buildAgentCmd(env, agent, profileConfig, isSandbox);

    if (containerName) {
      // Sandbox: enter container, run entrypoint visibly, then start agent
      const dockerExec = `docker exec -it -w ${wtDir} ${containerName} bash`;
      Bun.spawnSync(["tmux", "send-keys", "-t", `${windowTarget}.0`, dockerExec, "Enter"]);
      // Wait for shell to be ready, then chain entrypoint → agent
      Bun.spawnSync(["sleep", "0.5"]);
      const entrypointThenAgent = `/usr/local/bin/entrypoint.sh && ${agentCmd}`;
      console.log(`[workmux] sending to ${windowTarget}.0:\n${entrypointThenAgent}`);
      Bun.spawnSync(["tmux", "send-keys", "-t", `${windowTarget}.0`, entrypointThenAgent, "Enter"]);
      // Shell pane: host shell in worktree dir
      Bun.spawnSync(["tmux", "split-window", "-h", "-t", `${windowTarget}.0`, "-l", "25%", "-c", wtDir]);
    } else {
      // Non-sandbox: run agent directly in pane 0
      console.log(`[workmux] sending command to ${windowTarget}.0:\n${agentCmd}`);
      Bun.spawnSync(["tmux", "send-keys", "-t", `${windowTarget}.0`, agentCmd, "Enter"]);
      // Open a shell pane on the right (1/3 width) in the worktree dir
      Bun.spawnSync(["tmux", "split-window", "-h", "-t", `${windowTarget}.0`, "-l", "25%", "-c", wtDir]);
    }
    // Keep focus on the agent pane (left)
    Bun.spawnSync(["tmux", "select-pane", "-t", `${windowTarget}.0`]);
  }

  return { branch, output: result };
}

export async function removeWorktree(name: string): Promise<string> {
  console.log(`[workmux:rm] running: workmux rm --force ${name}`);
  await removeContainer(name);
  const result = await runChecked(["workmux", "rm", "--force", name]);
  console.log(`[workmux:rm] result: ${result}`);
  return result;
}

export function sendPrompt(
  branch: string,
  text: string,
  pane = 0,
  preamble?: string,
): { ok: true } | { ok: false; error: string } {
  const windowName = `wm-${branch}`;
  const session = findWorktreeSession(windowName);
  if (!session) {
    return { ok: false, error: `tmux window "${windowName}" not found` };
  }
  const target = `${session}:${windowName}.${pane}`;

  // Type the preamble as regular keystrokes so it shows inline in the agent,
  // then paste the bulk payload via a tmux buffer (appears as [pasted text]).
  if (preamble) {
    const pre = Bun.spawnSync(["tmux", "send-keys", "-t", target, "-l", "--", preamble], { stderr: "pipe" });
    if (pre.exitCode !== 0) {
      const stderr = new TextDecoder().decode(pre.stderr).trim();
      return { ok: false, error: `send-keys preamble failed (exit ${pre.exitCode})${stderr ? `: ${stderr}` : ""}` };
    }
  }

  const cleaned = text.replace(/\0/g, "");

  // Use a unique buffer name per invocation to avoid races when concurrent
  // sendPrompt calls overlap (e.g. two worktrees sending at the same time).
  const bufName = `wm-prompt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  // Load text into a named tmux buffer via stdin — avoids all send-keys
  // escaping/chunking issues and handles any text size in a single operation.
  const load = Bun.spawnSync(["tmux", "load-buffer", "-b", bufName, "-"], {
    stdin: new TextEncoder().encode(cleaned),
    stderr: "pipe",
  });
  if (load.exitCode !== 0) {
    const stderr = new TextDecoder().decode(load.stderr).trim();
    return { ok: false, error: `load-buffer failed (exit ${load.exitCode})${stderr ? `: ${stderr}` : ""}` };
  }

  // Paste buffer into target pane; -d deletes the buffer after pasting.
  const paste = Bun.spawnSync(["tmux", "paste-buffer", "-b", bufName, "-t", target, "-d"], {
    stderr: "pipe",
  });
  if (paste.exitCode !== 0) {
    const stderr = new TextDecoder().decode(paste.stderr).trim();
    return { ok: false, error: `paste-buffer failed (exit ${paste.exitCode})${stderr ? `: ${stderr}` : ""}` };
  }

  // Submit
  const enter = Bun.spawnSync(["tmux", "send-keys", "-t", target, "Enter"], { stderr: "pipe" });
  if (enter.exitCode !== 0) {
    const stderr = new TextDecoder().decode(enter.stderr).trim();
    return { ok: false, error: `send-keys Enter failed (exit ${enter.exitCode})${stderr ? `: ${stderr}` : ""}` };
  }

  return { ok: true };
}

function findWorktreeSession(windowName: string): string | null {
  const result = Bun.spawnSync(
    ["tmux", "list-windows", "-a", "-F", "#{session_name}:#{window_name}"],
    { stdout: "pipe", stderr: "pipe" }
  );
  if (result.exitCode !== 0) return null;
  const output = new TextDecoder().decode(result.stdout).trim();
  if (!output) return null;
  for (const line of output.split("\n")) {
    const [session, name] = line.split(":");
    if (name === windowName) return session ?? null;
  }
  return null;
}

export async function openWorktree(name: string): Promise<string> {
  return runChecked(["workmux", "open", name]);
}

export async function mergeWorktree(name: string): Promise<string> {
  console.log(`[workmux:merge] running: workmux merge ${name}`);
  await removeContainer(name);
  const result = await runChecked(["workmux", "merge", name]);
  console.log(`[workmux:merge] result: ${result}`);
  return result;
}

export async function getTmuxSession(): Promise<string> {
  try {
    const result = await $`tmux list-windows -a -F "#{session_name}:#{window_name}"`.text();
    for (const line of result.trim().split("\n")) {
      const [session, window] = line.split(":");
      if (window?.startsWith("wm-")) {
        return session!;
      }
    }
  } catch {
    // No tmux server running
  }
  return "0";
}
