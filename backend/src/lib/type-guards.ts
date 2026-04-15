export function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}

export function isStringArray(raw: unknown): raw is string[] {
  return Array.isArray(raw) && raw.every((value) => typeof value === "string");
}
