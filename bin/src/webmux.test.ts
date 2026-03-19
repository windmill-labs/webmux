import { afterEach, describe, expect, it } from "bun:test";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRootArgs } from "./webmux";

const tempDirs: string[] = [];
const decoder = new TextDecoder();
const webmuxEntry = join(dirname(fileURLToPath(import.meta.url)), "webmux.ts");
const originalPort = process.env.PORT;

function runOrThrow(cmd: string[], cwd: string): void {
  const result = Bun.spawnSync(cmd, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  if (result.exitCode === 0) {
    return;
  }

  throw new Error(decoder.decode(result.stderr).trim());
}

async function initRepo(repoRoot: string): Promise<void> {
  runOrThrow(["git", "init", "-b", "main"], repoRoot);
  runOrThrow(["git", "config", "user.name", "Webmux Test"], repoRoot);
  runOrThrow(["git", "config", "user.email", "webmux@example.com"], repoRoot);
  await Bun.write(join(repoRoot, "README.md"), "# test\n");
  runOrThrow(["git", "add", "README.md"], repoRoot);
  runOrThrow(["git", "commit", "-m", "init"], repoRoot);
}

async function installFakeTmux(binDir: string): Promise<void> {
  const tmuxPath = join(binDir, "tmux");
  await Bun.write(
    tmuxPath,
    [
      "#!/usr/bin/env bash",
      "command=\"$1\"",
      'if [ \"$command\" = \"kill-window\" ] || [ \"$command\" = \"list-windows\" ]; then',
      "  exit 0",
      "fi",
      "exit 0",
      "",
    ].join("\n"),
  );
  await chmod(tmuxPath, 0o755);
}

describe("webmux entrypoint", () => {
  afterEach(async () => {
    if (originalPort === undefined) {
      delete process.env.PORT;
    } else {
      process.env.PORT = originalPort;
    }
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("parses serve flags after the subcommand", () => {
    delete process.env.PORT;

    expect(parseRootArgs(["serve", "--port", "8080", "--debug"])).toEqual({
      port: 8080,
      debug: true,
      app: false,
      command: "serve",
      commandArgs: [],
    });
  });

  it("parses --app flag", () => {
    delete process.env.PORT;

    expect(parseRootArgs(["serve", "--app"])).toEqual({
      port: 5111,
      debug: false,
      app: true,
      command: "serve",
      commandArgs: [],
    });
  });

  it("leaves service subcommand flags untouched", () => {
    delete process.env.PORT;

    expect(parseRootArgs(["service", "install", "--port", "8080"])).toEqual({
      port: 5111,
      debug: false,
      app: false,
      command: "service",
      commandArgs: ["install", "--port", "8080"],
    });
  });

  it("parses prune as a worktree command", () => {
    delete process.env.PORT;

    expect(parseRootArgs(["prune"])).toEqual({
      port: 5111,
      debug: false,
      app: false,
      command: "prune",
      commandArgs: [],
    });
  });

  it("runs worktree commands from a project subdirectory", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "webmux-cli-"));
    tempDirs.push(repoRoot);

    await initRepo(repoRoot);
    await Bun.write(join(repoRoot, ".webmux.yaml"), "name: Test\n");

    const nestedDir = join(repoRoot, "nested", "dir");
    await mkdir(nestedDir, { recursive: true });

    const result = Bun.spawnSync(["bun", webmuxEntry, "open", "missing-branch"], {
      cwd: nestedDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderr = decoder.decode(result.stderr).trim();

    expect(result.exitCode).toBe(1);
    expect(stderr).not.toContain("No .webmux.yaml found in this directory.");
    expect(stderr).toContain("Worktree not found: missing-branch");
  });

  it("removes the current linked worktree when invoked from inside it", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "webmux-cli-"));
    tempDirs.push(repoRoot);

    await initRepo(repoRoot);
    await Bun.write(
      join(repoRoot, ".webmux.yaml"),
      [
        "name: Test",
        "workspace:",
        "  mainBranch: main",
        "  worktreeRoot: __worktrees",
        "",
      ].join("\n"),
    );

    const worktreesRoot = join(repoRoot, "__worktrees");
    await mkdir(worktreesRoot, { recursive: true });
    const fakeBin = join(repoRoot, ".test-bin");
    await mkdir(fakeBin, { recursive: true });
    await installFakeTmux(fakeBin);

    const worktreePath = join(worktreesRoot, "feature-self-remove");
    runOrThrow(["git", "worktree", "add", "-b", "feature-self-remove", worktreePath], repoRoot);

    const result = Bun.spawnSync(["bun", webmuxEntry, "remove", "feature-self-remove"], {
      cwd: worktreePath,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
      },
    });
    const stdout = decoder.decode(result.stdout).trim();
    const stderr = decoder.decode(result.stderr).trim();
    const worktreeList = Bun.spawnSync(["git", "worktree", "list", "--porcelain"], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);
    expect(stdout).toContain("Removed worktree feature-self-remove");
    expect(stderr).toBe("");
    expect(decoder.decode(worktreeList.stdout)).not.toContain(worktreePath);
  });
});
