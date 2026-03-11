import * as p from "@clack/prompts";
import { basename, resolve } from "node:path";
import { readWorktreeMeta } from "../../backend/src/adapters/fs";
import { buildProjectSessionName, buildWorktreeWindowName } from "../../backend/src/adapters/tmux";
import type { AgentKind } from "../../backend/src/domain/config";
import { isValidWorktreeName } from "../../backend/src/domain/policies";
import { createWebmuxRuntime } from "../../backend/src/runtime";
import type { CreateLifecycleWorktreeInput, PruneWorktreesResult } from "../../backend/src/services/lifecycle-service";

export type WorktreeSubcommand = "add" | "list" | "open" | "close" | "remove" | "merge" | "prune";

interface LifecycleServiceLike {
  createWorktree(input: CreateLifecycleWorktreeInput): Promise<{ branch: string; worktreeId: string }>;
  openWorktree(branch: string): Promise<{ branch: string; worktreeId: string }>;
  closeWorktree(branch: string): Promise<void>;
  removeWorktree(branch: string): Promise<void>;
  mergeWorktree(branch: string): Promise<void>;
  pruneWorktrees(): Promise<PruneWorktreesResult>;
}

interface WorktreeRuntimeLike {
  projectDir: string;
  config: {
    workspace: {
      mainBranch: string;
    };
  };
  git: {
    listWorktrees(cwd: string): Array<{ path: string; branch: string | null; bare: boolean }>;
    resolveWorktreeGitDir(cwd: string): string;
  };
  tmux: {
    listWindows(): Array<{ sessionName: string; windowName: string }>;
  };
  lifecycleService: LifecycleServiceLike;
}

interface WorktreeCommandContext {
  command: WorktreeSubcommand;
  args: string[];
  projectDir: string;
  port: number;
}

interface WorktreeCommandDependencies {
  createRuntime?: (options: { projectDir: string; port: number }) => WorktreeRuntimeLike;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
  switchToTmuxWindow?: (projectDir: string, branch: string) => void;
  confirmPrune?: (worktreeCount: number) => Promise<boolean>;
}

class CommandUsageError extends Error {}

export function getWorktreeCommandUsage(command: WorktreeSubcommand): string {
  switch (command) {
    case "add":
      return [
        "Usage:",
        "  webmux add [branch] [--profile <name>] [--agent <claude|codex>] [--prompt <text>] [--env KEY=VALUE]",
        "",
        "Options:",
        "  --profile <name>         Worktree profile from .webmux.yaml",
        "  --agent <claude|codex>   Agent to launch in the worktree",
        "  --prompt <text>          Initial agent prompt",
        "  --env KEY=VALUE          Runtime env override (repeatable)",
        "  --help                   Show this help message",
      ].join("\n");
    case "list":
      return "Usage:\n  webmux list";
    case "open":
      return "Usage:\n  webmux open <branch>";
    case "close":
      return "Usage:\n  webmux close <branch>";
    case "remove":
      return "Usage:\n  webmux remove <branch>";
    case "merge":
      return "Usage:\n  webmux merge <branch>";
    case "prune":
      return "Usage:\n  webmux prune";
  }
}

function readOptionValue(args: string[], index: number, flag: string): {
  value: string;
  nextIndex: number;
} {
  const arg = args[index];
  if (!arg) {
    throw new CommandUsageError(`${flag} requires a value`);
  }

  const prefix = `${flag}=`;
  if (arg.startsWith(prefix)) {
    return {
      value: arg.slice(prefix.length),
      nextIndex: index,
    };
  }

  const value = args[index + 1];
  if (value === undefined) {
    throw new CommandUsageError(`${flag} requires a value`);
  }

  return {
    value,
    nextIndex: index + 1,
  };
}

function parseAgent(value: string): AgentKind {
  if (value === "claude" || value === "codex") {
    return value;
  }
  throw new CommandUsageError(`Unknown agent: ${value}`);
}

