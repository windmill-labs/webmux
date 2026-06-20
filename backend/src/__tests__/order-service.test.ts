import { describe, expect, it } from "bun:test";
import { WORKTREE_ORDER_STATE_VERSION, type WorktreeOrderState } from "../domain/model";
import {
  buildWorktreeOrderComparator,
  createWorktreeOrderState,
  moveBranchInOrder,
  pruneWorktreeOrder,
} from "../services/order-service";

function orderState(branches: string[]): WorktreeOrderState {
  return { schemaVersion: WORKTREE_ORDER_STATE_VERSION, branches };
}

describe("createWorktreeOrderState", () => {
  it("dedupes and drops empty branch names", () => {
    const state = createWorktreeOrderState(["a", "", "b", "a", "c", "b"]);
    expect(state).toEqual(orderState(["a", "b", "c"]));
  });
});

describe("pruneWorktreeOrder", () => {
  it("keeps only branches that still exist", () => {
    const state = pruneWorktreeOrder({
      state: orderState(["a", "b", "c"]),
      branches: ["c", "a"],
    });
    expect(state.branches).toEqual(["a", "c"]);
  });
});

describe("moveBranchInOrder", () => {
  it("moves a branch before a target", () => {
    expect(moveBranchInOrder(["a", "b", "c"], "c", "a", "before")).toEqual(["c", "a", "b"]);
  });

  it("moves a branch after a target", () => {
    expect(moveBranchInOrder(["a", "b", "c"], "a", "c", "after")).toEqual(["b", "c", "a"]);
  });

  it("returns null for a no-op or unknown branch", () => {
    expect(moveBranchInOrder(["a", "b"], "a", "a", "before")).toBeNull();
    expect(moveBranchInOrder(["a", "b"], "z", "a", "before")).toBeNull();
    expect(moveBranchInOrder(["a", "b"], "a", "z", "after")).toBeNull();
  });
});

describe("buildWorktreeOrderComparator", () => {
  it("orders saved branches first, then unknown branches alphabetically", () => {
    const compare = buildWorktreeOrderComparator(["c", "a"]);
    const sorted = ["b", "a", "d", "c"].sort(compare);
    expect(sorted).toEqual(["c", "a", "b", "d"]);
  });

  it("falls back to alphabetical when no order is saved", () => {
    const compare = buildWorktreeOrderComparator([]);
    expect(["c", "a", "b"].sort(compare)).toEqual(["a", "b", "c"]);
  });
});
