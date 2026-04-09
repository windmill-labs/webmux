import { resolve } from "node:path";
import {
  WORKTREE_ARCHIVE_STATE_VERSION,
  type WorktreeArchiveState,
} from "../domain/model";

function createArchiveState(entries: WorktreeArchiveState["entries"]): WorktreeArchiveState {
  return {
    schemaVersion: WORKTREE_ARCHIVE_STATE_VERSION,
    entries: [...entries].sort((left, right) => left.path.localeCompare(right.path)),
  };
}

export function normalizeArchivePath(path: string): string {
  return resolve(path);
}

export function buildArchivedWorktreePathSet(state: WorktreeArchiveState): Set<string> {
  return new Set(state.entries.map((entry) => normalizeArchivePath(entry.path)));
}

export function setArchivedWorktreeState(input: {
  state: WorktreeArchiveState;
  path: string;
  archived: boolean;
  now?: () => Date;
}): WorktreeArchiveState {
  const normalizedPath = normalizeArchivePath(input.path);
  const entries = input.state.entries.filter((entry) => normalizeArchivePath(entry.path) !== normalizedPath);
  if (!input.archived) {
    return createArchiveState(entries);
  }

  entries.push({
    path: normalizedPath,
    archivedAt: (input.now ?? (() => new Date()))().toISOString(),
  });
  return createArchiveState(entries);
}

export function pruneArchivedWorktreeState(input: {
  state: WorktreeArchiveState;
  paths: string[];
}): WorktreeArchiveState {
  const validPaths = new Set(input.paths.map((path) => normalizeArchivePath(path)));
  return createArchiveState(
    input.state.entries.filter((entry) => validPaths.has(normalizeArchivePath(entry.path))),
  );
}
