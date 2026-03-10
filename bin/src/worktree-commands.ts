import type { AgentKind } from "../../backend/src/domain/config";
import { createWebmuxRuntime } from "../../backend/src/runtime";
import type { CreateLifecycleWorktreeInput } from "../../backend/src/services/lifecycle-service";

export type WorktreeSubcommand = "add" | "open" | "close" | "remove" | "merge";

interface LifecycleServiceLike {
  createWorktree(input: CreateLifecycleWorktreeInput): Promise<{ branch: string; worktreeId: string }>;
  openWorktree(branch: string): Promise<{ branch: string; worktreeId: string }>;
  closeWorktree(branch: string): Promise<void>;
  removeWorktree(branch: string): Promise<void>;
  mergeWorktree(branch: string): Promise<void>;
}

interface WorktreeRuntimeLike {
  config: {
    workspace: {
      mainBranch: string;
    };
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
    case "open":
      return "Usage:\n  webmux open <branch>";
    case "close":
      return "Usage:\n  webmux close <branch>";
    case "remove":
      return "Usage:\n  webmux remove <branch>";
    case "merge":
      return "Usage:\n  webmux merge <branch>";
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

  return branch;
}

export async function runWorktreeCommand(
  context: WorktreeCommandContext,
  deps: WorktreeCommandDependencies = {},
): Promise<number> {
  const createRuntime = deps.createRuntime ?? ((options: { projectDir: string; port: number }) => createWebmuxRuntime(options));
  const stdout = deps.stdout ?? ((message: string) => console.log(message));
  const stderr = deps.stderr ?? ((message: string) => console.error(message));

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
      return 0;
    }

    const branch = parseBranchCommandArgs(context.args);
    if (!branch) {
      stdout(getWorktreeCommandUsage(context.command));
      return 0;
    }

    const runtime = createRuntime({
      projectDir: context.projectDir,
      port: context.port,
    });

    switch (context.command) {
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
      case "add":
        return 1;
    }
  } catch (error) {
    stderr(`Error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
