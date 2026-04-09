import { describe, expect, it } from "bun:test";
import {
  buildArchivedWorktreePathSet,
  pruneArchivedWorktreeState,
  setArchivedWorktreeState,
} from "../services/archive-service";
import { WORKTREE_ARCHIVE_STATE_VERSION } from "../domain/model";

describe("archive-service", () => {
  it("adds and removes archived paths", () => {
    const archived = setArchivedWorktreeState({
      state: {
        schemaVersion: WORKTREE_ARCHIVE_STATE_VERSION,
        entries: [],
      },
      path: "/repo/__worktrees/feature-search",
      archived: true,
      now: () => new Date("2026-04-09T10:00:00.000Z"),
    });

    expect(archived.entries).toEqual([
      {
        path: "/repo/__worktrees/feature-search",
        archivedAt: "2026-04-09T10:00:00.000Z",
      },
    ]);
    expect(buildArchivedWorktreePathSet(archived).has("/repo/__worktrees/feature-search")).toBe(true);

    const restored = setArchivedWorktreeState({
      state: archived,
      path: "/repo/__worktrees/feature-search",
      archived: false,
    });

    expect(restored.entries).toEqual([]);
  });

  it("prunes entries for worktrees that no longer exist", () => {
    const pruned = pruneArchivedWorktreeState({
      state: {
        schemaVersion: WORKTREE_ARCHIVE_STATE_VERSION,
        entries: [
          {
            path: "/repo/__worktrees/feature-alpha",
            archivedAt: "2026-04-09T10:00:00.000Z",
          },
          {
            path: "/repo/__worktrees/feature-beta",
            archivedAt: "2026-04-09T11:00:00.000Z",
          },
        ],
      },
      paths: ["/repo/__worktrees/feature-beta"],
    });

    expect(pruned.entries).toEqual([
      {
        path: "/repo/__worktrees/feature-beta",
        archivedAt: "2026-04-09T11:00:00.000Z",
      },
    ]);
  });
});
