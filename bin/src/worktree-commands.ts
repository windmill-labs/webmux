import * as p from "@clack/prompts";
import { createApi } from "@webmux/api-contract";
import { basename, resolve } from "node:path";
import { readWorktreeArchiveState, readWorktreeMeta } from "../../backend/src/adapters/fs";
import { buildProjectSessionName, buildWorktreeWindowName } from "../../backend/src/adapters/tmux";
import type { AgentKind, CreateWorktreeAgentSelection } from "../../backend/src/domain/config";
import type { WorktreeCreationPhase } from "../../backend/src/domain/model";
import { isValidWorktreeName } from "../../backend/src/domain/policies";
import { buildArchivedWorktreePathSet } from "../../backend/src/services/archive-service";
import { createWebmuxRuntime } from "../../backend/src/runtime";
import type { CreateLifecycleWorktreeInput, CreateLifecycleWorktreesInput, CreateLifecycleWorktreesResult, CreateWorktreeProgress, PruneWorktreesResult } from "../../backend/src/services/lifecycle-service";

const PHASE_LABELS: Record<WorktreeCreationPhase, string> = {
  creating_worktree: "Creating worktree",
  running_post_create_hook: "Running post-create hook",
  preparing_runtime: "Preparing runtime",
  starting_session: "Starting session",
  reconciling: "Reconciling",
};

export type WorktreeSubcommand = "add" | "list" | "open" | "close" | "remove" | "merge" | "send" | "prune" | "archive" | "unarchive";

type WorktreeListMode = "active" | "all" | "archived";

interface LifecycleServiceLike {
  createWorktree(input: CreateLifecycleWorktreeInput): Promise<{ branch: string; worktreeId: string }>;
  createWorktrees(input: CreateLifecycleWorktreesInput): Promise<CreateLifecycleWorktreesResult>;
  openWorktree(branch: string): Promise<{ branch: string; worktreeId: string }>;
  closeWorktree(branch: string): Promise<void>;
  setWorktreeArchived(branch: string, archived: boolean): Promise<void>;
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
  createRuntime?: (options: {
    projectDir: string;
    port: number;
    onCreateProgress?: (progress: CreateWorktreeProgress) => void;
  }) => WorktreeRuntimeLike;
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
        "  webmux add [branch] [--existing] [--base <branch>] [--profile <name>] [--agent <claude|codex|both>] [--prompt <text>] [--env KEY=VALUE] [--detach]",
        "",
        "Options:",
        "  --existing               Use an existing local or remote branch instead of creating a new one",
        "  --base <branch>         Base branch for a new worktree (defaults to config)",
        "  --profile <name>         Worktree profile from .webmux.yaml",
        "  --agent <claude|codex|both> Agent to launch (both creates paired worktrees)",
        "  --prompt <text>          Initial agent prompt",
        "  --env KEY=VALUE          Runtime env override (repeatable)",
        "  -d, --detach             Create worktree without switching to it",
        "  --help                   Show this help message",
      ].join("\n");
    case "list":
      return [
        "Usage:",
        "  webmux list [--all|--archived] [--search <text>]",
        "",
        "Options:",
        "  --all                    Include archived worktrees",
        "  --archived               Show only archived worktrees",
        "  --search <text>          Filter worktrees by branch/profile/agent",
        "  --help                   Show this help message",
      ].join("\n");
    case "open":
      return "Usage:\n  webmux open <branch>";
    case "close":
      return "Usage:\n  webmux close <branch>";
    case "archive":
      return "Usage:\n  webmux archive <branch>";
    case "unarchive":
      return "Usage:\n  webmux unarchive <branch>";
    case "remove":
      return "Usage:\n  webmux remove <branch>";
    case "merge":
      return "Usage:\n  webmux merge <branch>";
    case "send":
      return [
        "Usage:",
        "  webmux send <branch> <prompt> [--preamble <text>]",
        "",
        "Options:",
        "  --prompt <text>          Prompt text (alternative to positional arg)",
        "  --preamble <text>        Preamble text sent before the prompt",
        "  --help                   Show this help message",
      ].join("\n");
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

function parseAgent(value: string): CreateWorktreeAgentSelection {
  if (value === "claude" || value === "codex" || value === "both") {
    return value;
  }
  throw new CommandUsageError(`Unknown agent: ${value}`);
}

export interface ParsedAddCommand {
  input: CreateLifecycleWorktreesInput;
  detach: boolean;
}

