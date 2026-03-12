import type { PrEntry, WorktreeCreationPhase } from "./types";

export const SSH_STORAGE_KEY = "wt-ssh-host";

export function prLabel(pr: Pick<PrEntry, "repo" | "number">): string {
  return pr.repo ? `${pr.repo} #${pr.number}` : `PR #${pr.number}`;
}

export function prStateTextClass(state: PrEntry["state"]): string {
  if (state === "merged") return "text-[#a78bfa]";
  if (state === "closed") return "text-danger";
  return "text-primary";
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
  if (pr.state === "merged") return "border-[#a78bfa]/35 bg-[#a78bfa]/8";
  if (pr.state === "closed") return "border-danger/35 bg-danger/5";
  return "border-edge bg-surface";
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function searchMatch(needle: string, haystack: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
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
