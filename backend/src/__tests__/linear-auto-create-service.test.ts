import { beforeEach, describe, expect, it } from "bun:test";
import type { CreateLifecycleWorktreeInput } from "../services/lifecycle-service";
import type { FetchIssuesResult, LinearIssue } from "../services/linear-service";
import {
  filterAutoCreateIssues,
  filterAutoOneshotIssues,
  LINEAR_AUTO_CREATE_POLL_INTERVAL_MS,
  resetProcessedIssues,
  runLinearAutoCreateOnce,
  startLinearAutoCreateMonitor,
  type LinearAutoCreateDependencies,
} from "../services/linear-auto-create-service";

function createIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  const issue: LinearIssue = {
    id: "issue-1",
    identifier: "ENG-123",
    title: "Auto create this",
    description: "Details",
    priority: 0,
    priorityLabel: "No priority",
    url: "https://linear.app/acme/issue/ENG-123",
    branchName: "eng-123-auto-create",
    dueDate: null,
    updatedAt: "2026-05-13T10:00:00.000Z",
    state: {
      name: "Todo",
      color: "#999999",
      type: "unstarted",
    },
    team: {
      name: "Engineering",
      key: "ENG",
    },
    labels: [
      {
        name: "webmux",
        color: "#2563eb",
      },
    ],
    project: null,
  };

  return {
    ...issue,
    ...overrides,
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolveDeferred: ((value: T) => void) | null = null;
  const promise = new Promise<T>((resolve) => {
    resolveDeferred = resolve;
  });

  return {
    promise,
    resolve(value) {
      if (!resolveDeferred) throw new Error("deferred resolver not initialized");
      resolveDeferred(value);
    },
  };
}

function createDeps(input: {
  issues?: LinearIssue[] | (() => LinearIssue[]);
  existingBranches?: string[];
  fetchResult?: FetchIssuesResult;
  onFetch?: (options: { skipCache?: boolean } | undefined) => void;
  runOneshotForIssue?: (issueId: string) => Promise<{ branch: string }>;
  onOneshotPickedUp?: (input: { issue: LinearIssue; branch: string }) => Promise<void>;
} = {}): {
  deps: LinearAutoCreateDependencies;
  created: CreateLifecycleWorktreeInput[];
  fetchOptions: Array<{ skipCache?: boolean } | undefined>;
} {
  const created: CreateLifecycleWorktreeInput[] = [];
  const fetchOptions: Array<{ skipCache?: boolean } | undefined> = [];
  const issues: LinearIssue[] | (() => LinearIssue[]) = input.issues ?? [];
  const existingBranches = input.existingBranches ?? [];

  return {
    created,
    fetchOptions,
    deps: {
      lifecycleService: {
        async createWorktree(worktreeInput): Promise<{ branch: string; worktreeId: string }> {
          created.push(worktreeInput);
          return {
            branch: worktreeInput.branch ?? "generated-branch",
            worktreeId: `wt-${created.length}`,
          };
        },
      },
      git: {
        listWorktrees: () =>
          existingBranches.map((branch) => ({
            path: `/repo/__worktrees/${branch}`,
            branch,
            head: "abc123",
            detached: false,
            bare: false,
          })),
      },
      projectRoot: "/repo",
      fetchIssues: async (options) => {
        fetchOptions.push(options);
        input.onFetch?.(options);
        return input.fetchResult ?? {
          ok: true,
          data: typeof issues === "function" ? issues() : issues,
        };
      },
      ...(input.runOneshotForIssue ? { runOneshotForIssue: input.runOneshotForIssue } : {}),
      ...(input.onOneshotPickedUp ? { onOneshotPickedUp: input.onOneshotPickedUp } : {}),
    },
  };
}

describe("filterAutoCreateIssues", () => {
  beforeEach(() => {
    resetProcessedIssues();
  });

  it("keeps Todo issues with the webmux label that do not already have a worktree", () => {
    const issue = createIssue();
    const inProgress = createIssue({
      id: "issue-2",
      identifier: "ENG-124",
      branchName: "eng-124-started",
      state: {
        name: "In Progress",
        color: "#f59e0b",
        type: "started",
      },
    });
    const missingLabel = createIssue({
      id: "issue-3",
      identifier: "ENG-125",
      branchName: "eng-125-no-label",
      labels: [],
    });
    const existing = createIssue({
      id: "issue-4",
      identifier: "ENG-126",
      branchName: "eng-126-existing",
    });

    expect(filterAutoCreateIssues([issue, inProgress, missingLabel, existing], ["eng-126-existing"])).toEqual([issue]);
  });
});

