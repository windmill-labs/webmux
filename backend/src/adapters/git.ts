import { readdirSync, rmSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

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
  startPoint?: string;
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

export interface UnpushedCommit {
  hash: string;
  message: string;
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
  resolveRepoRoot(dir: string): string | null;
  resolveWorktreeRoot(cwd: string): string;
  resolveWorktreeGitDir(cwd: string): string;
  listWorktrees(cwd: string): GitWorktreeEntry[];
  listLocalBranches(cwd: string): string[];
  listRemoteBranches(cwd: string): string[];
  readWorktreeStatus(cwd: string): GitWorktreeStatus;
  createWorktree(opts: CreateGitWorktreeOptions): void;
  removeWorktree(opts: RemoveGitWorktreeOptions): void;
  deleteBranch(repoRoot: string, branch: string, force?: boolean): void;
  mergeBranch(opts: MergeGitBranchOptions): void;
  currentBranch(repoRoot: string): string;
  readDiff(cwd: string): string;
  listUnpushedCommits(cwd: string): UnpushedCommit[];
  fetchBranch(repoRoot: string, remote: string, branch: string): TryGitCommandResult;
  fastForwardMerge(repoRoot: string, ref: string): TryGitCommandResult;
  hardReset(repoRoot: string, ref: string): TryGitCommandResult;
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

/**
 * Resolve the git repo root for a directory. If `dir` is already inside a git
 * repo, returns its toplevel. If not (e.g. a worktree-root container), scans
 * immediate children for a git worktree and resolves the main repo from there.
 * Returns null when no repo can be found.
 */
export function resolveRepoRoot(dir: string): string | null {
  const direct = tryRunGit(["rev-parse", "--show-toplevel"], dir);
  if (direct.ok) return resolve(dir, direct.stdout);

  // dir is not a git repo — check if it's a worktree container
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  for (const entry of entries) {
    const child = join(dir, entry);
    try {
      if (!statSync(child).isDirectory()) continue;
    } catch {
      continue;
    }
    const childResult = tryRunGit(["rev-parse", "--show-toplevel"], child);
    if (childResult.ok) return resolve(child, childResult.stdout);
  }
  return null;
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

export function listRemoteGitBranches(cwd: string): string[] {
  try {
    runGit(["fetch", "--prune", "origin"], cwd);
  } catch {
    // Fetch failed (e.g. no network) — list whatever is cached locally
  }
  const output = runGit(["for-each-ref", "--format=%(refname:short)", "refs/remotes/origin"], cwd);
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/^origin\//, ""))
    // Defensive: some repos expose a bare symbolic `origin` ref alongside origin/*.
    .filter((name) => name !== "HEAD" && name !== "origin");
}

export function readGitWorktreeStatus(cwd: string): GitWorktreeStatus {
  const dirtyOutput = runGit(["status", "--porcelain"], cwd);
  const commit = tryRunGit(["rev-parse", "HEAD"], cwd);
  let ahead = tryRunGit(["rev-list", "--count", "@{upstream}..HEAD"], cwd);
  if (!ahead.ok) {
    // Fallback: counts commits not on any origin/* branch. May slightly over-count
    // on repos with many branches, but is a reasonable default when no upstream is set.
    ahead = tryRunGit(["rev-list", "--count", "HEAD", "--not", "--remotes=origin"], cwd);
  }

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
  resolveRepoRoot(dir: string): string | null {
    return resolveRepoRoot(dir);
  }

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

  listRemoteBranches(cwd: string): string[] {
    return listRemoteGitBranches(cwd);
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
      if (opts.startPoint) {
        args.push("-b", opts.branch, opts.worktreePath, opts.startPoint);
      } else {
        args.push(opts.worktreePath, opts.branch);
      }
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

  readDiff(cwd: string): string {
    const result = tryRunGit(["diff", "HEAD", "--no-color"], cwd);
    return result.ok ? result.stdout : "";
  }

  listUnpushedCommits(cwd: string): UnpushedCommit[] {
    let result = tryRunGit(["log", "--oneline", "@{upstream}..HEAD"], cwd);
    if (!result.ok) {
      // Fallback: see comment in readGitWorktreeStatus for trade-off
      result = tryRunGit(["log", "--oneline", "HEAD", "--not", "--remotes=origin"], cwd);
    }
    if (!result.ok || !result.stdout) return [];
    return result.stdout
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => {
        const spaceIdx = line.indexOf(" ");
        return {
          hash: line.slice(0, spaceIdx),
          message: line.slice(spaceIdx + 1),
        };
      });
  }

  fetchBranch(repoRoot: string, remote: string, branch: string): TryGitCommandResult {
    return tryRunGit(["fetch", remote, branch], repoRoot);
  }

  fastForwardMerge(repoRoot: string, ref: string): TryGitCommandResult {
    return tryRunGit(["merge", "--ff-only", ref], repoRoot);
  }

  hardReset(repoRoot: string, ref: string): TryGitCommandResult {
    return tryRunGit(["reset", "--hard", ref], repoRoot);
  }
}
