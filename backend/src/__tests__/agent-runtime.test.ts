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
    expect(await Bun.file(artifacts.agentCtlPath).text()).toContain("claude-user-prompt-submit");
    expect(await Bun.file(artifacts.agentCtlPath).text()).toContain("agent_status_changed");

    const settings = await Bun.file(artifacts.claudeSettingsPath).json() as {
      hooks?: {
        UserPromptSubmit?: Array<{ hooks?: Array<{ command?: string }> }>;
        Notification?: Array<{ matcher?: string; hooks?: Array<{ command?: string }> }>;
        Stop?: Array<{ hooks?: Array<{ command?: string }> }>;
        PostToolUse?: Array<{ hooks?: Array<{ command?: string }> }>;
      };
    };

    expect(settings.hooks?.UserPromptSubmit?.[0]?.hooks?.[0]?.command).toContain("webmux-agentctl");
    expect(settings.hooks?.UserPromptSubmit?.[0]?.hooks?.[0]?.command).toContain("claude-user-prompt-submit");
    expect(settings.hooks?.Notification?.[0]?.matcher).toBe("permission_prompt|elicitation_dialog");
    expect(settings.hooks?.Notification?.[0]?.hooks?.[0]?.command).toContain("status-changed --lifecycle idle");
    expect(settings.hooks?.Stop?.[0]?.hooks?.[0]?.command).toContain("agent-stopped");
    expect(settings.hooks?.PostToolUse?.[0]?.hooks?.[0]?.command).toContain("status-changed --lifecycle running");
    expect(settings.hooks?.PostToolUse?.[1]?.hooks?.[0]?.command).toContain("claude-post-tool-use");
  });
});
