import type { RuntimeEvent } from "../domain/events";

export interface RuntimeNotification {
  id: number;
  branch: string;
  type: "agent_stopped" | "pr_opened" | "runtime_error";
  message: string;
  url?: string;
  timestamp: number;
}

function buildNotification(event: RuntimeEvent, id: number, timestamp: number): RuntimeNotification | null {
  switch (event.type) {
    case "agent_stopped":
      return {
        id,
        branch: event.branch,
        type: "agent_stopped",
        message: `Agent stopped on ${event.branch}`,
        timestamp,
      };
    case "pr_opened":
      return {
        id,
        branch: event.branch,
        type: "pr_opened",
        message: `PR opened on ${event.branch}`,
        url: event.url,
        timestamp,
      };
    case "runtime_error":
      return {
        id,
        branch: event.branch,
        type: "runtime_error",
        message: `Runtime error on ${event.branch}: ${event.message}`,
        timestamp,
      };
    default:
      return null;
  }
}

export class NotificationService {
  private readonly notifications: RuntimeNotification[] = [];
  private nextId = 1;

  constructor(private readonly maxItems = 50) {}

  list(): RuntimeNotification[] {
    return [...this.notifications];
  }

  dismiss(id: number): boolean {
    const index = this.notifications.findIndex((notification) => notification.id === id);
    if (index === -1) return false;
    this.notifications.splice(index, 1);
    return true;
  }

  recordEvent(event: RuntimeEvent, now: () => Date = () => new Date()): RuntimeNotification | null {
    const notification = buildNotification(event, this.nextId, now().getTime());
    if (!notification) return null;

    this.nextId += 1;
    this.notifications.push(notification);
    while (this.notifications.length > this.maxItems) {
      this.notifications.shift();
    }
    return notification;
  }
}
