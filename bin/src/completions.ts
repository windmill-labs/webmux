import { basename, dirname, resolve } from "node:path";
import { parseGitWorktreePorcelain } from "../../backend/src/adapters/git";

// ── Types ──────────────────────────────────────────────────────────────────

type CompletionShell = "bash" | "zsh";

interface ListBranchesDeps {
  runGit: (args: string[]) => { exitCode: number; stdout: string };
}

// ── Constants ──────────────────────────────────────────────────────────────

const BRANCH_SUBCOMMANDS = new Set(["open", "close", "remove", "merge"]);

// ── Pure logic ─────────────────────────────────────────────────────────────

export function filterBranches(
  branches: string[],
  partial: string,
): string[] {
  if (!partial) return branches;
  return branches.filter((b) => b.startsWith(partial));
}

export function extractBranches(
  porcelainOutput: string,
  mainWorktreePath: string | null,
): string[] {
  const entries = parseGitWorktreePorcelain(porcelainOutput);
  const resolvedMain = mainWorktreePath ? resolve(mainWorktreePath) : null;

  return entries
    .filter((e) => !e.bare && (!resolvedMain || resolve(e.path) !== resolvedMain))
    .map((e) => e.branch ?? basename(e.path));
}

// ── I/O boundary ───────────────────────────────────────────────────────────

function defaultRunGit(args: string[]): { exitCode: number; stdout: string } {
  const result = Bun.spawnSync(["git", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout).trim(),
  };
}

export function listWorktreeBranches(
  deps: ListBranchesDeps = { runGit: defaultRunGit },
): string[] {
  const worktreeResult = deps.runGit(["worktree", "list", "--porcelain"]);
  if (worktreeResult.exitCode !== 0) return [];

  const commonDirResult = deps.runGit(["rev-parse", "--git-common-dir"]);
  const mainPath = commonDirResult.exitCode === 0 ? dirname(resolve(commonDirResult.stdout)) : null;

  return extractBranches(worktreeResult.stdout, mainPath);
}

// ── Completion handler (called via --completions) ──────────────────────────

export function handleCompletions(args: string[]): void {
  const subcommand = args[0];

  if (!subcommand || !BRANCH_SUBCOMMANDS.has(subcommand)) {
    return;
  }

  const branches = listWorktreeBranches();
  for (const branch of branches) {
    console.log(branch);
  }
}

// ── Shell script generation ────────────────────────────────────────────────

function isCompletionShell(value: string): value is CompletionShell {
  return value === "bash" || value === "zsh";
}

export function runCompletionCommand(args: string[]): number {
  const shell = args[0];

  if (!shell || shell === "--help" || shell === "-h") {
    console.log("Usage:\n  webmux completion <bash|zsh>");
    return 0;
  }

  if (!isCompletionShell(shell)) {
    console.error(`Unknown shell: ${shell}. Supported: bash, zsh`);
    return 1;
  }

  console.log(generateCompletionScript(shell));
  return 0;
}

function generateCompletionScript(shell: CompletionShell): string {
  switch (shell) {
    case "zsh":
      return ZSH_SCRIPT;
    case "bash":
      return BASH_SCRIPT;
  }
}

// ── Shell scripts ──────────────────────────────────────────────────────────

const ZSH_SCRIPT = `#compdef webmux

_webmux() {
  local -a commands
  commands=(
    'serve:Start the dashboard server'
    'init:Interactive project setup'
    'service:Manage webmux as a system service'
    'update:Update webmux to the latest version'
    'add:Create a worktree'
    'list:List worktrees and their status'
    'open:Open an existing worktree session'
    'close:Close a worktree session'
    'remove:Remove a worktree'
    'merge:Merge a worktree into main'
    'completion:Generate shell completion script'
  )

  if (( CURRENT == 2 )); then
    _describe 'command' commands
    return
  fi

  case "\${words[2]}" in
    open|close|remove|merge)
      if (( CURRENT == 3 )); then
        local -a branches
        branches=(\${(f)"$(webmux --completions "\${words[2]}" 2>/dev/null)"})
        if (( \${#branches} )); then
          _describe 'worktree' branches
        fi
      fi
      ;;
    completion)
      if (( CURRENT == 3 )); then
        local -a shells
        shells=('bash:Bash completion script' 'zsh:Zsh completion script')
        _describe 'shell' shells
      fi
      ;;
    service)
      if (( CURRENT == 3 )); then
        local -a actions
        actions=(
          'install:Install webmux as a system service'
          'uninstall:Remove the system service'
          'status:Show service status'
          'logs:Show service logs'
        )
        _describe 'action' actions
      fi
      ;;
  esac
}

_webmux "$@"`;

const BASH_SCRIPT = `_webmux() {
  local cur prev
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"

  if [[ \${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=($(compgen -W "serve init service update add list open close remove merge completion" -- "\${cur}"))
    return
  fi

  case "\${COMP_WORDS[1]}" in
    open|close|remove|merge)
      if [[ \${COMP_CWORD} -eq 2 ]]; then
        local branches
        branches=$(webmux --completions "\${COMP_WORDS[1]}" 2>/dev/null)
        COMPREPLY=($(compgen -W "\${branches}" -- "\${cur}"))
      fi
      ;;
    completion)
      if [[ \${COMP_CWORD} -eq 2 ]]; then
        COMPREPLY=($(compgen -W "bash zsh" -- "\${cur}"))
      fi
      ;;
    service)
      if [[ \${COMP_CWORD} -eq 2 ]]; then
        COMPREPLY=($(compgen -W "install uninstall status logs" -- "\${cur}"))
      fi
      ;;
  esac
}

complete -F _webmux webmux`;
