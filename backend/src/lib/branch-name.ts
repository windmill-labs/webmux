import { randomUUID } from "node:crypto";

export function generateFallbackBranchName(): string {
  return `change-${randomUUID().slice(0, 8)}`;
}
