import { describe, expect, it } from "bun:test";
import type { AgentDefinition } from "../services/agent-registry";
import {
  buildAgentPaneCommand,
  buildDockerAgentPaneCommand,
  buildDockerShellCommand,
  buildManagedShellCommand,
} from "../services/agent-service";

function builtInAgent(id: "claude" | "codex"): AgentDefinition {
  return {
    id,
    label: id === "claude" ? "Claude" : "Codex",
    kind: "builtin",
    capabilities: {
      terminal: true,
      inAppChat: true,
      conversationHistory: true,
      interrupt: true,
      resume: true,
    },
    implementation: {
      type: "builtin",
      agent: id,
    },
  };
}

function customAgent(overrides: {
  id?: string;
  label?: string;
  startCommand: string;
  resumeCommand?: string;
}): AgentDefinition {
  return {
    id: overrides.id ?? "gemini",
    label: overrides.label ?? "Gemini CLI",
    kind: "custom",
    capabilities: {
      terminal: true,
      inAppChat: false,
      conversationHistory: false,
      interrupt: false,
      resume: overrides.resumeCommand !== undefined,
    },
    implementation: {
      type: "custom",
      config: {
        label: overrides.label ?? "Gemini CLI",
        startCommand: overrides.startCommand,
        ...(overrides.resumeCommand ? { resumeCommand: overrides.resumeCommand } : {}),
      },
    },
  };
}

describe("agent-service command builders", () => {
  it("builds a managed shell command that sources runtime.env", () => {
    const command = buildManagedShellCommand("/tmp/gitdir/webmux/runtime.env", "/bin/zsh");
    expect(command).toContain("bash -lc");
    expect(command).toContain("/tmp/gitdir/webmux/runtime.env");
    expect(command).toContain("set -a");
    expect(command).toContain("set +a");
    expect(command).toContain("/bin/zsh");
  });

  it("wraps built-in agent commands with runtime.env loading", () => {
    const claude = buildAgentPaneCommand({
      agent: builtInAgent("claude"),
      runtimeEnvPath: "/tmp/gitdir/webmux/runtime.env",
      repoRoot: "/repo",
      worktreePath: "/repo/__worktrees/feature",
      branch: "feature",
      profileName: "default",
      prompt: "fix the tests",
    });

    expect(claude).toContain("/tmp/gitdir/webmux/runtime.env");
    expect(claude).toContain("set -a");
    expect(claude).toContain("set +a");
    expect(claude).toContain("claude");
    expect(claude).toContain("fix the tests");
    expect(claude).not.toContain("--continue");
  });

  it("uses claude continue on resume without replaying the initial prompt", () => {
    const command = buildAgentPaneCommand({
      agent: builtInAgent("claude"),
      runtimeEnvPath: "/tmp/gitdir/webmux/runtime.env",
      repoRoot: "/repo",
      worktreePath: "/repo/__worktrees/feature",
      branch: "feature",
      profileName: "default",
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
      agent: builtInAgent("codex"),
      runtimeEnvPath: "/repos/main/.git/worktrees/feature/webmux/runtime.env",
      repoRoot: "/repos/main",
      worktreePath: "/repos/feature",
      branch: "feature",
      profileName: "default",
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
      agent: builtInAgent("codex"),
      runtimeEnvPath: "/tmp/gitdir/webmux/runtime.env",
      repoRoot: "/repo",
      worktreePath: "/repo/__worktrees/feature",
      branch: "feature",
      profileName: "default",
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
      agent: builtInAgent("claude"),
      runtimeEnvPath: "/tmp/gitdir/webmux/runtime.env",
      repoRoot: "/repo",
      worktreePath: "/repo/__worktrees/feature",
      branch: "feature",
      profileName: "default",
      prompt: "--- fix the bug",
    });
    expect(claude).toContain("-- '--- fix the bug'");

    const codex = buildAgentPaneCommand({
      agent: builtInAgent("codex"),
      runtimeEnvPath: "/tmp/gitdir/webmux/runtime.env",
      repoRoot: "/repo",
      worktreePath: "/repo/__worktrees/feature",
      branch: "feature",
      profileName: "default",
      prompt: "--help",
    });
    expect(codex).toContain("-- '--help'");
  });

  it("omits -- when no prompt is provided", () => {
    const command = buildAgentPaneCommand({
      agent: builtInAgent("claude"),
      runtimeEnvPath: "/tmp/gitdir/webmux/runtime.env",
      repoRoot: "/repo",
      worktreePath: "/repo/__worktrees/feature",
      branch: "feature",
      profileName: "default",
      systemPrompt: "be helpful",
    });
    expect(command).not.toContain(" -- ");
  });

  it("adds the claude permissions bypass flag only when profile yolo is enabled", () => {
    const normal = buildAgentPaneCommand({
      agent: builtInAgent("claude"),
      runtimeEnvPath: "/tmp/gitdir/webmux/runtime.env",
      repoRoot: "/repo",
      worktreePath: "/repo/__worktrees/feature",
      branch: "feature",
      profileName: "default",
    });
    const yolo = buildAgentPaneCommand({
      agent: builtInAgent("claude"),
      runtimeEnvPath: "/tmp/gitdir/webmux/runtime.env",
      repoRoot: "/repo",
      worktreePath: "/repo/__worktrees/feature",
      branch: "feature",
      profileName: "default",
      yolo: true,
    });

    expect(normal).not.toContain("--dangerously-skip-permissions");
    expect(yolo).toContain("--dangerously-skip-permissions");
  });

  it("renders custom agent placeholders through exported env vars", () => {
    const command = buildAgentPaneCommand({
      agent: customAgent({
        startCommand: 'gemini --prompt "${PROMPT}" --cwd "${WORKTREE_PATH}" --profile "${PROFILE}"',
      }),
      runtimeEnvPath: "/tmp/gitdir/webmux/runtime.env",
      repoRoot: "/repo",
      worktreePath: "/repo/__worktrees/feature",
      branch: "feature/search",
      profileName: "sandbox",
      prompt: "fix the tests",
    });

    expect(command).toContain("export WEBMUX_AGENT_PROMPT='fix the tests'");
    expect(command).toContain("export WEBMUX_AGENT_WORKTREE_PATH='/repo/__worktrees/feature'");
    expect(command).toContain("export WEBMUX_AGENT_PROFILE='sandbox'");
    expect(command).toContain('gemini --prompt "$WEBMUX_AGENT_PROMPT" --cwd "$WEBMUX_AGENT_WORKTREE_PATH" --profile "$WEBMUX_AGENT_PROFILE"');
  });

  it("uses a custom agent resume command when available", () => {
    const command = buildAgentPaneCommand({
      agent: customAgent({
        startCommand: 'gemini start --prompt "${PROMPT}"',
        resumeCommand: 'gemini resume --branch "${BRANCH}"',
      }),
      runtimeEnvPath: "/tmp/gitdir/webmux/runtime.env",
      repoRoot: "/repo",
      worktreePath: "/repo/__worktrees/feature",
      branch: "feature/search",
      profileName: "default",
      prompt: "fix the tests",
      launchMode: "resume",
    });

    expect(command).toContain('gemini resume --branch "$WEBMUX_AGENT_BRANCH"');
    expect(command).not.toContain('gemini start --prompt "$WEBMUX_AGENT_PROMPT"');
  });
});
