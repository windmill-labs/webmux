import { describe, expect, it } from "bun:test";
import {
  buildAgentPaneCommand,
  buildDockerAgentPaneCommand,
  buildDockerShellCommand,
  buildManagedShellCommand,
} from "../services/agent-service";

describe("agent-service command builders", () => {
  it("builds a managed shell command that sources runtime.env", () => {
    const command = buildManagedShellCommand("/tmp/gitdir/webmux/runtime.env", "/bin/zsh");
    expect(command).toContain("bash -lc");
    expect(command).toContain("/tmp/gitdir/webmux/runtime.env");
    expect(command).toContain("set -a");
    expect(command).toContain("set +a");
    expect(command).toContain("/bin/zsh");
  });

  it("wraps agent commands with runtime events and runtime.env loading", () => {
    const claude = buildAgentPaneCommand({
      agent: "claude",
      runtimeEnvPath: "/tmp/gitdir/webmux/runtime.env",
      prompt: "fix the tests",
    });

    expect(claude).toContain("/tmp/gitdir/webmux/runtime.env");
    expect(claude).toContain("set -a");
    expect(claude).toContain("set +a");
    expect(claude).toContain("claude");
    expect(claude).toContain("fix the tests");
    expect(claude).not.toContain("--continue");
    expect(claude).not.toContain("agent-started");
    expect(claude).not.toContain("title-changed");
    expect(claude).not.toContain("runtime-error");
  });

  it("uses claude continue on resume without replaying the initial prompt", () => {
    const command = buildAgentPaneCommand({
      agent: "claude",
      runtimeEnvPath: "/tmp/gitdir/webmux/runtime.env",
      yolo: true,
      systemPrompt: "stay focused",
      prompt: "fix the tests",
      launchMode: "resume",
    });

    expect(command).toContain("claude --dangerously-skip-permissions --continue");
    expect(command).not.toContain("--append-system-prompt");
    expect(command).not.toContain("fix the tests");
    expect(command).not.toContain("stay focused");
  });

  it("builds docker commands that exec inside the container", () => {
    const shell = buildDockerShellCommand(
      "wm-feature-container",
      "/repos/feature",
      "/repos/main/.git/worktrees/feature/webmux/runtime.env",
      "/bin/zsh",
    );
    const agent = buildDockerAgentPaneCommand({
      agent: "codex",
      containerName: "wm-feature-container",
      worktreePath: "/repos/feature",
      runtimeEnvPath: "/repos/main/.git/worktrees/feature/webmux/runtime.env",
      yolo: true,
      prompt: "ship the fix",
    });

    expect(shell).toContain("docker exec -it -w '/repos/feature' 'wm-feature-container' bash -lc");
    expect(shell).toContain("/bin/zsh");
    expect(agent).toContain("codex --yolo");
    expect(agent).toContain("ship the fix");
    expect(agent).not.toContain("agent-stopped");
  });

  it("uses codex resume --last on resume without replaying the initial prompt", () => {
    const command = buildAgentPaneCommand({
      agent: "codex",
      runtimeEnvPath: "/tmp/gitdir/webmux/runtime.env",
      yolo: true,
      systemPrompt: "stay focused",
      prompt: "ship the fix",
      launchMode: "resume",
    });

    expect(command).toContain("codex --yolo resume --last");
    expect(command).not.toContain("developer_instructions=");
    expect(command).not.toContain("ship the fix");
    expect(command).not.toContain("stay focused");
  });

  it("adds the claude permissions bypass flag only when profile yolo is enabled", () => {
    const normal = buildAgentPaneCommand({
      agent: "claude",
      runtimeEnvPath: "/tmp/gitdir/webmux/runtime.env",
    });
    const yolo = buildAgentPaneCommand({
      agent: "claude",
      runtimeEnvPath: "/tmp/gitdir/webmux/runtime.env",
      yolo: true,
    });

    expect(normal).not.toContain("--dangerously-skip-permissions");
    expect(yolo).toContain("--dangerously-skip-permissions");
  });
});
