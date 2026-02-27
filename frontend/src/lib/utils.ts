import type { PrEntry } from "./types";

export const SSH_STORAGE_KEY = "wt-ssh-host";

export function prLabel(pr: Pick<PrEntry, "repo" | "number">): string {
  return pr.repo ? `${pr.repo} #${pr.number}` : `PR #${pr.number}`;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
