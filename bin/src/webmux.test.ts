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
    delete process.env.WEBMUX_PREFIX;

    expect(parseRootArgs(["serve", "--port", "8080", "--debug"])).toEqual({
      port: 8080,
      portExplicit: true,
      debug: true,
      app: false,
      prefix: null,
      command: "serve",
      commandArgs: [],
    });
  });

  it("parses --app flag", () => {
    delete process.env.PORT;
    delete process.env.WEBMUX_PREFIX;

    expect(parseRootArgs(["serve", "--app"])).toEqual({
      port: 5111,
      portExplicit: false,
      debug: false,
      app: true,
      prefix: null,
      command: "serve",
      commandArgs: [],
    });
  });

  it("parses --prefix flag", () => {
    delete process.env.PORT;
    delete process.env.WEBMUX_PREFIX;

    expect(parseRootArgs(["serve", "--prefix", "myproj"])).toEqual({
      port: 5111,
      portExplicit: false,
      debug: false,
      app: false,
      prefix: "myproj",
      command: "serve",
      commandArgs: [],
    });
  });

  it("reads WEBMUX_PREFIX from env", () => {
    delete process.env.PORT;
    process.env.WEBMUX_PREFIX = "envproj";
    try {
      expect(parseRootArgs(["serve"])).toEqual({
        port: 5111,
        portExplicit: false,
        debug: false,
        app: false,
        prefix: "envproj",
        command: "serve",
        commandArgs: [],
      });
    } finally {
      delete process.env.WEBMUX_PREFIX;
    }
  });

  it("treats PORT from env as an explicit port", () => {
    process.env.PORT = "5500";
    delete process.env.WEBMUX_PREFIX;

    expect(parseRootArgs(["serve"])).toEqual({
      port: 5500,
      portExplicit: true,
      debug: false,
      app: false,
      prefix: null,
      command: "serve",
      commandArgs: [],
    });
  });

  it("leaves service subcommand flags untouched", () => {
    delete process.env.PORT;
    delete process.env.WEBMUX_PREFIX;

    expect(parseRootArgs(["service", "install", "--port", "8080"])).toEqual({
      port: 5111,
      portExplicit: false,
      debug: false,
      app: false,
      prefix: null,
      command: "service",
      commandArgs: ["install", "--port", "8080"],
    });
  });

  it("parses prune as a worktree command", () => {
    delete process.env.PORT;
    delete process.env.WEBMUX_PREFIX;

    expect(parseRootArgs(["prune"])).toEqual({
      port: 5111,
      portExplicit: false,
      debug: false,
      app: false,
      prefix: null,
      command: "prune",
      commandArgs: [],
    });
  });

  it("parses archive as a worktree command", () => {
    delete process.env.PORT;
    delete process.env.WEBMUX_PREFIX;

    expect(parseRootArgs(["archive", "feature/search"])).toEqual({
      port: 5111,
      portExplicit: false,
      debug: false,
      app: false,
      prefix: null,
      command: "archive",
      commandArgs: ["feature/search"],
    });
  });

  it("parses refresh as a worktree command", () => {
    delete process.env.PORT;
    delete process.env.WEBMUX_PREFIX;

    expect(parseRootArgs(["refresh", "feature/search"])).toEqual({
      port: 5111,
      portExplicit: false,
      debug: false,
      app: false,
      prefix: null,
      command: "refresh",
      commandArgs: ["feature/search"],
    });
  });

  it("parses label as a worktree command", () => {
    delete process.env.PORT;
    delete process.env.WEBMUX_PREFIX;

    expect(parseRootArgs(["label", "feature/search", "Search", "ranking"])).toEqual({
      port: 5111,
      portExplicit: false,
      debug: false,
      app: false,
      prefix: null,
      command: "label",
      commandArgs: ["feature/search", "Search", "ranking"],
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
