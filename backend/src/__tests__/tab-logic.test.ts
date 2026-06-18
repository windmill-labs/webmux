import { describe, expect, it } from "bun:test";
import { ROOT_TAB_ID, type WorktreeMeta } from "../domain/model";
import {
  activeTabId,
  appendTab,
  buildForkTab,
  findTab,
  nextForkSeq,
  removeTab,
  rootTab,
  setActiveTab,
  updateTab,
} from "../services/tab-logic";

function baseMeta(overrides: Partial<WorktreeMeta> = {}): WorktreeMeta {
  return {
    schemaVersion: 1,
    worktreeId: "wt-1",
    branch: "feature",
    createdAt: "2026-01-01T00:00:00.000Z",
    profile: "default",
    agent: "claude",
    runtime: "host",
    startupEnvValues: {},
    allocatedPorts: {},
    tabs: [
      { tabId: ROOT_TAB_ID, kind: "root", label: "Root", seq: null, sessionId: "root-sess", createdAt: "2026-01-01T00:00:00.000Z" },
    ],
    activeTabId: ROOT_TAB_ID,
    forkCounter: 0,
    ...overrides,
  };
}

describe("tab-logic", () => {
  it("builds fork tabs with incrementing labels and ids", () => {
    const tab = buildForkTab({ seq: 3, sessionId: "s3", paneId: "%5", createdAt: "t" });
    expect(tab).toEqual({ tabId: "fork-3", kind: "fork", label: "Fork 3", seq: 3, sessionId: "s3", paneId: "%5", createdAt: "t" });
  });

  it("numbers forks monotonically — deleting a fork does not reuse its number", () => {
    let meta = baseMeta();

    // Create Fork 1, Fork 2, Fork 3
    for (let n = 1; n <= 3; n += 1) {
      meta = appendTab(meta, buildForkTab({ seq: nextForkSeq(meta), sessionId: `s${n}`, createdAt: "t" }));
    }
    expect(meta.tabs?.map((tab) => tab.label)).toEqual(["Root", "Fork 1", "Fork 2", "Fork 3"]);
    expect(meta.forkCounter).toBe(3);

    // Delete Fork 2
    meta = removeTab(meta, "fork-2");
    expect(meta.tabs?.map((tab) => tab.label)).toEqual(["Root", "Fork 1", "Fork 3"]);

    // The next fork is Fork 4, not Fork 2
    meta = appendTab(meta, buildForkTab({ seq: nextForkSeq(meta), sessionId: "s4", createdAt: "t" }));
    expect(meta.tabs?.map((tab) => tab.label)).toEqual(["Root", "Fork 1", "Fork 3", "Fork 4"]);
    expect(meta.forkCounter).toBe(4);
  });

  it("appendTab makes the new fork active", () => {
    const meta = appendTab(baseMeta(), buildForkTab({ seq: 1, sessionId: "s1", createdAt: "t" }));
    expect(activeTabId(meta)).toBe("fork-1");
  });

  it("removing the active tab falls back to the root", () => {
    let meta = appendTab(baseMeta(), buildForkTab({ seq: 1, sessionId: "s1", createdAt: "t" }));
    expect(activeTabId(meta)).toBe("fork-1");
    meta = removeTab(meta, "fork-1");
    expect(activeTabId(meta)).toBe(ROOT_TAB_ID);
  });

  it("removing a non-active tab keeps the active selection", () => {
    let meta = appendTab(baseMeta(), buildForkTab({ seq: 1, sessionId: "s1", createdAt: "t" }));
    meta = appendTab(meta, buildForkTab({ seq: 2, sessionId: "s2", createdAt: "t" })); // fork-2 active
    meta = removeTab(meta, "fork-1");
    expect(activeTabId(meta)).toBe("fork-2");
  });

  it("updateTab patches a single tab's fields", () => {
    let meta = appendTab(baseMeta(), buildForkTab({ seq: 1, sessionId: null, createdAt: "t" }));
    meta = updateTab(meta, "fork-1", { sessionId: "discovered", paneId: "%9" });
    expect(findTab(meta, "fork-1")).toMatchObject({ sessionId: "discovered", paneId: "%9" });
  });

  it("rootTab and setActiveTab work as expected", () => {
    let meta = baseMeta();
    expect(rootTab(meta)?.tabId).toBe(ROOT_TAB_ID);
    meta = appendTab(meta, buildForkTab({ seq: 1, sessionId: "s1", createdAt: "t" }));
    meta = setActiveTab(meta, ROOT_TAB_ID);
    expect(activeTabId(meta)).toBe(ROOT_TAB_ID);
  });
});
