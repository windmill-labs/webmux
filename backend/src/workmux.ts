import { $ } from "bun";
import { startForwarding, stopForwarding } from "./socat";
import { readEnvLocal } from "./env";
import { expandTemplate, type ProfileConfig } from "./config";

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

export async function listWorktrees(): Promise<Worktree[]> {
  const result = await $`workmux list`.text();
  return parseTable(result, (cols) => ({
    branch: cols[0] ?? "",
    agent: cols[1] ?? "",
    mux: cols[2] ?? "",
    unmerged: cols[3] ?? "",
    path: cols[4] ?? "",
  }));
}

export async function getStatus(): Promise<WorktreeStatus[]> {
  const result = await $`workmux status`.text();
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

function buildAgentCmd(env: Record<string, string>, agent: string, profileConfig: ProfileConfig): string {
  const systemPrompt = profileConfig.systemPrompt
    ? expandTemplate(profileConfig.systemPrompt, env)
    : "";
  const innerEscaped = systemPrompt.replace(/["\\$`]/g, "\\$&");
  const isSandbox = profileConfig.sandbox === true;
  const prefix = isSandbox ? "workmux sandbox agent -- " : "";

  if (agent === "codex") {
    return systemPrompt
      ? `${prefix}codex --yolo -c '"developer_instructions=${innerEscaped}"'`
      : `${prefix}codex --yolo`;
  }
  const skipPerms = isSandbox ? " --dangerously-skip-permissions" : "";
  return systemPrompt
    ? `${prefix}claude${skipPerms} --append-system-prompt '"${innerEscaped}"'`
    : `${prefix}claude${skipPerms}`;
}

function ensureTmux(): void {
  const check = Bun.spawnSync(["tmux", "list-sessions"], { stdout: "pipe", stderr: "pipe" });
  if (check.exitCode !== 0) {
    Bun.spawnSync(["tmux", "new-session", "-d", "-s", "0"]);
    console.log("[workmux] restarted tmux session");
  }
}

export async function addWorktree(
  branch: string,
  opts?: { prompt?: string; profile?: string; agent?: string; profileConfig?: ProfileConfig }
): Promise<string> {
  ensureTmux();
  const profile = opts?.profile ?? "Full";
  const agent = opts?.agent ?? "claude";
  const profileConfig = opts?.profileConfig;
  const isSandbox = profileConfig?.sandbox === true;
  const hasSystemPrompt = !!profileConfig?.systemPrompt;
  const args: string[] = ["workmux", "add", "-b"]; // -b = background (don't switch tmux)

  // Skip default pane commands for profiles with a system prompt (custom pane setup)
  if (hasSystemPrompt) {
    args.push("-C"); // --no-pane-cmds
  }

  // Enable sandbox if profile says so
  if (isSandbox) {
    args.push("-S"); // --sandbox
  }

  if (opts?.prompt) args.push("-p", opts.prompt);
  args.push(branch);

  console.log(`[workmux:add] running: ${args.join(" ")}`);
  const result = await runChecked(args);
  console.log(`[workmux:add] result: ${result}`);

  const windowTarget = `wm-${branch}`;

  // Read worktree dir and log assigned ports
  const wtDirResult = Bun.spawnSync(
    ["tmux", "display-message", "-t", `${windowTarget}.0`, "-p", "#{pane_current_path}"],
    { stdout: "pipe" }
  );
  const wtDir = new TextDecoder().decode(wtDirResult.stdout).trim();
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
    // Build and send agent command
    const agentCmd = buildAgentCmd(env, agent, profileConfig);
    console.log(`[workmux] sending command to ${windowTarget}.0:\n${agentCmd}`);
    Bun.spawnSync(["tmux", "send-keys", "-t", `${windowTarget}.0`, agentCmd, "Enter"]);
    // Open a shell pane on the right (1/3 width) in the worktree dir
    Bun.spawnSync(["tmux", "split-window", "-h", "-t", `${windowTarget}.0`, "-l", "25%", "-c", wtDir]);
    // Keep focus on the agent pane (left)
    Bun.spawnSync(["tmux", "select-pane", "-t", `${windowTarget}.0`]);

    // Start socat port forwarding for sandbox containers (non-blocking).
    if (isSandbox && wtDir) {
      (async () => {
        console.log(`[socat] waiting for container to start for ${branch}...`);
        for (let i = 1; i <= 15; i++) {
          await new Promise(r => setTimeout(r, 2000));
          if (await startForwarding(branch, wtDir)) return;
          console.log(`[socat] container not ready for ${branch}, retrying (${i}/15)...`);
        }
        console.error(`[socat] gave up waiting for container for ${branch} after 30s`);
      })();
    }
  }

  return result;
}

export async function removeWorktree(name: string): Promise<string> {
  console.log(`[workmux:rm] running: workmux rm --force ${name}`);
  stopForwarding(name);
  const result = await runChecked(["workmux", "rm", "--force", name]);
  console.log(`[workmux:rm] result: ${result}`);
  return result;
}

export async function openWorktree(name: string): Promise<string> {
  return runChecked(["workmux", "open", name]);
}

export async function mergeWorktree(name: string): Promise<string> {
  console.log(`[workmux:merge] running: workmux merge ${name}`);
  stopForwarding(name);
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
