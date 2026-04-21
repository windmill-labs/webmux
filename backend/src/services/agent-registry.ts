import type { AgentSummary } from "@webmux/api-contract";
import type { AgentId, AgentKind, CustomAgentConfig, ProjectConfig } from "../domain/config";

export interface AgentCapabilities {
  terminal: true;
  inAppChat: boolean;
  conversationHistory: boolean;
  interrupt: boolean;
  resume: boolean;
}

interface BuiltInAgentDefinition {
  id: AgentKind;
  label: string;
  kind: "builtin";
  capabilities: AgentCapabilities;
  implementation: {
    type: "builtin";
    agent: AgentKind;
  };
}

interface CustomAgentDefinition {
  id: AgentId;
  label: string;
  kind: "custom";
  capabilities: AgentCapabilities;
  implementation: {
    type: "custom";
    config: CustomAgentConfig;
  };
}

export type AgentDefinition = BuiltInAgentDefinition | CustomAgentDefinition;

const BUILTIN_AGENT_DEFINITIONS: AgentDefinition[] = [
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
    implementation: {
      type: "builtin",
      agent: "claude",
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
    implementation: {
      type: "builtin",
      agent: "codex",
    },
  },
];

function cloneCapabilities(capabilities: AgentCapabilities): AgentCapabilities {
  return { ...capabilities };
}

function cloneDefinition(definition: AgentDefinition): AgentDefinition {
  if (definition.kind === "builtin") {
    return {
      ...definition,
      capabilities: cloneCapabilities(definition.capabilities),
      implementation: { ...definition.implementation },
    };
  }

  return {
    ...definition,
    capabilities: cloneCapabilities(definition.capabilities),
    implementation: {
      type: "custom",
      config: { ...definition.implementation.config },
    },
  };
}

function buildCustomAgentDefinition(id: AgentId, config: CustomAgentConfig): CustomAgentDefinition {
  return {
    id,
    label: config.label,
    kind: "custom",
    capabilities: {
      terminal: true,
      inAppChat: false,
      conversationHistory: false,
      interrupt: false,
      resume: config.resumeCommand !== undefined,
    },
    implementation: {
      type: "custom",
      config: { ...config },
    },
  };
}

export function listAgentDefinitions(config: Pick<ProjectConfig, "agents">): AgentDefinition[] {
  const builtInIds = new Set(BUILTIN_AGENT_DEFINITIONS.map((agent) => agent.id));
  const customDefinitions = Object.entries(config.agents)
    .filter(([id]) => !builtInIds.has(id))
    .sort(([leftId, left], [rightId, right]) => {
      const labelCompare = left.label.localeCompare(right.label);
      return labelCompare !== 0 ? labelCompare : leftId.localeCompare(rightId);
    })
    .map(([id, agent]) => buildCustomAgentDefinition(id, agent));

  return [
    ...BUILTIN_AGENT_DEFINITIONS.map((definition) => cloneDefinition(definition)),
    ...customDefinitions,
  ];
}

export function getAgentDefinition(
  config: Pick<ProjectConfig, "agents">,
  agentId: AgentId,
): AgentDefinition | null {
  const definition = listAgentDefinitions(config).find((agent) => agent.id === agentId);
  return definition ?? null;
}

export function listAgentSummaries(config: Pick<ProjectConfig, "agents">): AgentSummary[] {
  return listAgentDefinitions(config).map((agent) => ({
    id: agent.id,
    label: agent.label,
    kind: agent.kind,
    capabilities: cloneCapabilities(agent.capabilities),
  }));
}
