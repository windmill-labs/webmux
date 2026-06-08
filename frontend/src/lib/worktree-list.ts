import type { WorktreeInfo, WorktreeListRow } from "./types";
import { searchMatch } from "./utils";

export interface FilterWorktreesOptions {
  query: string;
  showArchived: boolean;
}

function parentBranchOf(worktree: WorktreeInfo, worktreesByBranch: Map<string, WorktreeInfo>): string | null {
  if (!worktree.baseBranch || worktree.baseBranch === worktree.branch) {
    return null;
  }

  return worktreesByBranch.has(worktree.baseBranch) ? worktree.baseBranch : null;
}

export function matchesWorktreeSearch(worktree: WorktreeInfo, query: string): boolean {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return true;

  return [
    worktree.label ?? "",
    worktree.branch,
    worktree.baseBranch ?? "",
    worktree.profile ?? "",
    worktree.agentLabel ?? "",
    worktree.agentName ?? "",
    worktree.linearIssue?.identifier ?? "",
  ].some((value) => searchMatch(trimmedQuery, value));
}

export function filterWorktrees(worktrees: WorktreeInfo[], options: FilterWorktreesOptions): WorktreeInfo[] {
  return worktrees.filter((worktree) =>
    (options.showArchived || !worktree.archived) && matchesWorktreeSearch(worktree, options.query)
  );
}

export function countArchivedMatches(worktrees: WorktreeInfo[], query: string): number {
  return worktrees.filter((worktree) => worktree.archived && matchesWorktreeSearch(worktree, query)).length;
}

export const OVERFLOW_STATUS_BAR_STATUSES = ["waiting", "error", "done-unread"] as const;
export type OverflowStatusBarStatus = (typeof OVERFLOW_STATUS_BAR_STATUSES)[number];

export function rowShowsAgentStatus(worktree: WorktreeInfo): boolean {
  return worktree.mux === "✓" && !worktree.creating;
}

// The countable mark a row contributes to the overflow bars, mirroring the per-row
// indicator: waiting, error, or a done run that hasn't been viewed yet (the blue dot).
export function overflowStatusOf(
  worktree: WorktreeInfo,
  notifiedBranches: Set<string>,
): OverflowStatusBarStatus | null {
  if (!rowShowsAgentStatus(worktree)) return null;
  if (worktree.agent === "waiting") return "waiting";
  if (worktree.agent === "error") return "error";
  if (worktree.agent === "done" && notifiedBranches.has(worktree.branch)) return "done-unread";
  return null;
}

export function countAgentStatusesIn(
  rows: WorktreeListRow[],
  branches: Set<string>,
  notifiedBranches: Set<string> = new Set(),
): Record<OverflowStatusBarStatus, number> {
  const counts: Record<OverflowStatusBarStatus, number> = { waiting: 0, error: 0, "done-unread": 0 };
  for (const { worktree } of rows) {
    if (!branches.has(worktree.branch)) continue;
    const status = overflowStatusOf(worktree, notifiedBranches);
    if (status) counts[status]++;
  }
  return counts;
}

export function branchesWithAgentStatus(
  rows: WorktreeListRow[],
  status: OverflowStatusBarStatus,
  branches?: Set<string>,
  notifiedBranches: Set<string> = new Set(),
): string[] {
  return rows
    .filter(
      ({ worktree }) =>
        overflowStatusOf(worktree, notifiedBranches) === status &&
        (!branches || branches.has(worktree.branch)),
    )
    .map(({ worktree }) => worktree.branch);
}

export function buildWorktreeListRows(worktrees: WorktreeInfo[]): WorktreeListRow[] {
  const worktreesByBranch = new Map(worktrees.map((worktree) => [worktree.branch, worktree]));
  const childrenByParent = new Map<string, WorktreeInfo[]>();
  const roots: WorktreeInfo[] = [];

  for (const worktree of worktrees) {
    const parentBranch = parentBranchOf(worktree, worktreesByBranch);
    if (!parentBranch) {
      roots.push(worktree);
      continue;
    }

    const siblings = childrenByParent.get(parentBranch) ?? [];
    siblings.push(worktree);
    childrenByParent.set(parentBranch, siblings);
  }

  const rows: WorktreeListRow[] = [];
  const visited = new Set<string>();

  function append(worktree: WorktreeInfo, depth: number): void {
    if (visited.has(worktree.branch)) return;
    visited.add(worktree.branch);
    rows.push({ worktree, depth });

    for (const child of childrenByParent.get(worktree.branch) ?? []) {
      append(child, depth + 1);
    }
  }

  for (const root of roots) {
    append(root, 0);
  }

  for (const worktree of worktrees) {
    append(worktree, 0);
  }

  return rows;
}