export function parseAddCommandArgs(args: string[]): CreateLifecycleWorktreeInput | null {
  const input: CreateLifecycleWorktreeInput = {};
  const envOverrides: Record<string, string> = {};

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg) continue;

    if (arg === "--help" || arg === "-h") {
      return null;
    }

    if (arg === "--profile" || arg.startsWith("--profile=")) {
      const { value, nextIndex } = readOptionValue(args, index, "--profile");
      input.profile = value;
      index = nextIndex;
      continue;
    }

    if (arg === "--agent" || arg.startsWith("--agent=")) {
      const { value, nextIndex } = readOptionValue(args, index, "--agent");
      input.agent = parseAgent(value);
      index = nextIndex;
      continue;
    }

    if (arg === "--prompt" || arg.startsWith("--prompt=")) {
      const { value, nextIndex } = readOptionValue(args, index, "--prompt");
      input.prompt = value;
      index = nextIndex;
      continue;
    }

    if (arg === "--env" || arg.startsWith("--env=")) {
      const { value, nextIndex } = readOptionValue(args, index, "--env");
      const separatorIndex = value.indexOf("=");
      if (separatorIndex <= 0) {
        throw new CommandUsageError("--env must use KEY=VALUE");
      }
      envOverrides[value.slice(0, separatorIndex)] = value.slice(separatorIndex + 1);
      index = nextIndex;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new CommandUsageError(`Unknown option: ${arg}`);
    }

    if (input.branch) {
      throw new CommandUsageError(`Unexpected argument: ${arg}`);
    }

    input.branch = arg;
  }

  if (Object.keys(envOverrides).length > 0) {
    input.envOverrides = envOverrides;
  }

  return input;
}

export function parseBranchCommandArgs(args: string[]): string | null {
  let branch: string | null = null;

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      return null;
    }

    if (arg.startsWith("-")) {
      throw new CommandUsageError(`Unknown option: ${arg}`);
    }

    if (branch) {
      throw new CommandUsageError(`Unexpected argument: ${arg}`);
    }

    branch = arg;
  }

  if (!branch) {
    throw new CommandUsageError("Missing required argument: <branch>");
  }

  if (!isValidWorktreeName(branch)) {
    throw new CommandUsageError("Invalid worktree name");
  }

  return branch;
}

function parsePruneCommandArgs(args: string[]): boolean {
  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      return false;
    }

    if (arg.startsWith("-")) {
      throw new CommandUsageError(`Unknown option: ${arg}`);
    }

    throw new CommandUsageError(`Unexpected argument: ${arg}`);
  }

  return true;
}

function listProjectWorktrees(
  runtime: WorktreeRuntimeLike,
): Array<{ path: string; branch: string | null; bare: boolean }> {
  const projectDir = resolve(runtime.projectDir);
  return runtime.git.listWorktrees(projectDir)
    .filter((entry) => !entry.bare && resolve(entry.path) !== projectDir);
}

async function defaultConfirmPrune(worktreeCount: number): Promise<boolean> {
  const response = await p.confirm({
    message: `Prune all ${worktreeCount} worktree${worktreeCount === 1 ? "" : "s"}? This action cannot be undone.`,
    initialValue: false,
  });
  return !p.isCancel(response) && response;
}

