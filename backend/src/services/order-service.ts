import {
  WORKTREE_ORDER_STATE_VERSION,
  type WorktreeOrderState,
} from "../domain/model";

export function createWorktreeOrderState(branches: string[]): WorktreeOrderState {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const branch of branches) {
    if (!branch || seen.has(branch)) continue;
    seen.add(branch);
    deduped.push(branch);
  }
  return {
    schemaVersion: WORKTREE_ORDER_STATE_VERSION,
    branches: deduped,
  };
}

export function pruneWorktreeOrder(input: {
  state: WorktreeOrderState;
  branches: string[];
}): WorktreeOrderState {
  const valid = new Set(input.branches);
  return createWorktreeOrderState(input.state.branches.filter((branch) => valid.has(branch)));
}

/** Remove `moved` from the order and reinsert it before/after `target`.
 *  Returns null when the move is a no-op or references an unknown branch. */
export function moveBranchInOrder(
  branches: string[],
  moved: string,
  target: string,
  position: "before" | "after",
): string[] | null {
  if (moved === target) return null;
  if (!branches.includes(moved) || !branches.includes(target)) return null;

  const without = branches.filter((branch) => branch !== moved);
  const targetIndex = without.indexOf(target);
  const insertAt = position === "before" ? targetIndex : targetIndex + 1;
  return [...without.slice(0, insertAt), moved, ...without.slice(insertAt)];
}

/** Sort comparator that places ordered branches first in their saved order and
 *  appends unknown branches alphabetically. */
export function buildWorktreeOrderComparator(
  branches: string[],
): (left: string, right: string) => number {
  const orderIndex = new Map(branches.map((branch, index) => [branch, index]));
  return (left, right) => {
    const leftIndex = orderIndex.get(left) ?? Number.POSITIVE_INFINITY;
    const rightIndex = orderIndex.get(right) ?? Number.POSITIVE_INFINITY;
    if (leftIndex !== rightIndex) return leftIndex - rightIndex;
    return left.localeCompare(right);
  };
}
