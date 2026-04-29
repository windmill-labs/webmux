import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureAgentRuntimeArtifacts } from "../adapters/agent-runtime";
import { ensureWorktreeStorageDirs } from "../adapters/fs";

describe("ensureAgentRuntimeArtifacts", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("writes agent control helpers and agent hook settings into worktree-owned paths", async () => {
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
    expect(await Bun.file(artifacts.agentCtlPath).text()).toContain("codex-user-prompt-submit");
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

    const codexHooks = await Bun.file(artifacts.codexHooksPath).json() as {
      hooks?: {
        SessionStart?: Array<{ matcher?: string; hooks?: Array<{ command?: string; timeout?: number }> }>;
        UserPromptSubmit?: Array<{ hooks?: Array<{ command?: string; timeout?: number }> }>;
        PermissionRequest?: Array<{ hooks?: Array<{ command?: string; timeout?: number }> }>;
        PreToolUse?: Array<{ hooks?: Array<{ command?: string; timeout?: number }> }>;
        Stop?: Array<{ hooks?: Array<{ command?: string; timeout?: number }> }>;
        PostToolUse?: Array<{ matcher?: string; hooks?: Array<{ command?: string; timeout?: number }> }>;
      };
    };

    expect(codexHooks.hooks?.SessionStart?.[0]?.matcher).toBe("startup|resume|clear");
    expect(codexHooks.hooks?.SessionStart?.[0]?.hooks?.[0]?.command).toContain("codex-session-start");
    expect(codexHooks.hooks?.UserPromptSubmit?.[0]?.hooks?.[0]?.command).toContain("codex-user-prompt-submit");
    expect(codexHooks.hooks?.PermissionRequest?.[0]?.hooks?.[0]?.command).toContain("codex-permission-request");
    expect(codexHooks.hooks?.PreToolUse?.[0]?.hooks?.[0]?.command).toContain("status-changed --lifecycle running");
    expect(codexHooks.hooks?.Stop?.[0]?.hooks?.[0]?.command).toContain("codex-stop");
    expect(codexHooks.hooks?.PostToolUse?.[0]?.hooks?.[0]?.command).toContain("status-changed --lifecycle running");
    expect(codexHooks.hooks?.PostToolUse?.[1]?.matcher).toBe("Bash");
    expect(codexHooks.hooks?.PostToolUse?.[1]?.hooks?.[0]?.command).toContain("codex-post-tool-use");
    expect(codexHooks.hooks?.PostToolUse?.[1]?.hooks?.[0]?.timeout).toBe(30);
    expect(await Bun.file(join(gitDir, "info", "exclude")).text()).toContain(".codex/hooks.json");
  });

  it("preserves non-webmux Codex hooks when refreshing generated hooks", async () => {
    const gitDir = await mkdtemp(join(tmpdir(), "webmux-agent-runtime-gitdir-"));
    const worktreePath = await mkdtemp(join(tmpdir(), "webmux-agent-runtime-worktree-"));
    tempDirs.push(gitDir, worktreePath);

    await ensureWorktreeStorageDirs(gitDir);
    await mkdir(join(worktreePath, ".codex"), { recursive: true });
    await Bun.write(
      join(worktreePath, ".codex", "hooks.json"),
      JSON.stringify({
        hooks: {
          UserPromptSubmit: [
            {
              hooks: [
                {
                  type: "command",
                  command: "echo keep-me",
                },
              ],
            },
            {
              hooks: [
                {
                  type: "command",
                  command: "/old/webmux-agentctl codex-user-prompt-submit",
                },
              ],
            },
          ],
        },
      }, null, 2) + "\n",
    );

    const artifacts = await ensureAgentRuntimeArtifacts({
      gitDir,
      worktreePath,
    });
    await ensureAgentRuntimeArtifacts({
      gitDir,
      worktreePath,
    });

    const codexHooks = await Bun.file(artifacts.codexHooksPath).json() as {
      hooks?: {
        UserPromptSubmit?: Array<{ hooks?: Array<{ command?: string }> }>;
      };
    };
    const commands = codexHooks.hooks?.UserPromptSubmit?.flatMap((group) =>
      group.hooks?.map((hook) => hook.command ?? "") ?? []
    ) ?? [];

    expect(commands.filter((command) => command.includes("keep-me"))).toHaveLength(1);
    expect(commands.filter((command) => command.includes("codex-user-prompt-submit"))).toHaveLength(1);
    expect(commands.some((command) => command.includes("/old/webmux-agentctl"))).toBe(false);
  });
});
