import { describe, expect, it } from "bun:test";
import { NotificationService } from "../services/notification-service";

describe("NotificationService", () => {
  it("creates notifications only for user-visible runtime events", () => {
    const notifications = new NotificationService();

    const started = notifications.recordEvent(
      { worktreeId: "wt_search", branch: "feature/search", type: "agent_started" },
      () => new Date("2026-03-06T10:00:00.000Z"),
    );
    const stopped = notifications.recordEvent(
      { worktreeId: "wt_search", branch: "feature/search", type: "agent_stopped" },
      () => new Date("2026-03-06T10:01:00.000Z"),
    );

    expect(started).toBeNull();
    expect(stopped?.type).toBe("agent_stopped");
    expect(notifications.list()).toHaveLength(1);
  });

  it("stores pr_opened and runtime_error notifications with details", () => {
    const notifications = new NotificationService();

    const pr = notifications.recordEvent(
      { worktreeId: "wt_search", branch: "feature/search", type: "pr_opened", url: "https://github.com/org/repo/pull/123" },
      () => new Date("2026-03-06T10:01:00.000Z"),
    );
    const error = notifications.recordEvent(
      { worktreeId: "wt_search", branch: "feature/search", type: "runtime_error", message: "agent crashed" },
      () => new Date("2026-03-06T10:02:00.000Z"),
    );

    expect(pr?.url).toBe("https://github.com/org/repo/pull/123");
    expect(error?.message).toContain("agent crashed");
    expect(notifications.list()).toHaveLength(2);
  });

  it("dismisses notifications by id", () => {
    const notifications = new NotificationService();
    const item = notifications.recordEvent(
      { worktreeId: "wt_search", branch: "feature/search", type: "agent_stopped" },
      () => new Date("2026-03-06T10:01:00.000Z"),
    );

    expect(item).not.toBeNull();
    expect(notifications.dismiss(item!.id)).toBe(true);
    expect(notifications.list()).toHaveLength(0);
  });
});