export function parseAddCommandArgs(args: string[]): ParsedAddCommand | null {
  const input: CreateLifecycleWorktreesInput = {};
  const envOverrides: Record<string, string> = {};
  let detach = false;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg) continue;

    if (arg === "--help" || arg === "-h") {
      return null;
    }

    if (arg === "--existing") {
      input.mode = "existing";
      continue;
    }

    if (arg === "--detach" || arg === "-d") {
      detach = true;
      continue;
    }

    if (arg === "--profile" || arg.startsWith("--profile=")) {
      const { value, nextIndex } = readOptionValue(args, index, "--profile");
      input.profile = value;
      index = nextIndex;
      continue;
    }

    if (arg === "--base" || arg.startsWith("--base=")) {
      const { value, nextIndex } = readOptionValue(args, index, "--base");
      input.baseBranch = value;
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

  return { input, detach };
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

export interface ParsedSendCommand {
  branch: string;
  text: string;
  preamble?: string;
}

export interface ParsedListCommand {
  mode: WorktreeListMode;
  search: string;
}

export function parseSendCommandArgs(args: string[]): ParsedSendCommand | null {
  let branch: string | null = null;
  let text: string | null = null;
  let preamble: string | undefined;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg) continue;

    if (arg === "--help" || arg === "-h") {
      return null;
    }

    if (arg === "--prompt" || arg.startsWith("--prompt=")) {
      if (text) throw new CommandUsageError("Cannot use --prompt with a positional prompt argument");
      const { value, nextIndex } = readOptionValue(args, index, "--prompt");
      text = value;
      index = nextIndex;
      continue;
    }

    if (arg === "--preamble" || arg.startsWith("--preamble=")) {
      const { value, nextIndex } = readOptionValue(args, index, "--preamble");
      preamble = value;
      index = nextIndex;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new CommandUsageError(`Unknown option: ${arg}`);
    }

    if (!branch) {
      branch = arg;
      continue;
    }

    if (!text) {
      text = arg;
      continue;
    }

    throw new CommandUsageError(`Unexpected argument: ${arg}. Use either a positional prompt or --prompt, not both`);
  }

  if (!branch) {
    throw new CommandUsageError("Missing required argument: <branch>");
  }

  if (!isValidWorktreeName(branch)) {
    throw new CommandUsageError("Invalid worktree name");
  }

  if (!text) {
    throw new CommandUsageError("Missing required argument: <prompt>");
  }

  return { branch, text, preamble };
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

export function parseListCommandArgs(args: string[]): ParsedListCommand | null {
  let mode: WorktreeListMode = "active";
  let search = "";

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg) continue;

    if (arg === "--help" || arg === "-h") {
      return null;
    }

    if (arg === "--all") {
      if (mode === "archived") {
        throw new CommandUsageError("Cannot use --all with --archived");
      }
      mode = "all";
      continue;
    }

    if (arg === "--archived") {
      if (mode === "all") {
        throw new CommandUsageError("Cannot use --archived with --all");
      }
      mode = "archived";
      continue;
    }

    if (arg === "--search" || arg.startsWith("--search=")) {
      const { value, nextIndex } = readOptionValue(args, index, "--search");
      search = value;
      index = nextIndex;
      continue;
    }

    throw new CommandUsageError(`Unknown option: ${arg}`);
  }

  return { mode, search };
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

interface ListedWorktreeRow {
  branch: string;
  isOpen: boolean;
  archived: boolean;
  info: string;
  searchText: string;
}

function matchesListSearch(row: ListedWorktreeRow, query: string): boolean {
  return query.length === 0 || row.searchText.toLowerCase().includes(query.toLowerCase());
}

