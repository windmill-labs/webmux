import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BunGitGateway,
  listLocalGitBranches,
  parseGitWorktreePorcelain,
  readGitWorktreeStatus,
  removeGitWorktree,
  resolveWorktreeGitDir,
  resolveWorktreeRoot,
} from "../adapters/git";

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
}

function run(args: string[], cwd: string): void {
  const result = Bun.spawnSync(args, { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    const stderr = new TextDecoder().decode(result.stderr).trim();
    throw new Error(`${args.join(" ")} failed: ${stderr || `exit ${result.exitCode}`}`);
  }
}

function read(args: string[], cwd: string): string {
  const result = Bun.spawnSync(args, { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    const stderr = new TextDecoder().decode(result.stderr).trim();
    throw new Error(`${args.join(" ")} failed: ${stderr || `exit ${result.exitCode}`}`);
  }

  return new TextDecoder().decode(result.stdout).trim();
}

describe("parseGitWorktreePorcelain", () => {
  it("parses branch and detached entries", () => {
    const output = [
      "worktree /repo",
      "HEAD abc123",
      "branch refs/heads/main",
      "",
      "worktree /repo__worktrees/feature",
      "HEAD def456",
      "detached",
      "",
    ].join("\n");

    expect(parseGitWorktreePorcelain(output)).toEqual([
      {
        path: "/repo",
        head: "abc123",
        branch: "main",
        detached: false,
        bare: false,
      },
      {
        path: "/repo__worktrees/feature",
        head: "def456",
        branch: null,
        detached: true,
        bare: false,
      },
    ]);
  });
});

describe("git worktree path resolution", () => {
  let repoRoot = "";

  afterEach(async () => {
    if (repoRoot) {
      await rm(repoRoot, { recursive: true, force: true });
      repoRoot = "";
    }
  });

  it("resolves the worktree root and worktree git admin dir for linked worktrees", async () => {
    repoRoot = await mkdtemp(join(tmpdir(), "webmux-git-"));
    run(["git", "init", "-b", "main"], repoRoot);
    run(["git", "config", "user.name", "Test User"], repoRoot);
    run(["git", "config", "user.email", "test@example.com"], repoRoot);

    await Bun.write(join(repoRoot, "README.md"), "# repo\n");
    run(["git", "add", "README.md"], repoRoot);
    run(["git", "commit", "-m", "init"], repoRoot);

    const worktreesRoot = join(repoRoot, "__worktrees");
    await mkdir(worktreesRoot, { recursive: true });
    const worktreePath = join(worktreesRoot, "feature");
    run(["git", "worktree", "add", "-b", "feature", worktreePath], repoRoot);

    expect(resolveWorktreeRoot(worktreePath)).toBe(worktreePath);

    const gitDir = normalizePath(resolveWorktreeGitDir(worktreePath));
    expect(gitDir).toContain("/.git/worktrees/feature");
  });
});

describe("BunGitGateway", () => {
  let repoRoot = "";

  afterEach(async () => {
    if (repoRoot) {
      await rm(repoRoot, { recursive: true, force: true });
      repoRoot = "";
    }
  });

  it("creates and removes worktrees", async () => {
    repoRoot = await mkdtemp(join(tmpdir(), "webmux-gitgw-"));
    run(["git", "init", "-b", "main"], repoRoot);
    run(["git", "config", "user.name", "Test User"], repoRoot);
    run(["git", "config", "user.email", "test@example.com"], repoRoot);
    await Bun.write(join(repoRoot, "README.md"), "# repo\n");
    run(["git", "add", "README.md"], repoRoot);
    run(["git", "commit", "-m", "init"], repoRoot);

    const gateway = new BunGitGateway();
    const worktreePath = join(repoRoot, "__worktrees", "feature-a");
    await mkdir(join(repoRoot, "__worktrees"), { recursive: true });

    gateway.createWorktree({
      repoRoot,
      worktreePath,
      branch: "feature-a",
      mode: "new",
      baseBranch: "main",
    });

    expect(Bun.file(join(worktreePath, "README.md")).size).toBeGreaterThan(0);
    expect(gateway.listWorktrees(repoRoot).some((entry) => entry.path === worktreePath)).toBe(true);

    gateway.removeWorktree({
      repoRoot,
      worktreePath,
    });

    expect(gateway.listWorktrees(repoRoot).some((entry) => entry.path === worktreePath)).toBe(false);
  });

  it("creates a worktree for an existing branch", async () => {
    repoRoot = await mkdtemp(join(tmpdir(), "webmux-gitgw-existing-"));
    run(["git", "init", "-b", "main"], repoRoot);
    run(["git", "config", "user.name", "Test User"], repoRoot);
    run(["git", "config", "user.email", "test@example.com"], repoRoot);
    await Bun.write(join(repoRoot, "README.md"), "# repo\n");
    run(["git", "add", "README.md"], repoRoot);
    run(["git", "commit", "-m", "init"], repoRoot);
    run(["git", "checkout", "-b", "feature-existing"], repoRoot);
    run(["git", "checkout", "main"], repoRoot);

    const gateway = new BunGitGateway();
    const worktreePath = join(repoRoot, "__worktrees", "feature-existing");
    await mkdir(join(repoRoot, "__worktrees"), { recursive: true });

    gateway.createWorktree({
      repoRoot,
      worktreePath,
      branch: "feature-existing",
      mode: "existing",
    });

    expect(gateway.listWorktrees(repoRoot).some((entry) => entry.path === worktreePath)).toBe(true);
    expect(read(["git", "branch", "--show-current"], worktreePath)).toBe("feature-existing");
  });

  it("lists local branches", async () => {
    repoRoot = await mkdtemp(join(tmpdir(), "webmux-gitgw-branches-"));
    run(["git", "init", "-b", "main"], repoRoot);
    run(["git", "config", "user.name", "Test User"], repoRoot);
    run(["git", "config", "user.email", "test@example.com"], repoRoot);
    await Bun.write(join(repoRoot, "README.md"), "# repo\n");
    run(["git", "add", "README.md"], repoRoot);
    run(["git", "commit", "-m", "init"], repoRoot);
    run(["git", "checkout", "-b", "feature-a"], repoRoot);
    run(["git", "checkout", "-b", "feature-b", "main"], repoRoot);
    run(["git", "checkout", "main"], repoRoot);

    expect(listLocalGitBranches(repoRoot)).toEqual(["feature-a", "feature-b", "main"]);
  });

  it("merges a source branch into a target branch", async () => {
    repoRoot = await mkdtemp(join(tmpdir(), "webmux-mergegw-"));
    run(["git", "init", "-b", "main"], repoRoot);
    run(["git", "config", "user.name", "Test User"], repoRoot);
    run(["git", "config", "user.email", "test@example.com"], repoRoot);
    await Bun.write(join(repoRoot, "README.md"), "# repo\n");
    run(["git", "add", "README.md"], repoRoot);
    run(["git", "commit", "-m", "init"], repoRoot);

    run(["git", "checkout", "-b", "feature-b"], repoRoot);
    await Bun.write(join(repoRoot, "README.md"), "# repo\nfeature change\n");
    run(["git", "add", "README.md"], repoRoot);
    run(["git", "commit", "-m", "feature"], repoRoot);
    run(["git", "checkout", "main"], repoRoot);

    const gateway = new BunGitGateway();
    gateway.mergeBranch({
      repoRoot,
      sourceBranch: "feature-b",
      targetBranch: "main",
    });

    const log = Bun.spawnSync(["git", "log", "--oneline", "--max-count", "1"], {
      cwd: repoRoot,
      stdout: "pipe",
    });
    const text = new TextDecoder().decode(log.stdout);
    expect(text).toContain("Merge branch 'feature-b'");
  });

  it("restores the original branch after a successful merge into another target branch", async () => {
    repoRoot = await mkdtemp(join(tmpdir(), "webmux-merge-restore-"));
    run(["git", "init", "-b", "main"], repoRoot);
    run(["git", "config", "user.name", "Test User"], repoRoot);
    run(["git", "config", "user.email", "test@example.com"], repoRoot);
    await Bun.write(join(repoRoot, "README.md"), "# repo\n");
    run(["git", "add", "README.md"], repoRoot);
    run(["git", "commit", "-m", "init"], repoRoot);

    run(["git", "checkout", "-b", "feature-restore"], repoRoot);
    await Bun.write(join(repoRoot, "README.md"), "# repo\nfeature change\n");
    run(["git", "add", "README.md"], repoRoot);
    run(["git", "commit", "-m", "feature"], repoRoot);
    run(["git", "checkout", "-b", "dev", "main"], repoRoot);

    const gateway = new BunGitGateway();
    gateway.mergeBranch({
      repoRoot,
      sourceBranch: "feature-restore",
      targetBranch: "main",
    });

    expect(gateway.currentBranch(repoRoot)).toBe("dev");
    expect(read(["git", "log", "--oneline", "--max-count", "1", "main"], repoRoot).includes("Merge branch 'feature-restore'")).toBe(true);
  });

  it("aborts the merge and restores the original branch when merge conflicts", async () => {
    repoRoot = await mkdtemp(join(tmpdir(), "webmux-merge-conflict-"));
    run(["git", "init", "-b", "main"], repoRoot);
    run(["git", "config", "user.name", "Test User"], repoRoot);
    run(["git", "config", "user.email", "test@example.com"], repoRoot);
    await Bun.write(join(repoRoot, "README.md"), "base\n");
    run(["git", "add", "README.md"], repoRoot);
    run(["git", "commit", "-m", "init"], repoRoot);

    run(["git", "checkout", "-b", "feature-conflict"], repoRoot);
    await Bun.write(join(repoRoot, "README.md"), "feature branch change\n");
    run(["git", "add", "README.md"], repoRoot);
    run(["git", "commit", "-m", "feature change"], repoRoot);

    run(["git", "checkout", "main"], repoRoot);
    await Bun.write(join(repoRoot, "README.md"), "main branch change\n");
    run(["git", "add", "README.md"], repoRoot);
    run(["git", "commit", "-m", "main change"], repoRoot);

    run(["git", "checkout", "-b", "dev"], repoRoot);

    const gateway = new BunGitGateway();
    expect(() => {
      gateway.mergeBranch({
        repoRoot,
        sourceBranch: "feature-conflict",
        targetBranch: "main",
      });
    }).toThrow();

    expect(gateway.currentBranch(repoRoot)).toBe("dev");
    const mergeHead = Bun.spawnSync(["git", "rev-parse", "-q", "--verify", "MERGE_HEAD"], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(mergeHead.exitCode).not.toBe(0);
    expect(read(["git", "show", "main:README.md"], repoRoot)).toBe("main branch change");
  });

  it("reads dirty state, ahead count, and current commit", async () => {
    repoRoot = await mkdtemp(join(tmpdir(), "webmux-statusgw-"));
    run(["git", "init", "-b", "main"], repoRoot);
    run(["git", "config", "user.name", "Test User"], repoRoot);
    run(["git", "config", "user.email", "test@example.com"], repoRoot);
    await Bun.write(join(repoRoot, "README.md"), "# repo\n");
    run(["git", "add", "README.md"], repoRoot);
    run(["git", "commit", "-m", "init"], repoRoot);
    run(["git", "checkout", "-b", "feature-status"], repoRoot);
    run(["git", "branch", "--set-upstream-to=main", "feature-status"], repoRoot);
    await Bun.write(join(repoRoot, "README.md"), "# repo\nfeature status\n");
    run(["git", "add", "README.md"], repoRoot);
    run(["git", "commit", "-m", "feature work"], repoRoot);

    const cleanStatus = readGitWorktreeStatus(repoRoot);
    expect(cleanStatus.dirty).toBe(false);
    expect(cleanStatus.aheadCount).toBe(1);
    expect(cleanStatus.currentCommit).not.toBeNull();

    await Bun.write(join(repoRoot, "README.md"), "# repo\nfeature status\ndirty\n");
    const dirtyStatus = new BunGitGateway().readWorktreeStatus(repoRoot);
    expect(dirtyStatus.dirty).toBe(true);
    expect(dirtyStatus.aheadCount).toBe(1);
    expect(dirtyStatus.currentCommit).toBe(cleanStatus.currentCommit);
  });
});

describe("removeGitWorktree", () => {
  it("cleans up the leftover directory when git already unregistered the worktree", () => {
    const removedPaths: string[] = [];

    removeGitWorktree(
      {
        repoRoot: "/repo",
        worktreePath: "/repo/__worktrees/feature-a",
        force: true,
      },
      {
        tryRunGit: () => ({
          ok: false,
          stderr: "error: failed to delete '/repo/__worktrees/feature-a': Directory not empty",
        }),
        listWorktrees: () => [
          {
            path: "/repo",
            head: "abc123",
            branch: "main",
            detached: false,
            bare: false,
          },
        ],
        removeDirectory: (path) => {
          removedPaths.push(path);
        },
      },
    );

    expect(removedPaths).toEqual(["/repo/__worktrees/feature-a"]);
  });

  it("surfaces the git error when the worktree is still registered", () => {
    expect(() => {
      removeGitWorktree(
        {
          repoRoot: "/repo",
          worktreePath: "/repo/__worktrees/feature-a",
          force: true,
        },
        {
          tryRunGit: () => ({
            ok: false,
            stderr: "error: failed to delete '/repo/__worktrees/feature-a': Directory not empty",
          }),
          listWorktrees: () => [
            {
              path: "/repo",
              head: "abc123",
              branch: "main",
              detached: false,
              bare: false,
            },
            {
              path: "/repo/__worktrees/feature-a",
              head: "def456",
              branch: "feature-a",
              detached: false,
              bare: false,
            },
          ],
        },
      );
    }).toThrow("git worktree remove --force /repo/__worktrees/feature-a failed");
  });
});
