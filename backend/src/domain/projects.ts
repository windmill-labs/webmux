/** A project webmux knows about, persisted in `~/.webmux/projects.json`.
 *  `path` is the resolved git root; `name` is the display label shown in the
 *  project switcher. */
export interface ProjectEntry {
  path: string;
  name: string;
  addedAt: number;
}

export function isProjectEntry(value: unknown): value is ProjectEntry {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.path === "string"
    && v.path.length > 0
    && typeof v.name === "string"
    && typeof v.addedAt === "number";
}
