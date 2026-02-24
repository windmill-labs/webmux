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

function ensureTmux(): void {
  const check = Bun.spawnSync(["tmux", "list-sessions"], { stdout: "pipe", stderr: "pipe" });
  if (check.exitCode !== 0) {
    Bun.spawnSync(["tmux", "new-session", "-d", "-s", "0"]);
    console.log("[workmux] restarted tmux session");
  }
}

export interface AddWorktreeOpts {
  prompt?: string;
  profile?: string;
  agent?: string;
  profileConfig?: ProfileConfig;
  isSandbox?: boolean;
  sandboxConfig?: SandboxProfileConfig;
  services?: ServiceConfig[];
  mainRepoDir?: string;
}

export async function addWorktree(
  branch: string,
  opts?: AddWorktreeOpts
): Promise<string> {
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

  return result;
}

export async function removeWorktree(name: string): Promise<string> {
  console.log(`[workmux:rm] running: workmux rm --force ${name}`);
  await removeContainer(name);
  const result = await runChecked(["workmux", "rm", "--force", name]);
  console.log(`[workmux:rm] result: ${result}`);
  return result;
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
