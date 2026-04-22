import type { AgentDefinition } from "./agent-registry";

export interface AgentChatSupport {
  provider: "claude" | "codex";
  submitDelayMs: number;
}

export function resolveAgentChatSupport(input: {
  agentId: string | null;
  agentLabel: string | null;
  agent: AgentDefinition | null;
  action: "chat" | "interrupt";
}):
  | { ok: true; data: AgentChatSupport }
  | { ok: false; error: string; status: number } {
  if (!input.agentId) {
    return {
      ok: false,
      error: "This worktree has no agent configured",
      status: 409,
    };
  }

  if (!input.agent) {
    return {
      ok: false,
      error: `Unknown agent: ${input.agentId}`,
      status: 404,
    };
  }

  const agentLabel = input.agentLabel ?? input.agent.label;
  if (!input.agent.capabilities.inAppChat || !input.agent.capabilities.conversationHistory) {
    return {
      ok: false,
      error: `${agentLabel} does not support in-app chat`,
      status: 409,
    };
  }

  if (input.action === "interrupt" && !input.agent.capabilities.interrupt) {
    return {
      ok: false,
      error: `${agentLabel} cannot be interrupted from the dashboard`,
      status: 409,
    };
  }

  if (input.agent.kind === "builtin") {
    return {
      ok: true,
      data: {
        provider: input.agent.implementation.agent,
        submitDelayMs: input.agent.implementation.agent === "codex" ? 200 : 0,
      },
    };
  }

  return {
    ok: false,
    error: `Dashboard chat is not available for ${agentLabel}`,
    status: 409,
  };
}
