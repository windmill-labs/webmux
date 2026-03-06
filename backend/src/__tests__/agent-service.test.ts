import { describe, expect, it } from "bun:test";
import {
  buildAgentPaneCommand,
  buildManagedCommand,
  buildManagedShellCommand,
} from "../services/agent-service";

describe("agent-service command builders", () => {
  it("builds a managed shell command that sources runtime.env", () => {
    const command = buildManagedShellCommand("/tmp/gitdir/webmux/runtime.env", "/bin/zsh");
    expect(command).toContain(". '/tmp/gitdir/webmux/runtime.env'");
    expect(command).toContain("exec '/bin/zsh' -i");
  });

  it("wraps arbitrary commands with runtime.env loading", () => {
    const command = buildManagedCommand("/tmp/gitdir/webmux/runtime.env", "npm run dev");
    expect(command).toContain(". '/tmp/gitdir/webmux/runtime.env'");
    expect(command).toContain("exec npm run dev");
  });

  it("builds agent commands for claude and codex", () => {
    const claude = buildAgentPaneCommand("claude", "/tmp/gitdir/webmux/runtime.env");
    const codex = buildAgentPaneCommand("codex", "/tmp/gitdir/webmux/runtime.env", "fix the tests");

    expect(claude).toContain("exec claude");
    expect(codex).toContain("exec codex --yolo 'fix the tests'");
  });
});
