import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureAgentRuntimeArtifacts } from "../adapters/agent-runtime";
import { ensureWorktreeStorageDirs } from "../adapters/fs";

describe("ensureAgentRuntimeArtifacts", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("writes agent control helpers and Claude hook settings into worktree-owned paths", async () => {
    const gitDir = await mkdtemp(join(tmpdir(), "webmux-agent-runtime-gitdir-"));
    const worktreePath = await mkdtemp(join(tmpdir(), "webmux-agent-runtime-worktree-"));
    tempDirs.push(gitDir, worktreePath);

    await ensureWorktreeStorageDirs(gitDir);
    const artifacts = await ensureAgentRuntimeArtifacts({
      gitDir,
      worktreePath,
    });

    expect(await Bun.file(artifacts.agentCtlPath).text()).toContain("webmux-agentctl");
    expect(await Bun.file(artifacts.stopHookPath).text()).toContain("agent-stopped");
    expect(await Bun.file(artifacts.postToolUseHookPath).text()).toContain("pr-opened");

    const settings = await Bun.file(artifacts.claudeSettingsPath).json() as {
      hooks?: {
        Stop?: Array<{ hooks?: Array<{ command?: string }> }>;
        PostToolUse?: Array<{ hooks?: Array<{ command?: string }> }>;
      };
    };

    expect(settings.hooks?.Stop?.[0]?.hooks?.[0]?.command).toContain("claude-stop-hook");
    expect(settings.hooks?.PostToolUse?.[0]?.hooks?.[0]?.command).toContain("claude-post-tool-use-hook");
  });
});