describe("watchTeamKeys filter", () => {
  beforeEach(() => {
    resetProcessedIssues();
  });

  it("keeps every team when watchTeamKeys is undefined or empty", () => {
    const eng = createIssue({ id: "eng", identifier: "ENG-1", branchName: "eng-1", team: { name: "Engineering", key: "ENG" } });
    const ops = createIssue({ id: "ops", identifier: "OPS-1", branchName: "ops-1", team: { name: "Ops", key: "OPS" } });
    expect(filterAutoCreateIssues([eng, ops], []).map((i) => i.identifier)).toEqual(["ENG-1", "OPS-1"]);
    expect(filterAutoCreateIssues([eng, ops], [], []).map((i) => i.identifier)).toEqual(["ENG-1", "OPS-1"]);
  });

  it("drops issues whose team key is not in the (uppercase, normalized) allowlist", () => {
    const eng = createIssue({ id: "eng", identifier: "ENG-1", branchName: "eng-1", team: { name: "Engineering", key: "ENG" } });
    const ops = createIssue({ id: "ops", identifier: "OPS-1", branchName: "ops-1", team: { name: "Ops", key: "OPS" } });
    const design = createIssue({ id: "des", identifier: "DES-1", branchName: "des-1", team: { name: "Design", key: "DES" } });
    expect(filterAutoCreateIssues([eng, ops, design], [], ["ENG", "OPS"]).map((i) => i.identifier))
      .toEqual(["ENG-1", "OPS-1"]);
  });

  it("applies the same filter to the oneshot variant", () => {
    const ops = createIssue({
      id: "ops", identifier: "OPS-1", branchName: "ops-1",
      labels: [{ name: "webmux_oneshot", color: "#fff" }],
      team: { name: "Ops", key: "OPS" },
    });
    expect(filterAutoOneshotIssues([ops], [], ["ENG"])).toEqual([]);
    expect(filterAutoOneshotIssues([ops], [], ["OPS"]).map((i) => i.identifier)).toEqual(["OPS-1"]);
  });
});

describe("filterAutoOneshotIssues", () => {
  beforeEach(() => {
    resetProcessedIssues();
  });

  it("matches the webmux_oneshot label case-insensitively", () => {
    const issues = [
      createIssue({ id: "a", identifier: "ENG-1", branchName: "eng-1", labels: [{ name: "webmux_oneshot", color: "#fff" }] }),
      createIssue({ id: "b", identifier: "ENG-2", branchName: "eng-2", labels: [{ name: "WEBMUX_ONESHOT", color: "#fff" }] }),
      createIssue({ id: "c", identifier: "ENG-3", branchName: "eng-3", labels: [{ name: "webmux", color: "#fff" }] }),
    ];
    const matches = filterAutoOneshotIssues(issues, []);
    expect(matches.map((i) => i.identifier)).toEqual(["ENG-1", "ENG-2"]);
  });

  it("excludes issues that already have a worktree", () => {
    const issues = [
      createIssue({
        id: "a", identifier: "ENG-1", branchName: "eng-1",
        labels: [{ name: "webmux_oneshot", color: "#fff" }],
      }),
    ];
    expect(filterAutoOneshotIssues(issues, ["eng-1"])).toEqual([]);
  });

  it("routes issues tagged with both webmux and webmux_oneshot to the oneshot filter only", () => {
    const issues = [
      createIssue({
        id: "a", identifier: "ENG-1", branchName: "eng-1",
        labels: [{ name: "webmux", color: "#fff" }, { name: "webmux_oneshot", color: "#fff" }],
      }),
    ];
    expect(filterAutoOneshotIssues(issues, []).map((i) => i.identifier)).toEqual(["ENG-1"]);
    expect(filterAutoCreateIssues(issues, [])).toEqual([]);
  });
});

