import { describe, expect, it } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AutoNameService } from "../services/auto-name-service";

async function getClaudeCliFlags(): Promise<Set<string>> {
  const proc = Bun.spawn(["claude", "--help"], { stdout: "pipe", stderr: "pipe" });
  const output = await new Response(proc.stdout).text();
  await proc.exited;
  const flags = new Set<string>();
  for (const match of output.matchAll(/--[\w-]+/g)) {
    flags.add(match[0]);
  }
  return flags;
}

function fakeSpawn(stdout: string, exitCode = 0, stderr = "") {
  const calls: string[][] = [];
  const spawnImpl = async (args: string[]) => {
    calls.push(args);
    return { exitCode, stdout, stderr };
  };
  return { calls, spawnImpl };
}

describe("AutoNameService", () => {
  it("spawns claude -p with correct args", async () => {
    const { calls, spawnImpl } = fakeSpawn("fix-login-flow");
    const service = new AutoNameService({ spawnImpl });

    const branch = await service.generateBranchName(
      { provider: "claude", systemPrompt: "Generate a branch name" },
      "Fix the login flow",
    );

    expect(branch).toBe("fix-login-flow");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([
      "claude", "-p",
      "--system-prompt", "Generate a branch name",
      "--output-format", "text",
      "--no-session-persistence",
      "--model", "claude-haiku-4-5-20251001",
      "--effort", "low",
      "Here is the task description: Fix the login flow. You MUST return the branch name only, no other text or comments. Be fast, make it simple, and concise.",
    ]);
  });

  it("passes --model to claude when model is specified", async () => {
    const { calls, spawnImpl } = fakeSpawn("add-search");
    const service = new AutoNameService({ spawnImpl });

    await service.generateBranchName(
      { provider: "claude", model: "haiku" },
      "Add search",
    );

    expect(calls[0]).toContain("--model");
    expect(calls[0]).toContain("haiku");
  });

  it("uses default haiku model when model is not specified", async () => {
    const { calls, spawnImpl } = fakeSpawn("add-search");
    const service = new AutoNameService({ spawnImpl });

    await service.generateBranchName(
      { provider: "claude" },
      "Add search",
    );

    expect(calls[0]).toContain("--model");
    expect(calls[0]).toContain("claude-haiku-4-5-20251001");
  });

  it("spawns codex exec with correct args", async () => {
    const { calls, spawnImpl } = fakeSpawn("improve-search-ranking");
    const service = new AutoNameService({ spawnImpl });

    const branch = await service.generateBranchName(
      { provider: "codex", systemPrompt: "Generate a branch name" },
      "Improve search ranking",
    );

    expect(branch).toBe("improve-search-ranking");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([
      "codex",
      "-c", 'developer_instructions="Generate a branch name"',
      "exec",
      "--ephemeral",
      "Here is the task description: Improve search ranking. You MUST return the branch name only, no other text or comments. Be fast, make it simple, and concise.",
    ]);
  });

  it("passes -m to codex when model is specified", async () => {
    const { calls, spawnImpl } = fakeSpawn("add-bulk-actions");
    const service = new AutoNameService({ spawnImpl });

    await service.generateBranchName(
      { provider: "codex", model: "gpt-4.1" },
      "Add bulk actions",
    );

    expect(calls[0]).toContain("-m");
    expect(calls[0]).toContain("gpt-4.1");
  });

  it("passes the configured timeout to the spawn implementation", async () => {
    const timeouts: Array<number | undefined> = [];
    const service = new AutoNameService({
      timeoutMs: 1234,
      spawnImpl: async (_args, options) => {
        timeouts.push(options?.timeoutMs);
        return { exitCode: 0, stdout: "test-branch", stderr: "" };
      },
    });

    await service.generateBranchName(
      { provider: "claude" },
      "Test timeout wiring",
    );

    expect(timeouts).toEqual([1234]);
  });

  it("omits -m from codex when model is not specified", async () => {
    const { calls, spawnImpl } = fakeSpawn("add-bulk-actions");
    const service = new AutoNameService({ spawnImpl });

    await service.generateBranchName(
      { provider: "codex" },
      "Add bulk actions",
    );

    expect(calls[0]).not.toContain("-m");
  });

  it("uses default system prompt when none provided", async () => {
    const { calls, spawnImpl } = fakeSpawn("fix-bug");
    const service = new AutoNameService({ spawnImpl });

    await service.generateBranchName({ provider: "claude" }, "Fix bug");

    const systemPromptIdx = calls[0].indexOf("--system-prompt");
    expect(calls[0][systemPromptIdx + 1]).toContain("Generate a concise git branch name");
  });

  it("normalizes messy output into a valid branch name", async () => {
    const { spawnImpl } = fakeSpawn('```\n"Fix-Login-Flow"\n```');
    const service = new AutoNameService({ spawnImpl });

    const branch = await service.generateBranchName(
      { provider: "claude" },
      "Fix login",
    );

    expect(branch).toBe("fix-login-flow");
  });

  it("throws when CLI is not found", async () => {
    const service = new AutoNameService({
      spawnImpl: async () => { throw new Error("ENOENT"); },
    });

    await expect(
      service.generateBranchName({ provider: "claude" }, "Fix bug"),
    ).rejects.toThrow("'claude' CLI not found");
  });

  it("throws on non-zero exit code", async () => {
    const { spawnImpl } = fakeSpawn("", 1, "authentication required");
    const service = new AutoNameService({ spawnImpl });

    await expect(
      service.generateBranchName({ provider: "codex" }, "Fix bug"),
    ).rejects.toThrow(/codex failed \(command: .*\): authentication required/);
  });

  it("returns a change-prefixed fallback branch when the real spawn path times out", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "webmux-auto-name-"));
    const claudePath = join(tempDir, "claude");
    await Bun.write(
      claudePath,
      "#!/bin/sh\ntrap '' TERM\nwhile true; do sleep 1; done\n",
    );
    await chmod(claudePath, 0o755);

    const originalPath = Bun.env.PATH;
    const timeoutMs = 50;
    const deadlineMs = 1_000;
    Bun.env.PATH = originalPath ? `${tempDir}:${originalPath}` : tempDir;
    process.env.PATH = Bun.env.PATH;

    try {
      const startedAt = Date.now();
      const branch = await Promise.race([
        new AutoNameService({ timeoutMs }).generateBranchName(
          { provider: "claude" },
          "Fix bug",
        ),
        Bun.sleep(deadlineMs).then(() => {
          throw new Error("timed out waiting for auto-name timeout fallback");
        }),
      ]);

      expect(Date.now() - startedAt).toBeLessThan(deadlineMs);
      expect(branch).toMatch(/^change-[a-f0-9]{8}$/);
    } finally {
      Bun.env.PATH = originalPath;
      process.env.PATH = originalPath;
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("throws on empty output", async () => {
    const { spawnImpl } = fakeSpawn("");
    const service = new AutoNameService({ spawnImpl });

    await expect(
      service.generateBranchName({ provider: "claude" }, "Fix bug"),
    ).rejects.toThrow("claude returned empty output");
  });

  it("truncates branch names longer than 40 characters", async () => {
    const { spawnImpl } = fakeSpawn("this-is-a-very-long-branch-name-that-exceeds-the-forty-character-limit");
    const service = new AutoNameService({ spawnImpl });

    const branch = await service.generateBranchName(
      { provider: "claude" },
      "A very long task description",
    );

    expect(branch.length).toBeLessThanOrEqual(40);
    expect(branch).toBe("this-is-a-very-long-branch-name-that-exc");
  });

  it("removes trailing hyphens after truncation", async () => {
    // 40th char lands right after a hyphen: "a]b-c" → truncate at 40 → trailing hyphen
    const { spawnImpl } = fakeSpawn("add-feature-to-handle-user-authentication-flow");
    const service = new AutoNameService({ spawnImpl });

    const branch = await service.generateBranchName(
      { provider: "claude" },
      "Some task",
    );

    expect(branch.length).toBeLessThanOrEqual(40);
    expect(branch).not.toMatch(/-$/);
  });

  it("only uses flags supported by the claude CLI", async () => {
    const { calls, spawnImpl } = fakeSpawn("test-branch");
    const service = new AutoNameService({ spawnImpl });

    await service.generateBranchName({ provider: "claude" }, "Test task");

    const cliFlags = await getClaudeCliFlags();
    const usedFlags = calls[0].filter((arg) => arg.startsWith("--"));
    for (const flag of usedFlags) {
      expect(cliFlags.has(flag)).toBe(true);
    }
  });

  it("escapes special characters in system prompt for codex TOML config", async () => {
    const { calls, spawnImpl } = fakeSpawn("fix-bug");
    const service = new AutoNameService({ spawnImpl });

    await service.generateBranchName(
      { provider: "codex", systemPrompt: 'Use "kebab-case"\nNo prefixes' },
      "Fix bug",
    );

    const cIdx = calls[0].indexOf("-c");
    expect(calls[0][cIdx + 1]).toBe('developer_instructions="Use \\"kebab-case\\"\\nNo prefixes"');
  });
});
