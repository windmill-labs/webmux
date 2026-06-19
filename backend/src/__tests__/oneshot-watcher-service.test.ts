import { beforeEach, describe, expect, it, mock } from "bun:test";
import {
  runOneshotWatch,
  resetOneshotWatcherState,
} from "../services/oneshot-watcher-service";
import type {
  AgentLifecycle,
  ManagedWorktreeRuntimeState,
  WorktreeMeta,
  WorktreeSource,
} from "../domain/model";
import type { LifecycleService } from "../services/lifecycle-service";
import type { ProjectRuntime } from "../services/project-runtime";

type OneshotLifecycleMock = Pick<LifecycleService, "closeWorktree" | "disarmOneshot">;

function makeWorktree(overrides: {
  branch: string;
  path?: string;
  source?: WorktreeSource;
  lifecycle?: AgentLifecycle;
  prs?: ManagedWorktreeRuntimeState["prs"];
}): ManagedWorktreeRuntimeState {
  const path = overrides.path ?? `/tmp/wt-${overrides.branch}`;
  return {
    worktreeId: `id-${overrides.branch}`,
    branch: overrides.branch,
    label: null,
    baseBranch: null,
    path,
    profile: "default",
    agentName: "claude",
    source: overrides.source ?? "oneshot",
    oneshot: null,
    agentTerminalStale: false,
    git: { exists: true, branch: overrides.branch, dirty: false, aheadCount: 0, currentCommit: null },
    session: { exists: true, sessionName: null, windowName: overrides.branch, paneCount: 1 },
    agent: {
      runtime: "host",
      lifecycle: overrides.lifecycle ?? "running",
      lastStartedAt: null,
      lastEventAt: null,
      lastError: null,
    },
    services: [],
    prs: overrides.prs ?? [],
    tabs: [],
    activeTabId: null,
  };
}

function makeMeta(oneshot: WorktreeMeta["oneshot"] | undefined): WorktreeMeta {
  return {
    schemaVersion: 1,
    worktreeId: "id-x",
    branch: "feature/x",
    createdAt: "2026-05-01T00:00:00.000Z",
    profile: "default",
    agent: "claude",
    runtime: "host",
    startupEnvValues: {},
    allocatedPorts: {},
    ...(oneshot ? { oneshot } : {}),
  };
}

function makeRuntime(worktrees: ManagedWorktreeRuntimeState[]): ProjectRuntime {
  // Stub only the methods the watcher exercises. setOneshot mutates the array in
  // place so a follow-up listWorktrees() reflects the disarm.
  return {
    listWorktrees: () => worktrees,
    getWorktreeByBranch: (branch: string) =>
      worktrees.find((wt) => wt.branch === branch) ?? null,
    setOneshot: (worktreeId: string, oneshot: ManagedWorktreeRuntimeState["oneshot"]) => {
      const target = worktrees.find((wt) => wt.worktreeId === worktreeId);
      if (target) target.oneshot = oneshot;
      return target ?? null;
    },
  } as unknown as ProjectRuntime;
}

function makeLifecycle(): {
  service: OneshotLifecycleMock;
  closeCalls: string[];
  disarmCalls: string[];
} {
  const closeCalls: string[] = [];
  const disarmCalls: string[] = [];
  const service: OneshotLifecycleMock = {
    closeWorktree: mock(async (branch: string) => {
      closeCalls.push(branch);
    }),
    disarmOneshot: mock(async (branch: string) => {
      disarmCalls.push(branch);
      return true;
    }),
  };
  return { service, closeCalls, disarmCalls };
}

