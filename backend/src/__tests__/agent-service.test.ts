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
      runtimeEnvPath: "/repos/main/.git/worktrees/feature/webmux/runtime.env",
      yolo: true,
      prompt: "ship the fix",
    });

    expect(shell).toContain("docker exec -it -w '/repos/feature' 'wm-feature-container' /bin/sh -c");
    expect(shell).toContain("/bin/zsh");
    expect(shell).toContain('export PATH="$PATH:/root/.local/bin:/usr/local/bin:/root/.bun/bin:/root/.cargo/bin"');
    expect(agent).toContain("codex --yolo");
    expect(agent).toContain("ship the fix");
    expect(agent).toContain('export PATH="$PATH:/root/.local/bin:/usr/local/bin:/root/.bun/bin:/root/.cargo/bin"');
    expect(agent).not.toContain("docker exec");
    expect(agent).not.toContain("agent-stopped");
  });

  it("defaults docker shell commands to /bin/bash instead of the host shell path", () => {
    const shell = buildDockerShellCommand(
      "wm-feature-container",
      "/repos/feature",
      "/repos/main/.git/worktrees/feature/webmux/runtime.env",
    );

    expect(shell).toContain("/bin/bash");
    expect(shell).not.toContain(" /bin/sh -lc ");
    expect(shell).toContain('export PATH="$PATH:/root/.local/bin:/usr/local/bin:/root/.bun/bin:/root/.cargo/bin"');
  });

  it("falls back to /bin/sh when the preferred docker shell is unavailable", () => {
    const shell = buildDockerShellCommand(
      "wm-feature-container",
      "/repos/feature",
      "/repos/main/.git/worktrees/feature/webmux/runtime.env",
      "/missing/bash",
    );

    expect(shell).toContain("/missing/bash");
    expect(shell).toContain("elif [ -x /bin/sh ]; then exec /bin/sh -i;");
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

  it("uses -- before the prompt so dash-prefixed prompts are not parsed as flags", () => {
    const claude = buildAgentPaneCommand({
      agent: "claude",
      runtimeEnvPath: "/tmp/gitdir/webmux/runtime.env",
      prompt: "--- fix the bug",
    });
    expect(claude).toContain("-- '--- fix the bug'");

    const codex = buildAgentPaneCommand({
      agent: "codex",
      runtimeEnvPath: "/tmp/gitdir/webmux/runtime.env",
      prompt: "--help",
    });
    expect(codex).toContain("-- '--help'");
  });

  it("omits -- when no prompt is provided", () => {
    const command = buildAgentPaneCommand({
      agent: "claude",
      runtimeEnvPath: "/tmp/gitdir/webmux/runtime.env",
      systemPrompt: "be helpful",
    });
    expect(command).not.toContain(" -- ");
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
