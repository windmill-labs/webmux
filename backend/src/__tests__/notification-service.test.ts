import { describe, expect, it } from "bun:test";
import { NotificationService } from "../services/notification-service";

async function readChunk(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const chunk = await reader.read();
  expect(chunk.done).toBe(false);
  return new TextDecoder().decode(chunk.value);
}

describe("NotificationService", () => {
  it("creates notifications only for user-visible runtime events", () => {
    const notifications = new NotificationService();

    const started = notifications.recordEvent(
      { worktreeId: "wt_search", branch: "feature/search", type: "agent_status_changed", lifecycle: "running" },
    );
    const stopped = notifications.recordEvent(
      { worktreeId: "wt_search", branch: "feature/search", type: "agent_stopped" },
    );

    expect(started).toBeNull();
    expect(stopped?.type).toBe("agent_stopped");
    expect(notifications.list()).toHaveLength(1);
  });

  it("stores pr_opened and runtime_error notifications with details", () => {
    const notifications = new NotificationService();

    const pr = notifications.recordEvent(
      { worktreeId: "wt_search", branch: "feature/search", type: "pr_opened", url: "https://github.com/org/repo/pull/123" },
    );
    const error = notifications.recordEvent(
      { worktreeId: "wt_search", branch: "feature/search", type: "runtime_error", message: "agent crashed" },
    );

    expect(pr?.url).toBe("https://github.com/org/repo/pull/123");
    expect(error?.message).toContain("agent crashed");
    expect(notifications.list()).toHaveLength(2);
  });

  it("dismisses notifications by id", () => {
    const notifications = new NotificationService();
    const item = notifications.recordEvent(
      { worktreeId: "wt_search", branch: "feature/search", type: "agent_stopped" },
    );

    expect(item).not.toBeNull();
    expect(notifications.dismiss(item!.id)).toBe(true);
    expect(notifications.list()).toHaveLength(0);
  });

  it("streams initial notifications and broadcasts live updates", async () => {
    const notifications = new NotificationService();
    const initial = notifications.recordEvent(
      { worktreeId: "wt_search", branch: "feature/search", type: "agent_stopped" },
    );

    const response = notifications.stream();
    const reader = response.body!.getReader();

    const initialChunk = await readChunk(reader);
    expect(initialChunk).toContain("event: initial");
    expect(initialChunk).toContain(`\"id\":${initial!.id}`);

    const liveChunkPromise = readChunk(reader);
    const live = notifications.recordEvent(
      { worktreeId: "wt_search", branch: "feature/search", type: "pr_opened", url: "https://github.com/org/repo/pull/123" },
    );
    const liveChunk = await liveChunkPromise;
    expect(liveChunk).toContain("event: notification");
    expect(liveChunk).toContain(`\"id\":${live!.id}`);

    const dismissChunkPromise = readChunk(reader);
    expect(notifications.dismiss(live!.id)).toBe(true);
    const dismissChunk = await dismissChunkPromise;
    expect(dismissChunk).toContain("event: dismiss");
    expect(dismissChunk).toContain(`\"id\":${live!.id}`);

    await reader.cancel();
  });
});
