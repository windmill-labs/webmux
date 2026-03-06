export type RuntimeEventType =
  | "agent_started"
  | "agent_stopped"
  | "title_changed"
  | "pr_opened"
  | "runtime_error";

interface RuntimeEventBase {
  worktreeId: string;
  branch: string;
  type: RuntimeEventType;
}

export interface AgentStartedEvent extends RuntimeEventBase {
  type: "agent_started";
}

export interface AgentStoppedEvent extends RuntimeEventBase {
  type: "agent_stopped";
}

export interface TitleChangedEvent extends RuntimeEventBase {
  type: "title_changed";
  title: string;
}

export interface PrOpenedEvent extends RuntimeEventBase {
  type: "pr_opened";
  url?: string;
}

export interface RuntimeErrorEvent extends RuntimeEventBase {
  type: "runtime_error";
  message: string;
}

export type RuntimeEvent =
  | AgentStartedEvent
  | AgentStoppedEvent
  | TitleChangedEvent
  | PrOpenedEvent
  | RuntimeErrorEvent;

function hasBaseFields(raw: Record<string, unknown>): raw is Record<string, string> & { type: RuntimeEventType } {
  return typeof raw.worktreeId === "string"
    && raw.worktreeId.length > 0
    && typeof raw.branch === "string"
    && raw.branch.length > 0
    && typeof raw.type === "string"
    && ["agent_started", "agent_stopped", "title_changed", "pr_opened", "runtime_error"].includes(raw.type);
}

export function parseRuntimeEvent(raw: unknown): RuntimeEvent | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (!hasBaseFields(raw as Record<string, unknown>)) return null;

  const event = raw as Record<string, unknown> & {
    worktreeId: string;
    branch: string;
    type: RuntimeEventType;
  };

  switch (event.type) {
    case "agent_started":
      return {
        worktreeId: event.worktreeId,
        branch: event.branch,
        type: event.type,
      };
    case "agent_stopped":
      return {
        worktreeId: event.worktreeId,
        branch: event.branch,
        type: event.type,
      };
    case "title_changed":
      return typeof event.title === "string"
        ? {
            worktreeId: event.worktreeId,
            branch: event.branch,
            type: event.type,
            title: event.title,
          }
        : null;
    case "pr_opened":
      return typeof event.url === "string" || event.url === undefined
        ? {
            worktreeId: event.worktreeId,
            branch: event.branch,
            type: event.type,
            ...(typeof event.url === "string" ? { url: event.url } : {}),
          }
        : null;
    case "runtime_error":
      return typeof event.message === "string" && event.message.length > 0
        ? {
            worktreeId: event.worktreeId,
            branch: event.branch,
            type: event.type,
            message: event.message,
          }
        : null;
  }
}
