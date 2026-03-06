import { describe, expect, it } from "bun:test";
import { parseRuntimeEvent } from "../domain/events";

describe("parseRuntimeEvent", () => {
  it("parses valid runtime events", () => {
    expect(parseRuntimeEvent({
      worktreeId: "wt_search",
      branch: "feature/search",
      type: "agent_started",
    })).toEqual({
      worktreeId: "wt_search",
      branch: "feature/search",
      type: "agent_started",
    });

    expect(parseRuntimeEvent({
      worktreeId: "wt_search",
      branch: "feature/search",
      type: "title_changed",
      title: "Implement search",
    })).toEqual({
      worktreeId: "wt_search",
      branch: "feature/search",
      type: "title_changed",
      title: "Implement search",
    });

    expect(parseRuntimeEvent({
      worktreeId: "wt_search",
      branch: "feature/search",
      type: "agent_status_changed",
      lifecycle: "idle",
    })).toEqual({
      worktreeId: "wt_search",
      branch: "feature/search",
      type: "agent_status_changed",
      lifecycle: "idle",
    });
  });

  it("rejects malformed runtime events", () => {
    expect(parseRuntimeEvent(null)).toBeNull();
    expect(parseRuntimeEvent({
      worktreeId: "wt_search",
      branch: "feature/search",
      type: "runtime_error",
    })).toBeNull();
    expect(parseRuntimeEvent({
      worktreeId: "wt_search",
      branch: "feature/search",
      type: "pr_opened",
      url: 123,
    })).toBeNull();
    expect(parseRuntimeEvent({
      worktreeId: "wt_search",
      branch: "feature/search",
      type: "agent_status_changed",
      lifecycle: "closed",
    })).toBeNull();
  });
});
