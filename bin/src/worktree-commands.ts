import * as p from "@clack/prompts";
import { createApi } from "@webmux/api-contract";
import { basename, resolve } from "node:path";
import { buildSeedFromLinear, defaultSeedFromLinearDeps } from "../../backend/src/services/conversation-export-service";
import { CommandUsageError, withServerConnection } from "./shared";
import { readWorktreeArchiveState, readWorktreeMeta } from "../../backend/src/adapters/fs";
import { buildProjectSessionName, buildWorktreeWindowName } from "../../backend/src/adapters/tmux";
import type { AgentId } from "../../backend/src/domain/config";
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

export type WorktreeSubcommand = "add" | "list" | "open" | "close" | "refresh" | "remove" | "merge" | "send" | "prune" | "archive" | "unarchive" | "label" | "tab";

type WorktreeListMode = "active" | "all" | "archived";

interface LifecycleServiceLike {
  createWorktree(input: CreateLifecycleWorktreeInput): Promise<{ branch: string; worktreeId: string }>;
  createWorktrees(input: CreateLifecycleWorktreesInput): Promise<CreateLifecycleWorktreesResult>;
  openWorktree(branch: string): Promise<{ branch: string; worktreeId: string }>;
  closeWorktree(branch: string): Promise<void>;
  refreshAgentTerminal(branch: string): Promise<{ branch: string; worktreeId: string }>;
  setWorktreeArchived(branch: string, archived: boolean): Promise<void>;
  setWorktreeLabel(branch: string, label: string | null): Promise<{ label: string | null }>;
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

export function getWorktreeCommandUsage(command: WorktreeSubcommand): string {
  switch (command) {
    case "add":
      return [
        "Usage:",
        "  webmux add [branch] [--existing] [--base <branch>] [--profile <name>] [--agent <id>] [--prompt <text>] [--env KEY=VALUE] [--detach] [--from-linear <issue-id>]",
        "",
        "Options:",
        "  --existing               Use an existing local or remote branch instead of creating a new one",
        "  --base <branch>         Base branch for a new worktree (defaults to config)",
        "  --profile <name>         Worktree profile from .webmux.yaml",
        "  --agent <id>              Agent id to launch (repeatable)",
        "  --prompt <text>          Initial agent prompt",
        "  --env KEY=VALUE          Runtime env override (repeatable)",
        "  -d, --detach             Create worktree without switching to it",
        "  --from-linear ID         Bootstrap from a Linear issue — loads the issue body as",
        "                           context, plus any saved webmux session or linked PR",
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
    case "refresh":
      return "Usage:\n  webmux refresh <branch>";
    case "archive":
      return "Usage:\n  webmux archive <branch>";
    case "unarchive":
      return "Usage:\n  webmux unarchive <branch>";
    case "label":
      return [
        "Usage:",
        "  webmux label <branch> <label>",
        "  webmux label <branch> --clear",
        "",
        "Options:",
        "  --clear                  Clear the workspace label",
        "  --label <text>           Label text",
        "  --help                   Show this help message",
      ].join("\n");
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
    case "tab":
      return [
        "Usage:",
        "  webmux tab <branch>                 List the agent tabs (★ marks the active one)",
        "  webmux tab <branch> new             Create a new forked tab",
        "  webmux tab <branch> switch <tabId>  Switch the visible agent pane to a tab",
        "  webmux tab <branch> close <tabId>   Delete a forked tab",
        "",
        "Options:",
        "  --help                   Show this help message",
      ].join("\n");
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

function parseAgent(value: string): AgentId {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new CommandUsageError("Agent id cannot be empty");
  }
  return trimmed;
}

export interface ParsedAddCommand {
  input: CreateLifecycleWorktreesInput;
  detach: boolean;
  fromLinearIssueId: string | null;
  branchExplicit: boolean;
}

export function parseAddCommandArgs(args: string[]): ParsedAddCommand | null {
  const input: CreateLifecycleWorktreesInput = {};
  const envOverrides: Record<string, string> = {};
  const selectedAgents: AgentId[] = [];
  let detach = false;
  let fromLinearIssueId: string | null = null;
  let branchExplicit = false;

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
      selectedAgents.push(parseAgent(value));
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

    if (arg === "--from-linear" || arg.startsWith("--from-linear=")) {
      const { value, nextIndex } = readOptionValue(args, index, "--from-linear");
      const trimmed = value.trim();
      if (!/^[A-Z]+-\d+$/.test(trimmed)) {
        throw new CommandUsageError(`--from-linear expects an issue id like ENG-123 (got "${trimmed}")`);
      }
      fromLinearIssueId = trimmed;
      index = nextIndex;
      continue;
    }

    if (arg === "--branch" || arg.startsWith("--branch=")) {
      const { value, nextIndex } = readOptionValue(args, index, "--branch");
      if (input.branch && input.branch !== value) {
        throw new CommandUsageError(`Conflicting branch values: "${input.branch}" and "${value}"`);
      }
      input.branch = value.trim();
      branchExplicit = true;
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
    branchExplicit = true;
  }

  if (selectedAgents.length > 0) {
    input.agents = selectedAgents;
  }

  if (Object.keys(envOverrides).length > 0) {
    input.envOverrides = envOverrides;
  }

  return { input, detach, fromLinearIssueId, branchExplicit };
}

export type TabAction = "list" | "new" | "switch" | "close";

export interface ParsedTabCommand {
  branch: string;
  action: TabAction;
  tabId?: string;
}

export function parseTabCommandArgs(args: string[]): ParsedTabCommand | null {
  const positional: string[] = [];
  for (const arg of args) {
    if (arg === "--help" || arg === "-h") return null;
    if (arg.startsWith("-")) throw new CommandUsageError(`Unknown option: ${arg}`);
    positional.push(arg);
  }

  const [branch, rawAction = "list", tabId, ...rest] = positional;
  if (!branch) throw new CommandUsageError("Missing required argument: <branch>");
  if (!isValidWorktreeName(branch)) throw new CommandUsageError("Invalid worktree name");
  if (rawAction !== "list" && rawAction !== "new" && rawAction !== "switch" && rawAction !== "close") {
    throw new CommandUsageError(`Unknown tab action: ${rawAction}`);
  }
  if ((rawAction === "switch" || rawAction === "close") && !tabId) {
    throw new CommandUsageError(`The "${rawAction}" action requires a <tabId>`);
  }
  if (rest.length > 0) throw new CommandUsageError(`Unexpected argument: ${rest[0]}`);

  return { branch, action: rawAction, ...(tabId ? { tabId } : {}) };
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

export interface ParsedLabelCommand {
  branch: string;
  label: string | null;
}

export interface ParsedListCommand {
  mode: WorktreeListMode;
  search: string;
}

export function parseLabelCommandArgs(args: string[]): ParsedLabelCommand | null {
  let branch: string | null = null;
  let clear = false;
  let optionLabel: string | null = null;
  const labelParts: string[] = [];

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg) continue;

    if (arg === "--help" || arg === "-h") {
      return null;
    }

    if (arg === "--clear") {
      clear = true;
      continue;
    }

    if (arg === "--label" || arg.startsWith("--label=")) {
      if (optionLabel !== null) {
        throw new CommandUsageError("Cannot use --label more than once");
      }
      const { value, nextIndex } = readOptionValue(args, index, "--label");
      optionLabel = value;
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

    if (optionLabel !== null) {
      throw new CommandUsageError("Cannot use --label with a positional label");
    }
    labelParts.push(arg);
  }

  if (!branch) {
    throw new CommandUsageError("Missing required argument: <branch>");
  }

  if (!isValidWorktreeName(branch)) {
    throw new CommandUsageError("Invalid worktree name");
  }

  if (optionLabel !== null && labelParts.length > 0) {
    throw new CommandUsageError("Cannot use --label with a positional label");
  }

  const label = (optionLabel ?? labelParts.join(" ")).trim();
  if (clear && label) {
    throw new CommandUsageError("Cannot use --clear with a label");
  }

  if (!clear && !label) {
    throw new CommandUsageError("Missing required argument: <label>");
  }

  return {
    branch,
    label: clear ? null : label,
  };
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
  label: string | null;
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
      label: meta?.label ?? null,
      isOpen,
      archived: archivedPaths.has(resolve(entry.path)),
      info,
      searchText: [
        meta?.label ?? "",
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

  const maxName = Math.max(...visibleRows.map((row) =>
    (row.label ? `${row.label} (${row.branch})` : row.branch).length
  ));
  for (const row of visibleRows) {
    const status = `${row.isOpen ? "open" : "closed"}${row.archived ? " archived" : ""}`;
    const name = row.label ? `${row.label} (${row.branch})` : row.branch;
    stdout(`${name.padEnd(maxName + 2)} ${status.padEnd(15)} ${row.info}`.trimEnd());
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

      if (parsed.fromLinearIssueId) {
        stdout(`Resolving Linear issue ${parsed.fromLinearIssueId}...`);
        const seed = await buildSeedFromLinear(
          { issueId: parsed.fromLinearIssueId },
          defaultSeedFromLinearDeps,
        );
        if (!seed.ok) {
          stderr(`Linear seed lookup failed: ${seed.error}`);
          return 1;
        }
        stdout(`Linear seed source: ${seed.data.source}${seed.data.branch ? ` branch=${seed.data.branch}` : ""}${seed.data.prUrl ? ` pr=${seed.data.prUrl}` : ""}`);

        if (!parsed.branchExplicit && seed.data.branch) {
          parsed.input.branch = seed.data.branch;
        }
        if (!parsed.input.branch) {
          stderr("Linear issue did not resolve to a branch; pass --branch to override.");
          return 1;
        }
        if (seed.data.source !== "none") parsed.input.mode = "existing";
        if (seed.data.conversationMarkdown) {
          parsed.input.prompt = parsed.input.prompt
            ? `${seed.data.conversationMarkdown}\n\n---\n\n${parsed.input.prompt}`
            : seed.data.conversationMarkdown;
        }
      }

      if (!parsed.input.branch && parsed.input.prompt && runtime.config.autoName) {
        stdout("Generating branch name...");
      }

      const result = await runtime.lifecycleService.createWorktrees(parsed.input);
      for (const branch of result.branches) {
        stdout(`Created worktree ${branch}`);
      }
      if (!parsed.detach) {
        switchToTmuxWindow(runtime.projectDir, result.primaryBranch);
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
      await withServerConnection(context.port, () =>
        api.sendWorktreePrompt({
          params: { name: parsed.branch },
          body: {
            text: parsed.text,
            ...(parsed.preamble ? { preamble: parsed.preamble } : {}),
          },
        }),
      );

      stdout(`Sent prompt to ${parsed.branch}`);
      return 0;
    }

    if (context.command === "tab") {
      const parsed = parseTabCommandArgs(context.args);
      if (!parsed) {
        stdout(getWorktreeCommandUsage("tab"));
        return 0;
      }

      const api = createApi(`http://localhost:${context.port}`);
      await withServerConnection(context.port, async () => {
        if (parsed.action === "new") {
          const { tab } = await api.createWorktreeTab({ params: { name: parsed.branch } });
          stdout(`Created ${tab.label} (${tab.tabId}) in ${parsed.branch}`);
          return;
        }
        if (parsed.action === "switch" || parsed.action === "close") {
          const tabId = parsed.tabId;
          if (!tabId) throw new CommandUsageError(`The "${parsed.action}" action requires a <tabId>`);
          if (parsed.action === "switch") {
            await api.selectWorktreeTab({ params: { name: parsed.branch, tabId } });
            stdout(`Switched ${parsed.branch} to tab ${tabId}`);
          } else {
            await api.deleteWorktreeTab({ params: { name: parsed.branch, tabId } });
            stdout(`Closed tab ${tabId} in ${parsed.branch}`);
          }
          return;
        }
        const { worktrees } = await api.fetchWorktrees();
        const worktree = worktrees.find((candidate) => candidate.branch === parsed.branch);
        if (!worktree) {
          stdout(`Worktree not found: ${parsed.branch}`);
          return;
        }
        for (const tab of worktree.tabs) {
          const marker = tab.tabId === worktree.activeTabId ? "★" : " ";
          stdout(`${marker} ${tab.label.padEnd(10)} ${tab.tabId}`);
        }
      });
      return 0;
    }

    if (context.command === "label") {
      const parsed = parseLabelCommandArgs(context.args);
      if (!parsed) {
        stdout(getWorktreeCommandUsage("label"));
        return 0;
      }

      const runtime = createRuntime({
        projectDir: context.projectDir,
        port: context.port,
      });
      const result = await runtime.lifecycleService.setWorktreeLabel(parsed.branch, parsed.label);
      stdout(result.label
        ? `Labeled worktree ${parsed.branch} as "${result.label}"`
        : `Cleared label for ${parsed.branch}`);
      return 0;
    }

    const command: Exclude<WorktreeSubcommand, "add" | "list" | "send" | "prune" | "label" | "tab"> = context.command;
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
      case "refresh":
        await runtime.lifecycleService.refreshAgentTerminal(branch);
        stdout(`Refreshed agent terminal for ${branch}`);
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
