import { describe, expect, it } from "bun:test";
import { getAgentDefinition } from "../services/agent-registry";
import { resolveAgentChatSupport } from "../services/agent-chat-service";
import type { ProjectConfig } from "../domain/config";

const TEST_CONFIG: ProjectConfig = {
  name: "Project",
  workspace: {
    mainBranch: "main",
    worktreeRoot: "__worktrees",
    defaultAgent: "claude",
    autoPull: { enabled: false, intervalSeconds: 300 },
  },
  profiles: {
    default: {
      runtime: "host",
      envPassthrough: [],
      panes: [{ id: "agent", kind: "agent", focus: true }],
    },
  },
  agents: {
    gemini: {
      label: "Gemini CLI",
      startCommand: 'gemini --prompt "${PROMPT}"',
    },
  },
  services: [],
  startupEnvs: {},
  integrations: {
    github: { linkedRepos: [], autoRemoveOnMerge: false },
    linear: { enabled: true, autoCreateWorktrees: false, createTicketOption: false },
  },
  lifecycleHooks: {},
  autoName: null,
};

describe("resolveAgentChatSupport", () => {
  it("maps built-in agents to their dashboard chat providers", () => {
    expect(resolveAgentChatSupport({
      agentId: "claude",
      agentLabel: "Claude",
      agent: getAgentDefinition(TEST_CONFIG, "claude"),
      action: "chat",
    })).toEqual({
      ok: true,
      data: {
        provider: "claude",
        submitDelayMs: 0,
      },
    });

    expect(resolveAgentChatSupport({
      agentId: "codex",
      agentLabel: "Codex",
      agent: getAgentDefinition(TEST_CONFIG, "codex"),
      action: "chat",
    })).toEqual({
      ok: true,
      data: {
        provider: "codex",
        submitDelayMs: 200,
      },
    });
  });

  it("rejects terminal-only custom agents", () => {
    expect(resolveAgentChatSupport({
      agentId: "gemini",
      agentLabel: "Gemini CLI",
      agent: getAgentDefinition(TEST_CONFIG, "gemini"),
      action: "chat",
    })).toEqual({
      ok: false,
      error: "Gemini CLI does not support in-app chat",
      status: 409,
    });
  });

  it("rejects missing and unknown agents", () => {
    expect(resolveAgentChatSupport({
      agentId: null,
      agentLabel: null,
      agent: null,
      action: "chat",
    })).toEqual({
      ok: false,
      error: "This worktree has no agent configured",
      status: 409,
    });

    expect(resolveAgentChatSupport({
      agentId: "missing",
      agentLabel: null,
      agent: null,
      action: "interrupt",
    })).toEqual({
      ok: false,
      error: "Unknown agent: missing",
      status: 404,
    });
  });
});
