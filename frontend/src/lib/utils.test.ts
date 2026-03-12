import { beforeEach, describe, expect, it } from "vitest";
import {
  LAST_SELECTED_WORKTREE_STORAGE_KEY,
  loadSavedSelectedWorktree,
  resolveSelectedBranch,
  saveSelectedWorktree,
} from "./utils";

describe("worktree selection persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("keeps the saved branch before the first successful worktree load", () => {
    expect(resolveSelectedBranch("feature/last-used", undefined, [], false)).toBe("feature/last-used");
  });

  it("keeps the current selection when that worktree still exists", () => {
    expect(
      resolveSelectedBranch(
        "feature/last-used",
        { branch: "feature/last-used" },
        [{ branch: "feature/last-used", mux: "✗" }],
        true,
      ),
    ).toBe("feature/last-used");
  });

  it("falls back to an open worktree when the saved branch is gone", () => {
    expect(
      resolveSelectedBranch(
        "feature/missing",
        undefined,
        [
          { branch: "feature/first", mux: "✗" },
          { branch: "feature/open", mux: "✓" },
        ],
        true,
      ),
    ).toBe("feature/open");
  });

  it("stores and clears the last selected worktree", () => {
    saveSelectedWorktree("feature/last-used");

    expect(loadSavedSelectedWorktree()).toBe("feature/last-used");
    expect(localStorage.getItem(LAST_SELECTED_WORKTREE_STORAGE_KEY)).toBe("feature/last-used");

    saveSelectedWorktree(null);

    expect(loadSavedSelectedWorktree()).toBeNull();
    expect(localStorage.getItem(LAST_SELECTED_WORKTREE_STORAGE_KEY)).toBeNull();
  });
});
