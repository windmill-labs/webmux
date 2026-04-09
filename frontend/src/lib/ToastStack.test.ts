import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import NotificationItem from "./NotificationItem.svelte";
import ToastStack from "./ToastStack.svelte";
import type { AppNotification, ToastItem } from "./types";

afterEach(() => {
  cleanup();
});

function createToast(
  overrides: Partial<ToastItem> = {},
): ToastItem {
  return {
    id: "notification:1",
    source: "notification",
    notificationId: 1,
    tone: "info",
    message: "Notification text",
    detail: "https://example.com/notifications/1",
    branch: "feature/toast-sizing",
    ...overrides,
  };
}

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

describe("ToastStack", () => {
  it("uses content-fit sizing with a capped max width", () => {
    render(ToastStack, {
      props: {
        toasts: [createToast()],
        ondismiss: vi.fn(),
        onselect: vi.fn(),
      },
    });

    const alert = screen.getByRole("alert");
    const stack = alert.parentElement;

    expect(stack).not.toBeNull();
    expect(stack?.className).toContain("items-end");
    expect(alert.className).toContain("w-fit");
    expect(alert.className).toContain("max-w-[min(48ch,calc(100vw-2rem))]");
  });

  it("wraps toast content instead of truncating it", () => {
    const message =
      "This is a very long notification message that should wrap inside the toast instead of being truncated";
    const detail = "https://example.com/notifications/very/long/path/that/should/wrap";

    render(ToastStack, {
      props: {
        toasts: [createToast({ message, detail })],
        ondismiss: vi.fn(),
        onselect: vi.fn(),
      },
    });

    const messageNode = screen.getByText(message);
    const detailNode = screen.getByText(detail);

    expect(messageNode.className).toContain("whitespace-normal");
    expect(messageNode.className).toContain("break-words");
    expect(messageNode.className).not.toContain("truncate");
    expect(detailNode.className).toContain("whitespace-normal");
    expect(detailNode.className).toContain("break-all");
    expect(detailNode.className).not.toContain("truncate");
  });

  it("keeps actionable toasts clickable and dismissible", async () => {
    const ondismiss = vi.fn();
    const onselect = vi.fn();

    render(ToastStack, {
      props: {
        toasts: [createToast()],
        ondismiss,
        onselect,
      },
    });

    const selectButton = screen.getByRole("button", { name: /notification text/i });
    const dismissButton = screen.getAllByRole("button").find((button) => button.textContent === "\u00d7");
    expect(dismissButton).toBeDefined();

    await fireEvent.click(selectButton);
    await fireEvent.click(dismissButton!);

    expect(onselect).toHaveBeenCalledWith("notification:1");
    expect(ondismiss).toHaveBeenCalledWith("notification:1");
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
