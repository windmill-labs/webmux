import { rmSync } from "node:fs";
import { resolve } from "node:path";

export interface GitWorktreeEntry {
  path: string;
  branch: string | null;
  head: string | null;
  detached: boolean;
  bare: boolean;
}

export type CreateWorktreeMode = "new" | "existing";

interface BaseCreateGitWorktreeOptions {
  repoRoot: string;
  worktreePath: string;
  branch: string;
}

export interface CreateNewGitWorktreeOptions extends BaseCreateGitWorktreeOptions {
  mode: "new";
  baseBranch?: string;
}

export interface CreateExistingGitWorktreeOptions extends BaseCreateGitWorktreeOptions {
  mode: "existing";
}

export type CreateGitWorktreeOptions = CreateNewGitWorktreeOptions | CreateExistingGitWorktreeOptions;

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

export type TryGitCommandResult =
  | { ok: true; stdout: string }
  | { ok: false; stderr: string };

export interface RemoveGitWorktreeDeps {
  tryRunGit?: (args: string[], cwd: string) => TryGitCommandResult;
  listWorktrees?: (cwd: string) => GitWorktreeEntry[];
  removeDirectory?: (path: string) => void;
}

export interface GitGateway {
  resolveWorktreeRoot(cwd: string): string;
  resolveWorktreeGitDir(cwd: string): string;
  listWorktrees(cwd: string): GitWorktreeEntry[];
  listLocalBranches(cwd: string): string[];
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

function tryRunGit(args: string[], cwd: string): TryGitCommandResult {
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRegisteredWorktree(entries: GitWorktreeEntry[], worktreePath: string): boolean {
  const resolvedPath = resolve(worktreePath);
  return entries.some((entry) => resolve(entry.path) === resolvedPath);
}

function removeDirectory(path: string): void {
  rmSync(path, {
    recursive: true,
    force: true,
  });
}

function currentCheckoutRef(cwd: string): { ref: string; branch: string | null } {
  const symbolicRef = tryRunGit(["symbolic-ref", "--quiet", "--short", "HEAD"], cwd);
  if (symbolicRef.ok && symbolicRef.stdout.length > 0) {
    return {
      ref: symbolicRef.stdout,
      branch: symbolicRef.stdout,
    };
  }

  return {
    ref: runGit(["rev-parse", "--verify", "HEAD"], cwd),
    branch: null,
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

export function listLocalGitBranches(cwd: string): string[] {
  const output = runGit(["for-each-ref", "--format=%(refname:short)", "refs/heads"], cwd);
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
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

export function removeGitWorktree(
  opts: RemoveGitWorktreeOptions,
  deps: RemoveGitWorktreeDeps = {},
): void {
  const args = ["worktree", "remove"];
  if (opts.force) args.push("--force");
  args.push(opts.worktreePath);

  const result = (deps.tryRunGit ?? tryRunGit)(args, opts.repoRoot);
  if (result.ok) {
    return;
  }

  const failure = `git ${args.join(" ")} failed: ${result.stderr || "exit 1"}`;
  const remainingWorktrees = (deps.listWorktrees ?? listGitWorktrees)(opts.repoRoot);
  if (isRegisteredWorktree(remainingWorktrees, opts.worktreePath)) {
    throw new Error(failure);
  }

  try {
    (deps.removeDirectory ?? removeDirectory)(opts.worktreePath);
  } catch (error) {
    throw new Error(`${failure}; cleanup failed: ${errorMessage(error)}`);
  }
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

  listLocalBranches(cwd: string): string[] {
    return listLocalGitBranches(cwd);
  }

  readWorktreeStatus(cwd: string): GitWorktreeStatus {
    return readGitWorktreeStatus(cwd);
  }

  createWorktree(opts: CreateGitWorktreeOptions): void {
    const args = ["worktree", "add"];
    if (opts.mode === "new") {
      args.push("-b", opts.branch, opts.worktreePath);
      if (opts.baseBranch) args.push(opts.baseBranch);
    } else {
      args.push(opts.worktreePath, opts.branch);
    }
    runGit(args, opts.repoRoot);
  }

  removeWorktree(opts: RemoveGitWorktreeOptions): void {
    removeGitWorktree(opts);
  }

  deleteBranch(repoRoot: string, branch: string, force = false): void {
    runGit(["branch", force ? "-D" : "-d", branch], repoRoot);
  }

  mergeBranch(opts: MergeGitBranchOptions): void {
    const current = currentCheckoutRef(opts.repoRoot);
    const shouldRestore = current.branch !== opts.targetBranch;
    if (shouldRestore) {
      runGit(["checkout", opts.targetBranch], opts.repoRoot);
    }

    let mergeError: string | null = null;
    const cleanupErrors: string[] = [];

    try {
      runGit(["merge", "--no-ff", "--no-edit", opts.sourceBranch], opts.repoRoot);
    } catch (error) {
      mergeError = errorMessage(error);

      const abort = tryRunGit(["merge", "--abort"], opts.repoRoot);
      if (!abort.ok && abort.stderr.length > 0 && !abort.stderr.includes("MERGE_HEAD missing")) {
        cleanupErrors.push(`merge abort failed: ${abort.stderr}`);
      }
    }

    if (shouldRestore) {
      const restore = tryRunGit(["checkout", current.ref], opts.repoRoot);
      if (!restore.ok) {
        cleanupErrors.push(`restore checkout failed: ${restore.stderr}`);
      }
    }

    if (mergeError) {
      const suffix = cleanupErrors.length > 0 ? `; ${cleanupErrors.join("; ")}` : "";
      throw new Error(`${mergeError}${suffix}`);
    }
    if (cleanupErrors.length > 0) {
      throw new Error(cleanupErrors.join("; "));
    }
  }

  currentBranch(repoRoot: string): string {
    return runGit(["branch", "--show-current"], repoRoot);
  }
}
