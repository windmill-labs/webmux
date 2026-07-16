import type { ServiceSpec } from "./config";
import type { PrEntry, WorktreeMeta } from "./model";

const INVALID_BRANCH_CHARS_RE = /[~^:?*\[\]\\]+/g;
const UNSAFE_ENV_KEY_RE = /^[a-z_][a-z0-9_]*$/i;
const VALID_WORKTREE_NAME_RE = /^[a-z0-9][a-z0-9\-_./]*$/i;

export function sanitizeBranchName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(INVALID_BRANCH_CHARS_RE, "")
    .replace(/@\{/g, "")
    .replace(/\.{2,}/g, ".")
    .replace(/\/{2,}/g, "/")
    .replace(/-{2,}/g, "-")
    .replace(/^[.\-/]+|[.\-/]+$/g, "")
    .replace(/\.lock$/i, "");
}

export function isValidBranchName(raw: string): boolean {
  return raw.length > 0 && sanitizeBranchName(raw) === raw;
}

export function isValidWorktreeName(name: string): boolean {
  return name.length > 0 && VALID_WORKTREE_NAME_RE.test(name) && !name.includes("..");
}

export function isValidEnvKey(key: string): boolean {
  return UNSAFE_ENV_KEY_RE.test(key);
}

/** Path segments that the server's route map already owns (the hub routes). A
 *  derived project prefix must never collide with these or `/<prefix>` would
 *  shadow them. */
export const RESERVED_PROJECT_PREFIXES: ReadonlySet<string> = new Set(["api", "ws", "assets"]);

/** Sanitize a string into a URL-path-friendly prefix: lowercase, hyphenated,
 *  alphanumeric only. Returns empty if nothing usable remains. */
export function sanitizeProjectPrefix(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

/** Derive a webmux project URL prefix from a project directory basename.
 *  Adds `-2`, `-3`, … suffixes to avoid collisions with already-taken prefixes
 *  and with reserved path segments owned by the server's route map. */
export function deriveProjectPrefix(projectDir: string, takenPrefixes: Iterable<string>): string {
  const basename = projectDir.replace(/\/+$/, "").split("/").pop() ?? "webmux";
  const base = sanitizeProjectPrefix(basename) || "webmux";

  const taken = new Set<string>([...takenPrefixes, ...RESERVED_PROJECT_PREFIXES]);
  if (!taken.has(base)) return base;

  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

/** The fields worktree list ordering depends on, normalized across the surfaces
 *  that render a list (snapshot for the UI, `wt list` for the CLI). */
export interface WorktreeOrderFields {
  branch: string;
  /** Has a live session, or is still being created (it is about to have one). */
  open: boolean;
  prStates: readonly PrEntry["state"][];
}

/** Open worktrees first, then closed ones ranked by how much attention their PR
 *  still needs: an open PR, then a closed/merged one, then no PR at all. */
function worktreeOrderRank(worktree: WorktreeOrderFields): number {
  if (worktree.open) return 0;
  if (worktree.prStates.includes("open")) return 1;
  if (worktree.prStates.length > 0) return 2;
  return 3;
}

export function compareWorktreeOrder(left: WorktreeOrderFields, right: WorktreeOrderFields): number {
  const byRank = worktreeOrderRank(left) - worktreeOrderRank(right);
  return byRank !== 0 ? byRank : left.branch.localeCompare(right.branch);
}

export function allocateServicePorts(
  existingMetas: WorktreeMeta[],
  services: ServiceSpec[],
): Record<string, number> {
  const allocatable = services.filter((service) => service.portStart != null);
  if (allocatable.length === 0) return {};

  const reference = allocatable[0];
  const referenceStart = reference.portStart!;
  const referenceStep = reference.portStep ?? 1;
  const occupiedSlots = new Set<number>();

  for (const meta of existingMetas) {
    const port = meta.allocatedPorts[reference.portEnv];
    if (!Number.isInteger(port) || port < referenceStart) continue;
    const diff = port - referenceStart;
    if (diff % referenceStep !== 0) continue;
    occupiedSlots.add(diff / referenceStep);
  }

  let slot = 1;
  while (occupiedSlots.has(slot)) slot += 1;

  const result: Record<string, number> = {};
  for (const service of allocatable) {
    const start = service.portStart!;
    const step = service.portStep ?? 1;
    result[service.portEnv] = start + slot * step;
  }
  return result;
}
