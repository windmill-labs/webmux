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
