import { resolve } from "node:path";

export interface GitWorktreeEntry {
  path: string;
  branch: string | null;
  head: string | null;
  detached: boolean;
  bare: boolean;
}

export interface CreateGitWorktreeOptions {
  repoRoot: string;
  worktreePath: string;
  branch: string;
  baseBranch?: string;
}

export interface RemoveGitWorktreeOptions {
  repoRoot: string;
  worktreePath: string;
  force?: boolean;
}

export interface MergeGitBranchOptions {
  repoRoot: string;
  sourceBranch: string;
  targetBranch: string;
}

export interface GitWorktreeStatus {
  dirty: boolean;
  aheadCount: number;
  currentCommit: string | null;
}

export interface GitGateway {
  resolveWorktreeRoot(cwd: string): string;
  resolveWorktreeGitDir(cwd: string): string;
  listWorktrees(cwd: string): GitWorktreeEntry[];
  readWorktreeStatus(cwd: string): GitWorktreeStatus;
  createWorktree(opts: CreateGitWorktreeOptions): void;
  removeWorktree(opts: RemoveGitWorktreeOptions): void;
  deleteBranch(repoRoot: string, branch: string, force?: boolean): void;
  mergeBranch(opts: MergeGitBranchOptions): void;
  currentBranch(repoRoot: string): string;
}

function runGit(args: string[], cwd: string): string {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  if (result.exitCode !== 0) {
    const stderr = new TextDecoder().decode(result.stderr).trim();
    throw new Error(`git ${args.join(" ")} failed: ${stderr || `exit ${result.exitCode}`}`);
  }

  return new TextDecoder().decode(result.stdout).trim();
}

function tryRunGit(args: string[], cwd: string): { ok: true; stdout: string } | { ok: false; stderr: string } {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  if (result.exitCode !== 0) {
    return {
      ok: false,
      stderr: new TextDecoder().decode(result.stderr).trim(),
    };
  }

  return {
    ok: true,
    stdout: new TextDecoder().decode(result.stdout).trim(),
  };
}

export function resolveWorktreeRoot(cwd: string): string {
  const output = runGit(["rev-parse", "--show-toplevel"], cwd);
  return resolve(cwd, output);
}

export function resolveWorktreeGitDir(cwd: string): string {
  const output = runGit(["rev-parse", "--git-dir"], cwd);
  return resolve(cwd, output);
}

export function parseGitWorktreePorcelain(output: string): GitWorktreeEntry[] {
  const entries: GitWorktreeEntry[] = [];
  let current: GitWorktreeEntry | null = null;

  const flush = (): void => {
    if (current?.path) entries.push(current);
    current = null;
  };

  for (const rawLine of output.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line) {
      flush();
      continue;
    }

    if (line.startsWith("worktree ")) {
      flush();
      current = {
        path: line.slice("worktree ".length),
        branch: null,
        head: null,
        detached: false,
        bare: false,
      };
      continue;
    }

    if (!current) continue;

    if (line.startsWith("branch ")) {
      current.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
      continue;
    }

    if (line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length);
      continue;
    }

    if (line === "detached") {
      current.detached = true;
      continue;
    }

    if (line === "bare") {
      current.bare = true;
    }
  }

  flush();
  return entries;
}

export function listGitWorktrees(cwd: string): GitWorktreeEntry[] {
  const output = runGit(["worktree", "list", "--porcelain"], cwd);
  return parseGitWorktreePorcelain(output);
}

export function readGitWorktreeStatus(cwd: string): GitWorktreeStatus {
  const dirtyOutput = runGit(["status", "--porcelain"], cwd);
  const commit = tryRunGit(["rev-parse", "HEAD"], cwd);
  const ahead = tryRunGit(["rev-list", "--count", "@{upstream}..HEAD"], cwd);

  return {
    dirty: dirtyOutput.length > 0,
    aheadCount: ahead.ok ? parseInt(ahead.stdout, 10) || 0 : 0,
    currentCommit: commit.ok && commit.stdout.length > 0 ? commit.stdout : null,
  };
}

export class BunGitGateway implements GitGateway {
  resolveWorktreeRoot(cwd: string): string {
    return resolveWorktreeRoot(cwd);
  }

  resolveWorktreeGitDir(cwd: string): string {
    return resolveWorktreeGitDir(cwd);
  }

  listWorktrees(cwd: string): GitWorktreeEntry[] {
    return listGitWorktrees(cwd);
  }

  readWorktreeStatus(cwd: string): GitWorktreeStatus {
    return readGitWorktreeStatus(cwd);
  }

  createWorktree(opts: CreateGitWorktreeOptions): void {
    const args = ["worktree", "add", "-b", opts.branch, opts.worktreePath];
    if (opts.baseBranch) args.push(opts.baseBranch);
    runGit(args, opts.repoRoot);
  }

  removeWorktree(opts: RemoveGitWorktreeOptions): void {
    const args = ["worktree", "remove"];
    if (opts.force) args.push("--force");
    args.push(opts.worktreePath);
    runGit(args, opts.repoRoot);
  }

  deleteBranch(repoRoot: string, branch: string, force = false): void {
    runGit(["branch", force ? "-D" : "-d", branch], repoRoot);
  }

  mergeBranch(opts: MergeGitBranchOptions): void {
    const current = this.currentBranch(opts.repoRoot);
    if (current !== opts.targetBranch) {
      runGit(["checkout", opts.targetBranch], opts.repoRoot);
    }
    runGit(["merge", "--no-ff", "--no-edit", opts.sourceBranch], opts.repoRoot);
  }

  currentBranch(repoRoot: string): string {
    return runGit(["branch", "--show-current"], repoRoot);
  }
}
