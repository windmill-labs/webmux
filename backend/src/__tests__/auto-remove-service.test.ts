import { describe, expect, it } from "bun:test";
import type { GitGateway, GitWorktreeEntry } from "../adapters/git";
import type { PrEntry } from "../domain/model";
import {
  runAutoRemove,
  type AutoRemoveDependencies,
} from "../services/auto-remove-service";

const ROOT = "/repo";

function worktree(branch: string): GitWorktreeEntry {
  return { path: `/repo__wt/${branch}`, branch, bare: false } as GitWorktreeEntry;
}

/** Builds deps with fakes; records which branches got removed. */
function makeDeps(opts: {
  worktrees: GitWorktreeEntry[];
  states: Map<string, PrEntry["state"][]> | null;
  dirty?: Set<string>;
}): { deps: AutoRemoveDependencies; removed: string[] } {
  const removed: string[] = [];
  const removing = new Set<string>();
  const dirty = opts.dirty ?? new Set<string>();

  const git = {
    listLiveWorktrees: () => [{ path: ROOT, branch: "main", bare: false }, ...opts.worktrees],
    readWorktreeStatus: (path: string) => ({
      dirty: dirty.has(path),
      aheadCount: 0,
      currentCommit: null,
    }),
  } as unknown as GitGateway;

  const deps: AutoRemoveDependencies = {
    git,
    projectRoot: ROOT,
    lifecycleService: {
      removeWorktree: async (branch: string) => {
        removed.push(branch);
      },
    } as unknown as AutoRemoveDependencies["lifecycleService"],
    notifications: { notify: () => {} } as unknown as AutoRemoveDependencies["notifications"],
    isRemoving: (b) => removing.has(b),
    markRemoving: (b) => removing.add(b),
    unmarkRemoving: (b) => removing.delete(b),
    getBranchPrStates: async () => opts.states,
  };
  return { deps, removed };
}

describe("runAutoRemove", () => {
  it("removes a clean worktree whose PR is merged, without any prior open-state sync", async () => {
    const wt = worktree("feature");
    const { deps, removed } = makeDeps({
      worktrees: [wt],
      states: new Map([["feature", ["merged"]]]),
    });
    await runAutoRemove(deps);
    expect(removed).toEqual(["feature"]);
  });

  it("keeps a worktree whose PR is still open", async () => {
    const wt = worktree("feature");
    const { deps, removed } = makeDeps({
      worktrees: [wt],
      states: new Map([["feature", ["open"]]]),
    });
    await runAutoRemove(deps);
    expect(removed).toEqual([]);
  });

  it("keeps a worktree when any of its PRs across repos is not merged", async () => {
    // Same branch has a merged PR in one repo and an open PR in a linked repo.
    const wt = worktree("feature");
    const { deps, removed } = makeDeps({
      worktrees: [wt],
      states: new Map([["feature", ["merged", "open"]]]),
    });
    await runAutoRemove(deps);
    expect(removed).toEqual([]);
  });

  it("keeps a merged worktree that is dirty", async () => {
    const wt = worktree("feature");
    const { deps, removed } = makeDeps({
      worktrees: [wt],
      states: new Map([["feature", ["merged"]]]),
      dirty: new Set([wt.path]),
    });
    await runAutoRemove(deps);
    expect(removed).toEqual([]);
  });

  it("keeps a worktree that has no PR", async () => {
    const wt = worktree("feature");
    const { deps, removed } = makeDeps({ worktrees: [wt], states: new Map() });
    await runAutoRemove(deps);
    expect(removed).toEqual([]);
  });

  it("removes nothing when the PR state fetch is inconclusive", async () => {
    // A failed repo query (null) must not be read as "merged with no other PRs":
    // a transient gh failure on a linked repo could otherwise drop an open
    // cross-repo PR and remove a still-live worktree.
    const wt = worktree("feature");
    const { deps, removed } = makeDeps({ worktrees: [wt], states: null });
    await runAutoRemove(deps);
    expect(removed).toEqual([]);
  });
});
