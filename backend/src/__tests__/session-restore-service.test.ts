import { describe, expect, it } from "bun:test";
import {
  buildOpenSessionsState,
  computeOpenBranches,
  saveOpenSessionsSnapshot,
} from "../services/session-restore-service";
import { buildProjectSessionName, buildWorktreeWindowName } from "../adapters/tmux";
import { OPEN_SESSIONS_STATE_VERSION, type OpenSessionsState } from "../domain/model";
import type { GitWorktreeEntry } from "../adapters/git";
import type { TmuxWindowSummary } from "../adapters/tmux";

const PROJECT_DIR = "/repo";
const SESSION = buildProjectSessionName(PROJECT_DIR);

function worktree(path: string, branch: string | null): GitWorktreeEntry {
  return { path, branch, head: null, detached: false, bare: false };
}

function window(windowName: string, sessionName = SESSION): TmuxWindowSummary {
  return { sessionName, windowName, paneCount: 1 };
}

describe("computeOpenBranches", () => {
  it("returns only branches whose worktree window is open in the project session", () => {
    const branches = computeOpenBranches({
      worktrees: [
        worktree(PROJECT_DIR, "main"),
        worktree("/repo/wt/feature-a", "feature-a"),
        worktree("/repo/wt/feature-b", "feature-b"),
        worktree("/repo/wt/feature-c", "feature-c"),
      ],
      windows: [
        window(buildWorktreeWindowName("feature-a")),
        window(buildWorktreeWindowName("feature-c")),
        window(buildWorktreeWindowName("feature-b"), "some-other-session"),
      ],
      sessionName: SESSION,
      projectDir: PROJECT_DIR,
    });

    expect(branches).toEqual(["feature-a", "feature-c"]);
  });

  it("excludes the project root worktree and bare entries", () => {
    const bare: GitWorktreeEntry = { path: "/repo/.bare", branch: null, head: null, detached: false, bare: true };
    const branches = computeOpenBranches({
      worktrees: [worktree(PROJECT_DIR, "main"), bare],
      windows: [window(buildWorktreeWindowName("main"))],
      sessionName: SESSION,
      projectDir: PROJECT_DIR,
    });

    expect(branches).toEqual([]);
  });

  it("falls back to the directory name when a worktree has no branch", () => {
    const branches = computeOpenBranches({
      worktrees: [worktree("/repo/wt/detached", null)],
      windows: [window(buildWorktreeWindowName("detached"))],
      sessionName: SESSION,
      projectDir: PROJECT_DIR,
    });

    expect(branches).toEqual(["detached"]);
  });
});

describe("buildOpenSessionsState", () => {
  it("stamps the schema version and savedAt", () => {
    const state = buildOpenSessionsState(["a", "b"], new Date("2026-06-27T12:00:00.000Z"));
    expect(state).toEqual({
      schemaVersion: OPEN_SESSIONS_STATE_VERSION,
      savedAt: "2026-06-27T12:00:00.000Z",
      branches: ["a", "b"],
    });
  });
});

describe("saveOpenSessionsSnapshot", () => {
  function makeDeps(windows: TmuxWindowSummary[]) {
    const writes: Array<{ gitDir: string; state: OpenSessionsState }> = [];
    return {
      writes,
      deps: {
        git: {
          listLiveWorktrees: () => [
            worktree(PROJECT_DIR, "main"),
            worktree("/repo/wt/feature-a", "feature-a"),
          ],
          resolveWorktreeGitDir: (cwd: string) => `${cwd}/.git`,
        },
        tmux: { listWindows: () => windows },
        projectRoot: PROJECT_DIR,
        now: () => new Date("2026-06-27T12:00:00.000Z"),
        writeState: async (gitDir: string, state: OpenSessionsState) => {
          writes.push({ gitDir, state });
        },
      },
    };
  }

  it("writes the open branches when at least one session is open", async () => {
    const { writes, deps } = makeDeps([window(buildWorktreeWindowName("feature-a"))]);
    const branches = await saveOpenSessionsSnapshot(deps);

    expect(branches).toEqual(["feature-a"]);
    expect(writes).toEqual([
      {
        gitDir: `${PROJECT_DIR}/.git`,
        state: {
          schemaVersion: OPEN_SESSIONS_STATE_VERSION,
          savedAt: "2026-06-27T12:00:00.000Z",
          branches: ["feature-a"],
        },
      },
    ]);
  });

  it("does not overwrite the snapshot when nothing is open (reboot safety)", async () => {
    const { writes, deps } = makeDeps([]);
    const branches = await saveOpenSessionsSnapshot(deps);

    expect(branches).toBeNull();
    expect(writes).toEqual([]);
  });
});
