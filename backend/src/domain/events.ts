export type RuntimeEventType =
  | "agent_started"
  | "agent_stopped"
  | "title_changed"
  | "pr_opened"
  | "runtime_error";

interface RuntimeEventBase {
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
