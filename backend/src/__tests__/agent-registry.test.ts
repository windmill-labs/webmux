import { describe, expect, it } from "bun:test";
import type { ProjectConfig } from "../domain/config";
import {
  getAgentDefinition,
  isBuiltInAgentId,
  listAgentDefinitions,
  listAgentDetails,
  listAgentSummaries,
  normalizeCustomAgentId,
} from "../services/agent-registry";

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
      resumeCommand: "gemini resume --last",
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

describe("agent-registry", () => {
  it("lists built-in agents before local custom agents", () => {
    expect(listAgentDefinitions(TEST_CONFIG).map((agent) => agent.id)).toEqual(["claude", "codex", "gemini"]);
  });

  it("exposes custom agents as terminal-only summaries", () => {
    expect(listAgentSummaries(TEST_CONFIG)).toEqual([
      {
        id: "claude",
        label: "Claude",
        kind: "builtin",
        capabilities: {
          terminal: true,
          inAppChat: true,
          conversationHistory: true,
          interrupt: true,
          resume: true,
        },
      },
      {
        id: "codex",
        label: "Codex",
        kind: "builtin",
        capabilities: {
          terminal: true,
          inAppChat: true,
          conversationHistory: true,
          interrupt: true,
          resume: true,
        },
      },
      {
        id: "gemini",
        label: "Gemini CLI",
        kind: "custom",
        capabilities: {
          terminal: true,
          inAppChat: false,
          conversationHistory: false,
          interrupt: false,
          resume: true,
        },
      },
    ]);
  });

  it("ignores custom agents that collide with built-in ids", () => {
    const definitions = listAgentDefinitions({
      ...TEST_CONFIG,
      agents: {
        ...TEST_CONFIG.agents,
        claude: {
          label: "Override",
          startCommand: "custom-claude",
        },
      },
    });

    expect(definitions.map((agent) => agent.id)).toEqual(["claude", "codex", "gemini"]);
    expect(definitions[0]?.label).toBe("Claude");
  });

  it("resolves built-in and custom agent definitions by id", () => {
    const claude = getAgentDefinition(TEST_CONFIG, "claude");
    const gemini = getAgentDefinition(TEST_CONFIG, "gemini");
    const missing = getAgentDefinition(TEST_CONFIG, "missing");

    expect(claude?.kind).toBe("builtin");
    expect(gemini?.kind).toBe("custom");
    expect(gemini?.implementation.type).toBe("custom");
    expect(missing).toBeNull();
  });

  it("exposes agent details for settings screens", () => {
    expect(listAgentDetails(TEST_CONFIG)).toEqual([
      {
        id: "claude",
        label: "Claude",
        kind: "builtin",
        capabilities: {
          terminal: true,
          inAppChat: true,
          conversationHistory: true,
          interrupt: true,
          resume: true,
        },
        startCommand: null,
        resumeCommand: null,
      },
      {
        id: "codex",
        label: "Codex",
        kind: "builtin",
        capabilities: {
          terminal: true,
          inAppChat: true,
          conversationHistory: true,
          interrupt: true,
          resume: true,
        },
        startCommand: null,
        resumeCommand: null,
      },
      {
        id: "gemini",
        label: "Gemini CLI",
        kind: "custom",
        capabilities: {
          terminal: true,
          inAppChat: false,
          conversationHistory: false,
          interrupt: false,
          resume: true,
        },
        startCommand: 'gemini --prompt "${PROMPT}"',
        resumeCommand: "gemini resume --last",
      },
    ]);
  });

  it("normalizes custom agent ids and detects built-ins", () => {
    expect(normalizeCustomAgentId("Gemini CLI")).toBe("gemini-cli");
    expect(normalizeCustomAgentId("!!!")).toBe("agent");
    expect(isBuiltInAgentId("claude")).toBe(true);
    expect(isBuiltInAgentId("gemini")).toBe(false);
  });
});
