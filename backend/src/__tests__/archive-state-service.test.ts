import { describe, expect, it } from "bun:test";
import { WORKTREE_ARCHIVE_STATE_VERSION, type WorktreeArchiveState } from "../domain/model";
import { ArchiveStateService } from "../services/archive-state-service";
import { ProjectRuntime } from "../services/project-runtime";

function cloneArchiveState(state: WorktreeArchiveState): WorktreeArchiveState {
  return {
    schemaVersion: state.schemaVersion,
    entries: state.entries.map((entry) => ({ ...entry })),
  };
}

function createArchiveState(entries: WorktreeArchiveState["entries"]): WorktreeArchiveState {
  return {
    schemaVersion: WORKTREE_ARCHIVE_STATE_VERSION,
    entries: entries.map((entry) => ({ ...entry })),
  };
}

describe("archive-state-service", () => {
  it("prunes stale archive entries against tracked worktree paths", async () => {
    let state = createArchiveState([
      {
        path: "/repo/__worktrees/feature-alpha",
        archivedAt: "2026-04-09T10:00:00.000Z",
      },
      {
        path: "/repo/__worktrees/feature-beta",
        archivedAt: "2026-04-09T11:00:00.000Z",
      },
    ]);
    const service = new ArchiveStateService("/repo/.git", {
      readState: async () => cloneArchiveState(state),
      writeState: async (_gitDir, nextState) => {
        state = cloneArchiveState(nextState);
      },
    });
    const runtime = new ProjectRuntime();

    runtime.upsertWorktree({
      worktreeId: "wt-alpha",
      branch: "feature-alpha",
      path: "/repo/__worktrees/feature-alpha",
    });

    await service.prune(runtime.listWorktrees().map((worktree) => worktree.path));

    expect(state.entries).toEqual([
      {
        path: "/repo/__worktrees/feature-alpha",
        archivedAt: "2026-04-09T10:00:00.000Z",
      },
    ]);
  });

  it("serializes concurrent archive mutations", async () => {
    let state = createArchiveState([]);
    const service = new ArchiveStateService("/repo/.git", {
      readState: async () => {
        const snapshot = cloneArchiveState(state);
        await Bun.sleep(5);
        return snapshot;
      },
      writeState: async (_gitDir, nextState) => {
        await Bun.sleep(5);
        state = cloneArchiveState(nextState);
      },
    });

    await Promise.all([
      service.setArchived("/repo/__worktrees/feature-alpha", true),
      service.setArchived("/repo/__worktrees/feature-beta", true),
    ]);

    expect(state.entries.map((entry) => entry.path)).toEqual([
      "/repo/__worktrees/feature-alpha",
      "/repo/__worktrees/feature-beta",
    ]);
    expect(state.entries.every((entry) => entry.archivedAt.length > 0)).toBe(true);
  });
});
