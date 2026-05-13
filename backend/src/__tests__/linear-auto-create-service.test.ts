import { beforeEach, describe, expect, it } from "bun:test";
import type { CreateLifecycleWorktreeInput } from "../services/lifecycle-service";
import type { FetchIssuesResult, LinearIssue } from "../services/linear-service";
import {
  filterAutoCreateIssues,
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
  issues?: LinearIssue[];
  existingBranches?: string[];
  fetchResult?: FetchIssuesResult;
  onFetch?: (options: { skipCache?: boolean } | undefined) => void;
} = {}): {
  deps: LinearAutoCreateDependencies;
  created: CreateLifecycleWorktreeInput[];
  fetchOptions: Array<{ skipCache?: boolean } | undefined>;
} {
  const created: CreateLifecycleWorktreeInput[] = [];
  const fetchOptions: Array<{ skipCache?: boolean } | undefined> = [];
  const issues = input.issues ?? [];
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
          data: issues,
        };
      },
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
});

describe("startLinearAutoCreateMonitor", () => {
  beforeEach(() => {
    resetProcessedIssues();
  });

  it("uses a 60 second poll interval", async () => {
    let scheduledInterval = -1;
    const fetchStarted = createDeferred<void>();
    const { deps } = createDeps({
      onFetch: () => fetchStarted.resolve(undefined),
    });

    const stop = startLinearAutoCreateMonitor(deps, {
      intervalDeps: {
        scheduleEvery: (_handler, intervalMs) => {
          scheduledInterval = intervalMs;
          return 1;
        },
        cancelSchedule: () => {},
      },
    });

    await fetchStarted.promise;
    stop();

    expect(scheduledInterval).toBe(LINEAR_AUTO_CREATE_POLL_INTERVAL_MS);
    expect(scheduledInterval).toBe(60_000);
  });
});
