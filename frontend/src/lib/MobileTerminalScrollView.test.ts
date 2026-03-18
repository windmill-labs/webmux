import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  fetchMobileScrollSnapshot: vi.fn(),
}));

import MobileTerminalScrollView from "./MobileTerminalScrollView.svelte";
import * as api from "./api";

describe("MobileTerminalScrollView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("loads the pane snapshot and refreshes it on demand", async () => {
    vi.mocked(api.fetchMobileScrollSnapshot)
      .mockResolvedValueOnce({
        pane: 0,
        source: "history",
        content: "first snapshot",
      })
      .mockResolvedValueOnce({
        pane: 0,
        source: "alternate",
        content: "second snapshot",
      });

    render(MobileTerminalScrollView, {
      props: {
        worktree: "feature/mobile",
        pane: 0,
      },
    });

    expect(await screen.findByText("first snapshot")).toBeInTheDocument();
    expect(screen.getByText("Scrollback")).toBeInTheDocument();
    expect(api.fetchMobileScrollSnapshot).toHaveBeenCalledWith("feature/mobile", 0);

    await fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => {
      expect(screen.getByText("second snapshot")).toBeInTheDocument();
    });
    expect(screen.getByText("Alternate screen")).toBeInTheDocument();
    expect(api.fetchMobileScrollSnapshot).toHaveBeenCalledTimes(2);
  });
});
