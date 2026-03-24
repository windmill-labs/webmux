import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import BranchSelector from "./BranchSelector.svelte";

const BRANCHES = [
  { name: "main" },
  { name: "release/base" },
];

describe("BranchSelector", () => {
  afterEach(() => {
    cleanup();
  });

  it("auto-focuses the search input each time it is reopened after escape", async () => {
    render(BranchSelector, {
      props: {
        label: "Existing branch",
        branches: BRANCHES,
        initialOpen: true,
        onselect: vi.fn(),
      },
    });

    await waitFor(() => {
      expect(screen.getByLabelText("Existing branch search")).toHaveFocus();
    });

    await fireEvent.keyDown(screen.getByLabelText("Existing branch search"), {
      key: "Escape",
    });

    await waitFor(() => {
      expect(screen.queryByLabelText("Existing branch search")).not.toBeInTheDocument();
    });

    await fireEvent.click(screen.getByRole("button", { name: "Existing branch" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Existing branch search")).toHaveFocus();
    });
  });

  it("auto-focuses the search input each time it is reopened after focus leaves the selector", async () => {
    render(BranchSelector, {
      props: {
        label: "Base branch",
        branches: BRANCHES,
        onselect: vi.fn(),
      },
    });

    const trigger = screen.getByRole("button", { name: "Base branch" });
    await fireEvent.click(trigger);

    await waitFor(() => {
      expect(screen.getByLabelText("Base branch search")).toHaveFocus();
    });

    await fireEvent.focusOut(screen.getByLabelText("Base branch search"), {
      relatedTarget: document.body,
    });

    await waitFor(() => {
      expect(screen.queryByLabelText("Base branch search")).not.toBeInTheDocument();
    });

    await fireEvent.click(trigger);

    await waitFor(() => {
      expect(screen.getByLabelText("Base branch search")).toHaveFocus();
    });
  });

  it("keeps the selector open when the inline toggle control is clicked", async () => {
    const onInlineToggle = vi.fn();

    render(BranchSelector, {
      props: {
        label: "Existing branch",
        branches: BRANCHES,
        initialOpen: true,
        inlineToggleLabel: "include remote",
        inlineToggleChecked: false,
        oninlinetoggle: onInlineToggle,
        onselect: vi.fn(),
      },
    });

    const search = await screen.findByLabelText("Existing branch search");
    const labelButton = screen.getByRole("button", { name: "include remote" });

    await fireEvent.mouseDown(labelButton);
    await fireEvent.click(labelButton);

    expect(onInlineToggle).toHaveBeenCalledTimes(1);
    expect(search).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Existing branch" })).toHaveAttribute("aria-expanded", "true");
  });
});
