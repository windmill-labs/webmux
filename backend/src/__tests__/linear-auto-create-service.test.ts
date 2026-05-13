import { beforeEach, describe, expect, it } from "bun:test";
import {
  filterAutoCreateIssues,
  filterAutoOneshotIssues,
  resetProcessedIssues,
} from "../services/linear-auto-create-service";
import type { LinearIssue } from "../services/linear-service";

function createIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: overrides.id ?? "issue-id-1",
    identifier: overrides.identifier ?? "ENG-42",
    title: "Add a search bar",
    description: null,
    priority: 0,
    priorityLabel: "No priority",
    url: "https://linear.app/example/issue/ENG-42",
    branchName: overrides.branchName ?? "hugo/eng-42-add-a-search-bar",
    dueDate: null,
    updatedAt: "2026-05-01T00:00:00.000Z",
    state: { name: "Todo", color: "#000000", type: "unstarted" },
    team: { name: "Engineering", key: "ENG" },
    labels: [],
    project: null,
    ...overrides,
  };
}

describe("filterAutoCreateIssues / filterAutoOneshotIssues", () => {
  beforeEach(() => {
    resetProcessedIssues();
  });

  it("matches the webmux label only when in Todo state and no worktree exists", () => {
    const issues = [
      createIssue({ id: "a", identifier: "ENG-1", labels: [{ name: "webmux", color: "#fff" }] }),
      createIssue({ id: "b", identifier: "ENG-2", labels: [{ name: "Webmux", color: "#fff" }] }),
      createIssue({
        id: "c", identifier: "ENG-3",
        state: { name: "In Progress", color: "#fff", type: "started" },
        labels: [{ name: "webmux", color: "#fff" }],
      }),
      createIssue({ id: "d", identifier: "ENG-4", labels: [{ name: "other", color: "#fff" }] }),
    ];
    const matches = filterAutoCreateIssues(issues, []);
    expect(matches.map((i) => i.identifier)).toEqual(["ENG-1", "ENG-2"]);
  });

  it("excludes issues that already have a worktree from both filters", () => {
    const issues = [
      createIssue({
        id: "a", identifier: "ENG-1", branchName: "hugo/eng-1",
        labels: [{ name: "webmux", color: "#fff" }],
      }),
      createIssue({
        id: "b", identifier: "ENG-2", branchName: "hugo/eng-2",
        labels: [{ name: "_oneshot", color: "#fff" }],
      }),
    ];
    expect(filterAutoCreateIssues(issues, ["hugo/eng-1"])).toEqual([]);
    expect(filterAutoOneshotIssues(issues, ["hugo/eng-2"])).toEqual([]);
  });

  it("matches the _oneshot label and is case-insensitive", () => {
    const issues = [
      createIssue({ id: "a", identifier: "ENG-1", labels: [{ name: "_oneshot", color: "#fff" }] }),
      createIssue({ id: "b", identifier: "ENG-2", labels: [{ name: "_ONESHOT", color: "#fff" }] }),
      createIssue({ id: "c", identifier: "ENG-3", labels: [{ name: "webmux", color: "#fff" }] }),
    ];
    const matches = filterAutoOneshotIssues(issues, []);
    expect(matches.map((i) => i.identifier)).toEqual(["ENG-1", "ENG-2"]);
  });

  it("routes issues tagged with both webmux and _oneshot to the oneshot filter only", () => {
    const issues = [
      createIssue({
        id: "a", identifier: "ENG-1",
        labels: [{ name: "webmux", color: "#fff" }, { name: "_oneshot", color: "#fff" }],
      }),
    ];
    expect(filterAutoOneshotIssues(issues, []).map((i) => i.identifier)).toEqual(["ENG-1"]);
    expect(filterAutoCreateIssues(issues, [])).toEqual([]);
  });
});
