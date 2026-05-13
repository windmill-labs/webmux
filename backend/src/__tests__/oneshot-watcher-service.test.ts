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
  return { listWorktrees: () => worktrees } as unknown as ProjectRuntime;
}

function makeLifecycle(): {
  service: LifecycleService;
  closeCalls: string[];
  disarmCalls: string[];
} {
  const closeCalls: string[] = [];
  const disarmCalls: string[] = [];
  const service = {
    closeWorktree: mock(async (branch: string) => {
      closeCalls.push(branch);
    }),
    disarmOneshot: mock(async (branch: string) => {
      disarmCalls.push(branch);
      return true;
    }),
  } as unknown as LifecycleService;
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
      isActive: () => true,
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
      isActive: () => true,
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
      isActive: () => true,
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
      isActive: () => true,
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
      isActive: () => true,
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
      isActive: () => true,
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
      isActive: () => true,
      readWorktreeMeta: async () =>
        makeMeta({ autoCloseOnDone: false, postToLinearOnDone: { kind: "issue", issueId: "ENG-42" } }),
      idleGraceMs: 0,
      now: () => 0,
    });
    expect(postToLinear).toHaveBeenCalledTimes(1);
    expect(lc.closeCalls).toEqual([]);
    expect(lc.disarmCalls).toEqual(["feat/a"]);
  });

  it("does not run when isActive returns false", async () => {
    const lc = makeLifecycle();
    const readMeta = mock(async () => makeMeta({ autoCloseOnDone: true }));
    await runOneshotWatch({
      projectRuntime: makeRuntime([makeWorktree({ branch: "feat/a", lifecycle: "stopped" })]),
      lifecycleService: lc.service,
      postToLinear: async () => {},
      isActive: () => false,
      readWorktreeMeta: readMeta,
      idleGraceMs: 0,
      now: () => 0,
    });
    expect(readMeta).not.toHaveBeenCalled();
    expect(lc.closeCalls).toEqual([]);
  });
});
