import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
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
      command: "serve",
      commandArgs: [],
    });
  });

  it("leaves service subcommand flags untouched", () => {
    delete process.env.PORT;

    expect(parseRootArgs(["service", "install", "--port", "8080"])).toEqual({
      port: 5111,
      debug: false,
      command: "service",
      commandArgs: ["install", "--port", "8080"],
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
});