function defaultSwitchToTmuxWindow(projectDir: string, branch: string): void {
  const sessionName = buildProjectSessionName(resolve(projectDir));
  const windowName = buildWorktreeWindowName(branch);
  const target = `${sessionName}:${windowName}`;

  const selectResult = Bun.spawnSync(["tmux", "select-window", "-t", target], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (selectResult.exitCode !== 0) return;

  if (Bun.env.TMUX) {
    const result = Bun.spawnSync(["tmux", "switch-client", "-t", sessionName], {
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) {
      console.error(`Warning: failed to switch tmux client to ${sessionName}`);
    }
  } else {
    const result = Bun.spawnSync(["tmux", "attach-session", "-t", sessionName], {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    if (result.exitCode !== 0) {
      console.error(`Warning: failed to attach to tmux session ${sessionName}`);
    }
  }
}

async function listWorktrees(
  runtime: WorktreeRuntimeLike,
  stdout: (message: string) => void,
): Promise<void> {
  const projectDir = resolve(runtime.projectDir);
  const entries = listProjectWorktrees(runtime);

  if (entries.length === 0) {
    stdout("No worktrees found.");
    return;
  }

  const sessionName = buildProjectSessionName(projectDir);
  let windows: Array<{ sessionName: string; windowName: string }> = [];
  try {
    windows = runtime.tmux.listWindows();
  } catch {
    windows = [];
  }

  const openWindows = new Set(
    windows
      .filter((w) => w.sessionName === sessionName)
      .map((w) => w.windowName),
  );

  const rows = await Promise.all(entries.map(async (entry) => {
    const branch = entry.branch ?? basename(entry.path);
    const isOpen = openWindows.has(buildWorktreeWindowName(branch));
    const gitDir = runtime.git.resolveWorktreeGitDir(entry.path);
    const meta = await readWorktreeMeta(gitDir);
    const info = meta ? `${meta.profile} / ${meta.agent}` : "";
    return { branch, isOpen, info };
  }));

  rows.sort((a, b) => a.branch.localeCompare(b.branch));

  const maxBranch = Math.max(...rows.map((r) => r.branch.length));
  for (const row of rows) {
    const status = row.isOpen ? "open" : "closed";
    stdout(`${row.branch.padEnd(maxBranch + 2)} ${status.padEnd(8)} ${row.info}`.trimEnd());
  }
}

export async function runWorktreeCommand(
  context: WorktreeCommandContext,
  deps: WorktreeCommandDependencies = {},
): Promise<number> {
  const createRuntime = deps.createRuntime ?? ((options: { projectDir: string; port: number }) => createWebmuxRuntime(options));
  const stdout = deps.stdout ?? ((message: string) => console.log(message));
  const stderr = deps.stderr ?? ((message: string) => console.error(message));
  const switchToTmuxWindow = deps.switchToTmuxWindow ?? defaultSwitchToTmuxWindow;
  const confirmPrune = deps.confirmPrune ?? defaultConfirmPrune;

  try {
    if (context.command === "add") {
      const input = parseAddCommandArgs(context.args);
      if (!input) {
        stdout(getWorktreeCommandUsage("add"));
        return 0;
      }

      const runtime = createRuntime({
        projectDir: context.projectDir,
        port: context.port,
      });
      const result = await runtime.lifecycleService.createWorktree(input);
      stdout(`Created worktree ${result.branch}`);
      switchToTmuxWindow(runtime.projectDir, result.branch);
      return 0;
    }

    if (context.command === "list") {
      if (context.args.includes("--help") || context.args.includes("-h")) {
        stdout(getWorktreeCommandUsage("list"));
        return 0;
      }

      const runtime = createRuntime({
        projectDir: context.projectDir,
        port: context.port,
      });
      await listWorktrees(runtime, stdout);
      return 0;
    }

    if (context.command === "prune") {
      if (!parsePruneCommandArgs(context.args)) {
        stdout(getWorktreeCommandUsage("prune"));
        return 0;
      }

      const runtime = createRuntime({
        projectDir: context.projectDir,
        port: context.port,
      });
      const worktrees = listProjectWorktrees(runtime);
      if (worktrees.length === 0) {
        stdout("No worktrees found.");
        return 0;
      }

      if (!await confirmPrune(worktrees.length)) {
        stdout("Aborted.");
        return 0;
      }

      const result = await runtime.lifecycleService.pruneWorktrees();
      if (result.removedBranches.length === 0) {
        stdout("No worktrees found.");
        return 0;
      }
      stdout(
        `Pruned ${result.removedBranches.length} worktree${result.removedBranches.length === 1 ? "" : "s"}: ${result.removedBranches.join(", ")}`,
      );
      return 0;
    }

    const command: Exclude<WorktreeSubcommand, "add" | "list" | "prune"> = context.command;
    const branch = parseBranchCommandArgs(context.args);
    if (!branch) {
      stdout(getWorktreeCommandUsage(command));
      return 0;
    }

    const runtime = createRuntime({
      projectDir: context.projectDir,
      port: context.port,
    });

    switch (command) {
      case "open":
        await runtime.lifecycleService.openWorktree(branch);
        stdout(`Opened worktree ${branch}`);
        return 0;
      case "close":
        await runtime.lifecycleService.closeWorktree(branch);
        stdout(`Closed worktree ${branch}`);
        return 0;
      case "remove":
        await runtime.lifecycleService.removeWorktree(branch);
        stdout(`Removed worktree ${branch}`);
        return 0;
      case "merge":
        await runtime.lifecycleService.mergeWorktree(branch);
        stdout(`Merged ${branch} into ${runtime.config.workspace.mainBranch}`);
        return 0;
    }
  } catch (error) {
    stderr(`Error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
