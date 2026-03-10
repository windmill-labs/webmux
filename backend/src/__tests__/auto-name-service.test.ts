import { describe, expect, it } from "bun:test";
import { AutoNameService } from "../services/auto-name-service";

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
      "Task description:\nFix the login flow",
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

  it("omits --model from claude when model is not specified", async () => {
    const { calls, spawnImpl } = fakeSpawn("add-search");
    const service = new AutoNameService({ spawnImpl });

    await service.generateBranchName(
      { provider: "claude" },
      "Add search",
    );

    expect(calls[0]).not.toContain("--model");
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
      "Task description:\nImprove search ranking",
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
    ).rejects.toThrow("codex failed: authentication required");
  });

  it("throws on empty output", async () => {
    const { spawnImpl } = fakeSpawn("");
    const service = new AutoNameService({ spawnImpl });

    await expect(
      service.generateBranchName({ provider: "claude" }, "Fix bug"),
    ).rejects.toThrow("claude returned empty output");
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
