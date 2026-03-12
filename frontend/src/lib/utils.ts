import type { PrEntry, WorktreeCreationPhase, WorktreeInfo } from "./types";
import { THEME_KEYS, getTheme } from "./themes";
import type { ThemeKey } from "./themes";

export const SSH_STORAGE_KEY = "wt-ssh-host";
export const THEME_STORAGE_KEY = "wt-theme";
export const LAST_SELECTED_WORKTREE_STORAGE_KEY = "wt-last-selected-worktree";

export function prLabel(pr: Pick<PrEntry, "repo" | "number">): string {
  return pr.repo ? `${pr.repo} #${pr.number}` : `PR #${pr.number}`;
}

export function prStateTextClass(state: PrEntry["state"]): string {
  if (state === "merged") return "text-merged";
  if (state === "closed") return "text-danger";
  return "text-primary";
}

export function prBadgeClass(state: PrEntry["state"]): string {
  if (state === "merged") return "bg-merged/20 text-merged";
  if (state === "closed") return "bg-danger/20 text-danger";
  if (state === "open") return "bg-success/20 text-success";
  return "bg-muted/20 text-muted";
}

export function ciStatusTextClass(ciStatus: PrEntry["ciStatus"]): string {
  if (ciStatus === "failed") return "text-danger";
  if (ciStatus === "success") return "text-success";
  if (ciStatus === "pending") return "text-warning";
  return "text-muted";
}

export function ciStatusDotClass(ciStatus: PrEntry["ciStatus"]): string {
  if (ciStatus === "failed") return "bg-danger";
  if (ciStatus === "success") return "bg-success";
  if (ciStatus === "pending") return "bg-warning animate-pulse";
  return "bg-muted";
}

export function prStatusShellClass(pr: Pick<PrEntry, "ciChecks" | "ciStatus" | "state">): string {
  if (pr.ciChecks.length > 0) {
    if (pr.ciStatus === "failed") return "border-danger/40 bg-danger/5";
    if (pr.ciStatus === "pending") return "border-warning/40 bg-warning/5";
    if (pr.ciStatus === "success") return "border-success/30 bg-success/5";
  }
  if (pr.state === "merged") return "border-merged/35 bg-merged/8";
  if (pr.state === "closed") return "border-danger/35 bg-danger/5";
  return "border-edge bg-surface";
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function searchMatch(needle: string, haystack: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

export function loadSavedTheme(): ThemeKey {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored && (THEME_KEYS as readonly string[]).includes(stored)) return stored as ThemeKey;
  return "github-dark";
}

export function loadSavedSelectedWorktree(): string | null {
  const stored = localStorage.getItem(LAST_SELECTED_WORKTREE_STORAGE_KEY)?.trim();
  return stored ? stored : null;
}

export function saveSelectedWorktree(branch: string | null): void {
  if (branch) {
    localStorage.setItem(LAST_SELECTED_WORKTREE_STORAGE_KEY, branch);
    return;
  }
  localStorage.removeItem(LAST_SELECTED_WORKTREE_STORAGE_KEY);
}

export function applyTheme(key: ThemeKey): void {
  const theme = getTheme(key);
  const root = document.documentElement;
  for (const [name, value] of Object.entries(theme.colors)) {
    root.style.setProperty(`--color-${name}`, value);
  }
  localStorage.setItem(THEME_STORAGE_KEY, key);
}

export function worktreeCreationPhaseLabel(phase: WorktreeCreationPhase | null): string {
  switch (phase) {
    case "creating_worktree":
      return "Creating worktree";
    case "preparing_runtime":
      return "Preparing runtime";
    case "running_post_create_hook":
      return "Running post-create hook";
    case "starting_session":
      return "Starting session";
    case "reconciling":
      return "Reconciling";
    default:
      return "Creating";
  }
}

export function resolveSelectedBranch(
  selectedBranch: string | null,
  selectedWorktree: Pick<WorktreeInfo, "branch"> | undefined,
  selectableWorktrees: Array<Pick<WorktreeInfo, "branch" | "mux">>,
  hasLoadedWorktrees: boolean,
): string | null {
  if (selectedBranch && selectedWorktree) return selectedBranch;
  if (!hasLoadedWorktrees) return selectedBranch;
  if (selectableWorktrees.length === 0) return null;

  const open = selectableWorktrees.find((worktree) => worktree.mux === "✓");
  return (open ?? selectableWorktrees[0]).branch;
}