async function listWorktrees(
  runtime: WorktreeRuntimeLike,
  stdout: (message: string) => void,
  options: ParsedListCommand,
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

  const projectGitDir = runtime.git.resolveWorktreeGitDir(projectDir);
  const archivedPaths = buildArchivedWorktreePathSet(await readWorktreeArchiveState(projectGitDir));
  const rows = await Promise.all(entries.map(async (entry) => {
    const branch = entry.branch ?? basename(entry.path);
    const isOpen = openWindows.has(buildWorktreeWindowName(branch));
    const gitDir = runtime.git.resolveWorktreeGitDir(entry.path);
    const meta = await readWorktreeMeta(gitDir);
    const info = meta ? `${meta.profile} / ${meta.agent}` : "";
    return {
      branch,
      isOpen,
      archived: archivedPaths.has(resolve(entry.path)),
      info,
      searchText: [
        branch,
        meta?.baseBranch ?? "",
        meta?.profile ?? "",
        meta?.agent ?? "",
      ].join(" "),
    } satisfies ListedWorktreeRow;
  }));

  const matchingRows = rows
    .filter((row) => matchesListSearch(row, options.search.trim()))
    .sort((a, b) => a.branch.localeCompare(b.branch));
  const visibleRows = matchingRows.filter((row) => {
    if (options.mode === "all") return true;
    if (options.mode === "archived") return row.archived;
    return !row.archived;
  });

  if (visibleRows.length === 0) {
    const hiddenArchivedCount = options.mode === "active"
      ? matchingRows.filter((row) => row.archived).length
      : 0;
    if (hiddenArchivedCount > 0) {
      stdout(
        `No active worktrees found. ${hiddenArchivedCount} archived worktree${hiddenArchivedCount === 1 ? "" : "s"} hidden. Use --all or --archived.`,
      );
      return;
    }

    if (options.mode === "archived") {
      stdout("No archived worktrees found.");
      return;
    }

    stdout(options.search.trim() ? `No worktrees found for "${options.search.trim()}".` : "No worktrees found.");
    return;
  }

  const maxBranch = Math.max(...visibleRows.map((row) => row.branch.length));
  for (const row of visibleRows) {
    const status = `${row.isOpen ? "open" : "closed"}${row.archived ? " archived" : ""}`;
    stdout(`${row.branch.padEnd(maxBranch + 2)} ${status.padEnd(15)} ${row.info}`.trimEnd());
  }

  if (options.mode === "active") {
    const hiddenArchivedCount = matchingRows.filter((row) => row.archived).length;
    if (hiddenArchivedCount > 0) {
      stdout(
        `Hidden ${hiddenArchivedCount} archived worktree${hiddenArchivedCount === 1 ? "" : "s"}. Use --all or --archived.`,
      );
    }
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
      const parsed = parseAddCommandArgs(context.args);
      if (!parsed) {
        stdout(getWorktreeCommandUsage("add"));
        return 0;
      }

      const runtime = createRuntime({
        projectDir: context.projectDir,
        port: context.port,
        onCreateProgress: (progress) => {
          stdout(PHASE_LABELS[progress.phase] ?? progress.phase);
        },
      });
      if (!parsed.input.branch && parsed.input.prompt && runtime.config.autoName) {
        stdout("Generating branch name...");
      }

      if (parsed.input.agent === "both") {
        const result = await runtime.lifecycleService.createWorktrees(parsed.input);
        for (const branch of result.branches) {
          stdout(`Created worktree ${branch}`);
        }
        if (!parsed.detach) {
          switchToTmuxWindow(runtime.projectDir, result.primaryBranch);
        }
      } else {
        const { agent, ...rest } = parsed.input;
        const result = await runtime.lifecycleService.createWorktree({ ...rest, agent: agent as AgentKind | undefined });
        stdout(`Created worktree ${result.branch}`);
        if (!parsed.detach) {
          switchToTmuxWindow(runtime.projectDir, result.branch);
        }
      }
      return 0;
    }

    if (context.command === "list") {
      const parsed = parseListCommandArgs(context.args);
      if (!parsed) {
        stdout(getWorktreeCommandUsage("list"));
        return 0;
      }

      const runtime = createRuntime({
        projectDir: context.projectDir,
        port: context.port,
      });
      await listWorktrees(runtime, stdout, parsed);
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

    if (context.command === "send") {
      const parsed = parseSendCommandArgs(context.args);
      if (!parsed) {
        stdout(getWorktreeCommandUsage("send"));
        return 0;
      }

      const api = createApi(`http://localhost:${context.port}`);
      try {
        await api.sendWorktreePrompt({
          params: { name: parsed.branch },
          body: {
            text: parsed.text,
            ...(parsed.preamble ? { preamble: parsed.preamble } : {}),
          },
        });
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("HTTP")) {
          throw error;
        }
        if (error instanceof Error && !error.message.includes("fetch")) {
          throw error;
        }
        throw new Error(`Could not connect to webmux server on port ${context.port}. Is it running?`);
      }

      stdout(`Sent prompt to ${parsed.branch}`);
      return 0;
    }

    const command: Exclude<WorktreeSubcommand, "add" | "list" | "send" | "prune"> = context.command;
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
        switchToTmuxWindow(runtime.projectDir, branch);
        return 0;
      case "close":
        await runtime.lifecycleService.closeWorktree(branch);
        stdout(`Closed worktree ${branch}`);
        return 0;
      case "archive":
        await runtime.lifecycleService.setWorktreeArchived(branch, true);
        stdout(`Archived worktree ${branch}`);
        return 0;
      case "unarchive":
        await runtime.lifecycleService.setWorktreeArchived(branch, false);
        stdout(`Restored worktree ${branch}`);
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