describe("oneshot-watcher-service", () => {
  beforeEach(() => {
    resetOneshotWatcherState();
  });

  it("skips worktrees that are not oneshot source", async () => {
    const lc = makeLifecycle();
    const readMeta = mock(async () => makeMeta({ autoCloseOnDone: true }));
    await runOneshotWatch({
      projectRuntime: makeRuntime([makeWorktree({ branch: "feat/a", source: "ui", lifecycle: "idle" })]),
      lifecycleService: lc.service,
      postToLinear: async () => {},
      readWorktreeMeta: readMeta,
      idleGraceMs: 0,
      now: () => 0,
    });
    expect(readMeta).not.toHaveBeenCalled();
    expect(lc.closeCalls).toEqual([]);
  });

  it("skips when meta is missing oneshot block (disarmed)", async () => {
    const lc = makeLifecycle();
    await runOneshotWatch({
      projectRuntime: makeRuntime([makeWorktree({ branch: "feat/a", lifecycle: "idle" })]),
      lifecycleService: lc.service,
      postToLinear: async () => {},
      readWorktreeMeta: async () => makeMeta(undefined),
      idleGraceMs: 0,
      now: () => 0,
    });
    expect(lc.closeCalls).toEqual([]);
    expect(lc.disarmCalls).toEqual([]);
  });

  it("does not fire while agent is still running", async () => {
    const lc = makeLifecycle();
    await runOneshotWatch({
      projectRuntime: makeRuntime([makeWorktree({ branch: "feat/a", lifecycle: "running" })]),
      lifecycleService: lc.service,
      postToLinear: async () => {},
      readWorktreeMeta: async () => makeMeta({ autoCloseOnDone: true }),
      idleGraceMs: 0,
      now: () => 0,
    });
    expect(lc.closeCalls).toEqual([]);
  });

  it("waits the idle grace before firing on idle", async () => {
    const lc = makeLifecycle();
    let nowMs = 1000;
    const deps = {
      projectRuntime: makeRuntime([makeWorktree({ branch: "feat/a", lifecycle: "idle" as AgentLifecycle })]),
      lifecycleService: lc.service,
      postToLinear: async () => {},
      readWorktreeMeta: async () => makeMeta({ autoCloseOnDone: true }),
      idleGraceMs: 5_000,
      now: () => nowMs,
    };
    await runOneshotWatch(deps);
    expect(lc.closeCalls).toEqual([]);
    nowMs += 1_000;
    await runOneshotWatch(deps);
    expect(lc.closeCalls).toEqual([]);
    nowMs += 5_000;
    await runOneshotWatch(deps);
    expect(lc.closeCalls).toEqual(["feat/a"]);
    expect(lc.disarmCalls).toEqual(["feat/a"]);
  });

  it("fires immediately on stopped without waiting for grace", async () => {
    const lc = makeLifecycle();
    await runOneshotWatch({
      projectRuntime: makeRuntime([makeWorktree({ branch: "feat/a", lifecycle: "stopped" })]),
      lifecycleService: lc.service,
      postToLinear: async () => {},
      readWorktreeMeta: async () => makeMeta({ autoCloseOnDone: true }),
      idleGraceMs: 60_000,
      now: () => 0,
    });
    expect(lc.closeCalls).toEqual(["feat/a"]);
  });

  it("posts to Linear before closing when target is set", async () => {
    const lc = makeLifecycle();
    const calls: string[] = [];
    lc.service.closeWorktree = mock(async (branch: string) => {
      calls.push(`close:${branch}`);
    });
    const postToLinear = mock(async (branch: string) => {
      calls.push(`post:${branch}`);
    });
    await runOneshotWatch({
      projectRuntime: makeRuntime([makeWorktree({ branch: "feat/a", lifecycle: "stopped" })]),
      lifecycleService: lc.service,
      postToLinear,
      readWorktreeMeta: async () =>
        makeMeta({ autoCloseOnDone: true, postToLinearOnDone: { kind: "issue", issueId: "ENG-42" } }),
      idleGraceMs: 0,
      now: () => 0,
    });
    expect(calls).toEqual(["post:feat/a", "close:feat/a"]);
  });

  it("respects autoCloseOnDone=false but still posts to Linear", async () => {
    const lc = makeLifecycle();
    const postToLinear = mock(async () => {});
    await runOneshotWatch({
      projectRuntime: makeRuntime([makeWorktree({ branch: "feat/a", lifecycle: "stopped" })]),
      lifecycleService: lc.service,
      postToLinear,
      readWorktreeMeta: async () =>
        makeMeta({ autoCloseOnDone: false, postToLinearOnDone: { kind: "issue", issueId: "ENG-42" } }),
      idleGraceMs: 0,
      now: () => 0,
    });
    expect(postToLinear).toHaveBeenCalledTimes(1);
    expect(lc.closeCalls).toEqual([]);
    expect(lc.disarmCalls).toEqual(["feat/a"]);
  });

  it("still closes + disarms when postToLinear fails", async () => {
    const lc = makeLifecycle();
    const postToLinear = mock(async () => { throw new Error("linear API 502"); });
    await runOneshotWatch({
      projectRuntime: makeRuntime([makeWorktree({ branch: "feat/a", lifecycle: "stopped" })]),
      lifecycleService: lc.service,
      postToLinear,
      readWorktreeMeta: async () =>
        makeMeta({ autoCloseOnDone: true, postToLinearOnDone: { kind: "issue", issueId: "ENG-42" } }),
      idleGraceMs: 0,
      now: () => 0,
    });
    expect(postToLinear).toHaveBeenCalledTimes(1);
    expect(lc.closeCalls).toEqual(["feat/a"]);
    expect(lc.disarmCalls).toEqual(["feat/a"]);
  });

  it("bails on close + disarm when meta is disarmed during postToLinear", async () => {
    const lc = makeLifecycle();
    const reads: number[] = [];
    let pass = 0;
    // First read inside processWorktree: still armed. Second read (after post,
    // before close): disarmed by a concurrent user interaction.
    const readMeta = mock(async () => {
      reads.push(pass++);
      return pass === 1
        ? makeMeta({ autoCloseOnDone: true, postToLinearOnDone: { kind: "issue", issueId: "ENG-42" } })
        : makeMeta(undefined);
    });
    await runOneshotWatch({
      projectRuntime: makeRuntime([makeWorktree({ branch: "feat/a", lifecycle: "stopped" })]),
      lifecycleService: lc.service,
      postToLinear: async () => {},
      readWorktreeMeta: readMeta,
      idleGraceMs: 0,
      now: () => 0,
    });
    expect(reads.length).toBe(2);
    expect(lc.closeCalls).toEqual([]);
    // disarm via lifecycleService is also skipped — the user's disarm already cleared meta.
    expect(lc.disarmCalls).toEqual([]);
  });

  it("still disarms when closeWorktree throws", async () => {
    const lc = makeLifecycle();
    lc.service.closeWorktree = mock(async () => { throw new Error("tmux gone"); });
    await runOneshotWatch({
      projectRuntime: makeRuntime([makeWorktree({ branch: "feat/a", lifecycle: "stopped" })]),
      lifecycleService: lc.service,
      postToLinear: async () => {},
      readWorktreeMeta: async () => makeMeta({ autoCloseOnDone: true }),
      idleGraceMs: 0,
      now: () => 0,
    });
    expect(lc.disarmCalls).toEqual(["feat/a"]);
  });

  it("does not immediately fire on a freshly upserted closed worktree (cold-start guard)", async () => {
    // `closed` is the default lifecycle before the agent's first event arrives.
    // If the watcher fired right away it would close + post on an empty session.
    const lc = makeLifecycle();
    const deps = {
      projectRuntime: makeRuntime([makeWorktree({ branch: "feat/a", lifecycle: "closed" as AgentLifecycle })]),
      lifecycleService: lc.service,
      postToLinear: async () => {},
      readWorktreeMeta: async () => makeMeta({ autoCloseOnDone: true }),
      idleGraceMs: 60_000,
      now: () => 0,
    };
    await runOneshotWatch(deps);
    expect(lc.closeCalls).toEqual([]);
    expect(lc.disarmCalls).toEqual([]);
  });

  it("fires on `closed` once the idle grace has elapsed (genuine close)", async () => {
    const lc = makeLifecycle();
    let nowMs = 1_000;
    const deps = {
      projectRuntime: makeRuntime([makeWorktree({ branch: "feat/a", lifecycle: "closed" as AgentLifecycle })]),
      lifecycleService: lc.service,
      postToLinear: async () => {},
      readWorktreeMeta: async () => makeMeta({ autoCloseOnDone: true }),
      idleGraceMs: 5_000,
      now: () => nowMs,
    };
    await runOneshotWatch(deps);
    expect(lc.closeCalls).toEqual([]);
    nowMs += 6_000;
    await runOneshotWatch(deps);
    expect(lc.closeCalls).toEqual(["feat/a"]);
    expect(lc.disarmCalls).toEqual(["feat/a"]);
  });

});
