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
      agentCtlPath: "/tmp/gitdir/webmux/webmux-agentctl",
      runtime: "host",
      prompt: "fix the tests",
    });

    expect(claude).toContain("/tmp/gitdir/webmux/runtime.env");
    expect(claude).toContain("set -a");
    expect(claude).toContain("set +a");
    expect(claude).toContain("title-changed --title");
    expect(claude).toContain("agent-started");
    expect(claude).toContain("claude");
    expect(claude).toContain("fix the tests");
    expect(claude).toContain("runtime-error --message");
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
      agentCtlPath: "/repos/main/.git/worktrees/feature/webmux/webmux-agentctl",
      runtime: "docker",
      prompt: "ship the fix",
    });

    expect(shell).toContain("docker exec -it -w '/repos/feature' 'wm-feature-container' bash -lc");
    expect(shell).toContain("/bin/zsh");
    expect(agent).toContain("codex --yolo");
    expect(agent).toContain("ship the fix");
    expect(agent).toContain("agent-stopped");
  });
});
