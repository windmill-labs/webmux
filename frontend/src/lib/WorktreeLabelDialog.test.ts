import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WorktreeLabelDialog from "./WorktreeLabelDialog.svelte";

const originalDialogShowModal = HTMLDialogElement.prototype.showModal;
const originalDialogClose = HTMLDialogElement.prototype.close;

function renderDialog(overrides: {
  initialLabel?: string | null;
  onconfirm?: (label: string) => void;
  onclear?: () => void;
  oncancel?: () => void;
} = {}): void {
  render(WorktreeLabelDialog, {
    props: {
      branch: "feature/search",
      initialLabel: null,
      loading: false,
      error: "",
      onconfirm: overrides.onconfirm ?? vi.fn(),
      onclear: overrides.onclear ?? vi.fn(),
      oncancel: overrides.oncancel ?? vi.fn(),
      ...overrides,
    },
  });
}

describe("WorktreeLabelDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement): void {
      this.open = true;
    });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement): void {
      this.open = false;
    });
  });

  afterEach(() => {
    cleanup();
    HTMLDialogElement.prototype.showModal = originalDialogShowModal;
    HTMLDialogElement.prototype.close = originalDialogClose;
  });

  it("disables clear and save when there is no initial label", () => {
    renderDialog();

    expect(screen.getByRole("button", { name: "Clear" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("clears an existing label", async () => {
    const onclear = vi.fn();
    renderDialog({ initialLabel: "Search ranking", onclear });

    await fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    expect(onclear).toHaveBeenCalledTimes(1);
  });

  it("submits trimmed changed labels", async () => {
    const onconfirm = vi.fn();
    renderDialog({ initialLabel: "Search ranking", onconfirm });

    await fireEvent.input(screen.getByLabelText("Label"), {
      target: { value: "  Search filters  " },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onconfirm).toHaveBeenCalledWith("Search filters");
  });

  it("does not submit unchanged labels", async () => {
    const onconfirm = vi.fn();
    renderDialog({ initialLabel: "Search ranking", onconfirm });

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onconfirm).not.toHaveBeenCalled();
  });

  it("cancels without saving", async () => {
    const oncancel = vi.fn();
    const onconfirm = vi.fn();
    renderDialog({ initialLabel: "Search ranking", oncancel, onconfirm });

    await fireEvent.input(screen.getByLabelText("Label"), {
      target: { value: "Search filters" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(oncancel).toHaveBeenCalledTimes(1);
    expect(onconfirm).not.toHaveBeenCalled();
  });
});
