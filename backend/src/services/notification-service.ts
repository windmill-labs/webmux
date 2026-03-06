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
  private readonly sseClients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  private nextId = 1;

  constructor(private readonly maxItems = 50) {}

  list(): RuntimeNotification[] {
    return [...this.notifications];
  }

  dismiss(id: number): boolean {
    const index = this.notifications.findIndex((notification) => notification.id === id);
    if (index === -1) return false;
    this.notifications.splice(index, 1);
    this.broadcast("dismiss", { id });
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
    this.broadcast("notification", notification);
    return notification;
  }

  stream(): Response {
    let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        controllerRef = controller;
        this.sseClients.add(controller);
        for (const notification of this.notifications) {
          controller.enqueue(this.formatSse("initial", notification));
        }
      },
      cancel: () => {
        if (controllerRef) this.sseClients.delete(controllerRef);
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  private formatSse(event: string, data: unknown): Uint8Array {
    return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  private broadcast(event: "notification" | "dismiss", data: RuntimeNotification | { id: number }): void {
    const encoded = this.formatSse(event, data);
    for (const controller of this.sseClients) {
      try {
        controller.enqueue(encoded);
      } catch {
        this.sseClients.delete(controller);
      }
    }
  }
}
