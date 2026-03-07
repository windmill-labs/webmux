import type { ServiceSpec } from "./config";
import type { WorktreeMeta } from "./model";

const INVALID_BRANCH_CHARS_RE = /[~^:?*\[\]\\]+/g;
const UNSAFE_ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

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

export function isValidEnvKey(key: string): boolean {
  return UNSAFE_ENV_KEY_RE.test(key);
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
