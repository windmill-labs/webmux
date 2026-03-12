import type { PrEntry, ThemeKey, WorktreeCreationPhase } from "./types";
import { getTheme } from "./themes";

export const SSH_STORAGE_KEY = "wt-ssh-host";
export const THEME_STORAGE_KEY = "wt-theme";

export function prLabel(pr: Pick<PrEntry, "repo" | "number">): string {
  return pr.repo ? `${pr.repo} #${pr.number}` : `PR #${pr.number}`;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function searchMatch(needle: string, haystack: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

export function loadSavedTheme(): ThemeKey {
  return (localStorage.getItem(THEME_STORAGE_KEY) as ThemeKey | null) ?? "github-dark";
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