describe("runLinearAutoCreateOnce", () => {
  beforeEach(() => {
    resetProcessedIssues();
  });

  it("creates worktrees without requiring dashboard activity", async () => {
    const issue = createIssue();
    const { deps, created, fetchOptions } = createDeps({ issues: [issue] });

    await runLinearAutoCreateOnce(deps);

    expect(fetchOptions).toEqual([{ skipCache: true }]);
    expect(created).toEqual([
      {
        mode: "new",
        branch: issue.branchName,
        prompt: `${issue.title}\n\n${issue.description}`,
      },
    ]);
  });

  it("does not create duplicate worktrees for processed issues", async () => {
    const issue = createIssue();
    const { deps, created, fetchOptions } = createDeps({ issues: [issue] });

    await runLinearAutoCreateOnce(deps);
    await runLinearAutoCreateOnce(deps);

    expect(fetchOptions).toEqual([{ skipCache: true }, { skipCache: true }]);
    expect(created).toEqual([
      {
        mode: "new",
        branch: issue.branchName,
        prompt: `${issue.title}\n\n${issue.description}`,
      },
    ]);
  });

  it("dedupes permanent createWorktree failures so they don't retry every poll", async () => {
    const issue = createIssue();
    let createCalls = 0;
    const deps: LinearAutoCreateDependencies = {
      lifecycleService: {
        async createWorktree(): Promise<{ branch: string; worktreeId: string }> {
          createCalls += 1;
          throw new Error("Branch already exists");
        },
      },
      git: { listWorktrees: () => [] },
      projectRoot: "/repo",
      fetchIssues: async () => ({ ok: true, data: [issue] }),
    };

    await runLinearAutoCreateOnce(deps);
    await runLinearAutoCreateOnce(deps);
    await runLinearAutoCreateOnce(deps);

    expect(createCalls).toBe(1);
  });

  it("dedupes permanent oneshot failures so they don't retry every poll", async () => {
    const issue = createIssue({ labels: [{ name: "webmux_oneshot", color: "#fff" }] });
    let oneshotCalls = 0;
    const deps: LinearAutoCreateDependencies = {
      lifecycleService: {
        async createWorktree(): Promise<{ branch: string; worktreeId: string }> {
          throw new Error("should not be called");
        },
      },
      git: { listWorktrees: () => [] },
      projectRoot: "/repo",
      fetchIssues: async () => ({ ok: true, data: [issue] }),
      runOneshotForIssue: async () => {
        oneshotCalls += 1;
        throw new Error("server unreachable");
      },
    };

    await runLinearAutoCreateOnce(deps);
    await runLinearAutoCreateOnce(deps);
    await runLinearAutoCreateOnce(deps);

    expect(oneshotCalls).toBe(1);
  });

  it("re-creates after the label is removed and re-added", async () => {
    const labeled = createIssue();
    const unlabeled = createIssue({ labels: [] });
    let current: LinearIssue[] = [labeled];
    // No existing worktrees — so once removed, the branch-existence filter
    // won't be the thing blocking the second pass. processedIssueIds is.
    const { deps, created } = createDeps({ issues: () => current });

    await runLinearAutoCreateOnce(deps);
    expect(created.length).toBe(1);

    // Same issue still labeled → dedup blocks creation.
    await runLinearAutoCreateOnce(deps);
    expect(created.length).toBe(1);

    // Label removed → dedup entry evicts on next poll.
    current = [unlabeled];
    await runLinearAutoCreateOnce(deps);
    expect(created.length).toBe(1);

    // Label re-added → dedup is no longer blocking, so we trigger again.
    current = [labeled];
    await runLinearAutoCreateOnce(deps);
    expect(created.length).toBe(2);
  });

  it("does not create worktrees when the Linear fetch fails", async () => {
    const { deps, created, fetchOptions } = createDeps({
      fetchResult: {
        ok: false,
        error: "Linear API 401: Unauthorized",
      },
    });

    await runLinearAutoCreateOnce(deps);

    expect(fetchOptions).toEqual([{ skipCache: true }]);
    expect(created).toEqual([]);
  });

  it("calls runOneshotForIssue for webmux_oneshot-labeled issues and skips webmux create for them", async () => {
    const oneshotIssue = createIssue({
      id: "issue-oneshot", identifier: "ENG-200", branchName: "eng-200-oneshot",
      labels: [{ name: "webmux_oneshot", color: "#fff" }],
    });
    const createIssue1 = createIssue({
      id: "issue-create", identifier: "ENG-201", branchName: "eng-201-create",
      labels: [{ name: "webmux", color: "#fff" }],
    });
    const triggered: string[] = [];
    const { deps, created } = createDeps({
      issues: [oneshotIssue, createIssue1],
      runOneshotForIssue: async (id) => {
        triggered.push(id);
        return { branch: "eng-200-oneshot" };
      },
    });

    await runLinearAutoCreateOnce(deps);

    expect(triggered).toEqual(["ENG-200"]);
    expect(created.map((c) => c.branch)).toEqual(["eng-201-create"]);
  });

  it("does not notify onOneshotPickedUp for the regular `webmux` (create) path", async () => {
    // Regular pickups are user-driven (the user added the label themselves);
    // the comment would be noise. Only the autonomous oneshot path gets it.
    const issue = createIssue();
    const pickups: string[] = [];
    const { deps } = createDeps({
      issues: [issue],
      onOneshotPickedUp: async ({ issue: picked }) => {
        pickups.push(picked.identifier);
      },
    });

    await runLinearAutoCreateOnce(deps);

    expect(pickups).toEqual([]);
  });

  it("notifies onOneshotPickedUp with the branch resolved by runOneshotForIssue, not the issue's branchName", async () => {
    // Regression guard: `buildSeedFromLinear` may resolve to an attachment-payload
    // or PR branch instead of `issue.branchName`. The pickup-comment contract
    // requires the *actual* working branch.
    const oneshotIssue = createIssue({
      id: "issue-oneshot", identifier: "ENG-200", branchName: "eng-200-original",
      labels: [{ name: "webmux_oneshot", color: "#fff" }],
    });
    const pickups: Array<{ identifier: string; branch: string }> = [];
    const { deps } = createDeps({
      issues: [oneshotIssue],
      runOneshotForIssue: async () => ({ branch: "eng-200-resumed-from-attachment" }),
      onOneshotPickedUp: async ({ issue: picked, branch }) => {
        pickups.push({ identifier: picked.identifier, branch });
      },
    });

    await runLinearAutoCreateOnce(deps);

    expect(pickups).toEqual([
      { identifier: "ENG-200", branch: "eng-200-resumed-from-attachment" },
    ]);
  });

  it("does not notify onOneshotPickedUp when the oneshot launch itself fails", async () => {
    const oneshotIssue = createIssue({
      id: "issue-oneshot", identifier: "ENG-200", branchName: "eng-200-oneshot",
      labels: [{ name: "webmux_oneshot", color: "#fff" }],
    });
    const pickups: string[] = [];
    const deps: LinearAutoCreateDependencies = {
      lifecycleService: {
        async createWorktree(): Promise<{ branch: string; worktreeId: string }> {
          throw new Error("should not be called");
        },
      },
      git: { listWorktrees: () => [] },
      projectRoot: "/repo",
      fetchIssues: async () => ({ ok: true, data: [oneshotIssue] }),
      runOneshotForIssue: async () => { throw new Error("server unreachable"); },
      onOneshotPickedUp: async ({ issue: picked }) => {
        pickups.push(picked.identifier);
      },
    };

    await runLinearAutoCreateOnce(deps);

    expect(pickups).toEqual([]);
  });

  it("swallows onOneshotPickedUp failures so the pickup still completes", async () => {
    const oneshotIssue = createIssue({
      id: "issue-oneshot", identifier: "ENG-200", branchName: "eng-200-oneshot",
      labels: [{ name: "webmux_oneshot", color: "#fff" }],
    });
    const oneshotCalls: string[] = [];
    const { deps } = createDeps({
      issues: [oneshotIssue],
      runOneshotForIssue: async (id) => {
        oneshotCalls.push(id);
        return { branch: "eng-200-oneshot" };
      },
      onOneshotPickedUp: async () => {
        throw new Error("Linear comment failed");
      },
    });

    await runLinearAutoCreateOnce(deps);
    // Pickup still happened and is deduped on the next pass.
    await runLinearAutoCreateOnce(deps);

    expect(oneshotCalls).toEqual(["ENG-200"]);
  });

  it("skips webmux_oneshot issues when no runOneshotForIssue dep is provided", async () => {
    const oneshotIssue = createIssue({
      id: "issue-oneshot", identifier: "ENG-200", branchName: "eng-200-oneshot",
      labels: [{ name: "webmux_oneshot", color: "#fff" }],
    });
    const { deps, created } = createDeps({ issues: [oneshotIssue] });

    await runLinearAutoCreateOnce(deps);

    expect(created).toEqual([]);
  });
});

describe("startLinearAutoCreateMonitor", () => {
  beforeEach(() => {
    resetProcessedIssues();
  });

  it("uses a 60 second poll interval", async () => {
    let scheduledInterval = -1;
    const fetchStarted = createDeferred<void>();
    let fetchCount = 0;
    const { deps } = createDeps({
      onFetch: () => {
        fetchCount += 1;
        if (fetchCount === 1) fetchStarted.resolve();
      },
    });

    const stop = startLinearAutoCreateMonitor(deps, {
      intervalDeps: {
        scheduleEvery: (handler: () => void, intervalMs: number) => {
          scheduledInterval = intervalMs;
          handler();
          return 1;
        },
        cancelSchedule: () => {},
      },
    });

    await fetchStarted.promise;
    stop();

    expect(scheduledInterval).toBe(LINEAR_AUTO_CREATE_POLL_INTERVAL_MS);
    expect(LINEAR_AUTO_CREATE_POLL_INTERVAL_MS).toBe(60_000);
  });
});
