import { render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import NotificationItem from "./NotificationItem.svelte";
import NotificationToast from "./NotificationToast.svelte";
import type { AppNotification } from "./types";

function createNotification(
  overrides: Partial<AppNotification> = {},
): AppNotification {
  return {
    id: 1,
    branch: "feature/toast-sizing",
    type: "runtime_error",
    message: "Notification text",
    url: "https://example.com/notifications/1",
    timestamp: Date.UTC(2026, 2, 24, 10, 30, 0),
    ...overrides,
  };
}

describe("NotificationToast", () => {
  it("uses content-fit sizing with a capped max width", () => {
    render(NotificationToast, {
      props: {
        notifications: [createNotification()],
        ondismiss: vi.fn(),
        onselect: vi.fn(),
      },
    });

    const alert = screen.getByRole("alert");
    const stack = alert.parentElement;
    const style = alert.getAttribute("style") ?? "";

    expect(stack).not.toBeNull();
    expect(stack?.className).toContain("items-end");
    expect(style).toContain("inline-size: fit-content");
    expect(style).toContain("max-inline-size: min(48ch, calc(100vw - 2rem))");
  });

  it("wraps toast content instead of truncating it", () => {
    const message =
      "This is a very long notification message that should wrap inside the toast instead of being truncated";
    const url = "https://example.com/notifications/very/long/path/that/should/wrap";

    render(NotificationToast, {
      props: {
        notifications: [createNotification({ message, url })],
        ondismiss: vi.fn(),
        onselect: vi.fn(),
      },
    });

    const messageNode = screen.getByText(message);
    const urlNode = screen.getByText(url);

    expect(messageNode.className).toContain("whitespace-normal");
    expect(messageNode.className).toContain("break-words");
    expect(messageNode.className).not.toContain("truncate");
    expect(urlNode.className).toContain("whitespace-normal");
    expect(urlNode.className).toContain("break-all");
    expect(urlNode.className).not.toContain("truncate");
  });
});

describe("NotificationItem", () => {
  it("keeps non-toast notification rows truncated by default", () => {
    const message = "Default notification item keeps truncation";
    const url = "https://example.com/default/truncation";

    render(NotificationItem, {
      props: {
        notification: createNotification({ message, url }),
      },
    });

    const messageNode = screen.getByText(message);
    const urlNode = screen.getByText(url);

    expect(messageNode.className).toContain("truncate");
    expect(urlNode.className).toContain("truncate");
  });
});
