import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  api: {
    fetchWorktreeDiff: vi.fn(),
  },
}));

import DiffDialog from "./DiffDialog.svelte";
import { api } from "./api";

const originalDialogShowModal = HTMLDialogElement.prototype.showModal;
const originalDialogClose = HTMLDialogElement.prototype.close;

describe("DiffDialog", () => {
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

  it("shows git status entries and a Cursor link when available", async () => {
    vi.mocked(api.fetchWorktreeDiff).mockResolvedValue({
      uncommitted: "",
      uncommittedTruncated: false,
      gitStatus: "A  src/new-file.ts\nD  src/old-file.ts",
      unpushedCommits: [],
    });

    render(DiffDialog, {
      props: {
        branch: "feature/status",
        cursorUrl: "cursor://file/tmp/feature/status",
        onclose: vi.fn(),
      },
    });

    const statusOutput = await screen.findByText((_content, node) =>
      node?.tagName === "PRE" && node.textContent?.includes("src/new-file.ts") === true
    );

    expect(screen.getByRole("button", { name: "Git status (2)" })).toHaveClass("active");
    expect(statusOutput.textContent).toContain("A  src/new-file.ts");
    expect(statusOutput.textContent).toContain("D  src/old-file.ts");
    expect(screen.getByRole("link", { name: "Cursor" })).toHaveAttribute(
      "href",
      "cursor://file/tmp/feature/status",
    );
  });
});
