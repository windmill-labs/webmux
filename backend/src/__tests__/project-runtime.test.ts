import { describe, expect, it } from "bun:test";
import { ProjectRuntime } from "../services/project-runtime";

describe("ProjectRuntime", () => {
  it("creates a default runtime state when upserting a new worktree", () => {
    const runtime = new ProjectRuntime();
    const state = runtime.upsertWorktree({
      worktreeId: "wt_search",
      branch: "feature/search",
      path: "/repo/__worktrees/feature-search",
      profile: "default",
      agentName: "claude",
      runtime: "host",
    });

    expect(state.worktreeId).toBe("wt_search");
    expect(state.branch).toBe("feature/search");
    expect(state.profile).toBe("default");
    expect(state.agentName).toBe("claude");
    expect(state.session.windowName).toBe("wm-feature/search");
    expect(state.agent.lifecycle).toBe("closed");
  });

  it("applies runtime events to an existing worktree", () => {
    const runtime = new ProjectRuntime();
    runtime.upsertWorktree({
      worktreeId: "wt_search",
      branch: "feature/search",
      path: "/repo/__worktrees/feature-search",
      runtime: "host",
    });

    runtime.applyEvent(
      { worktreeId: "wt_search", branch: "feature/search", type: "agent_started" },
      () => new Date("2026-03-06T10:00:00.000Z"),
    );
    runtime.applyEvent(
      { worktreeId: "wt_search", branch: "feature/search", type: "title_changed", title: "Implement search panel" },
      () => new Date("2026-03-06T10:01:00.000Z"),
    );

    const state = runtime.getWorktree("wt_search");
    expect(state?.agent.lifecycle).toBe("running");
    expect(state?.agent.title).toBe("Implement search panel");
    expect(state?.agent.lastStartedAt).toBe("2026-03-06T10:00:00.000Z");
    expect(state?.agent.lastEventAt).toBe("2026-03-06T10:01:00.000Z");
  });

  it("tracks runtime errors and service/session updates", () => {
    const runtime = new ProjectRuntime();
    runtime.upsertWorktree({
      worktreeId: "wt_search",
      branch: "feature/search",
      path: "/repo/__worktrees/feature-search",
      runtime: "docker",
    });

    runtime.setSessionState("wt_search", {
      exists: true,
      sessionName: "wm-project-12345678",
      paneCount: 2,
    });
    runtime.setServices("wt_search", [
      { name: "frontend", port: 3010, running: true, url: "http://127.0.0.1:3010" },
    ]);
    runtime.applyEvent(
      { worktreeId: "wt_search", branch: "feature/search", type: "runtime_error", message: "agent crashed" },
      () => new Date("2026-03-06T10:02:00.000Z"),
    );

    const state = runtime.getWorktree("wt_search");
    expect(state?.session.exists).toBe(true);
    expect(state?.session.paneCount).toBe(2);
    expect(state?.services[0]?.running).toBe(true);
    expect(state?.agent.lifecycle).toBe("error");
    expect(state?.agent.lastError).toBe("agent crashed");
  });

  it("keeps branch lookups as a secondary index", () => {
    const runtime = new ProjectRuntime();
    runtime.upsertWorktree({
      worktreeId: "wt_search",
      branch: "feature/search",
      path: "/repo/__worktrees/feature-search",
      runtime: "host",
    });

    runtime.setGitState("wt_search", { branch: "feature/search-v2" });

    expect(runtime.getWorktreeByBranch("feature/search")).toBeNull();
    expect(runtime.getWorktreeByBranch("feature/search-v2")?.worktreeId).toBe("wt_search");
  });
});
