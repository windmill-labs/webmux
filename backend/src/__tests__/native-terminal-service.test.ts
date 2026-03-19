import { describe, expect, it } from "bun:test";
import type { ManagedWorktreeRuntimeState } from "../domain/model";
import { buildNativeTerminalLaunch, buildNativeTerminalTmuxCommand } from "../services/native-terminal-service";

function makeState(overrides: Partial<ManagedWorktreeRuntimeState> = {}): ManagedWorktreeRuntimeState {
  return {
    worktreeId: "wt_feature_search",
    branch: "feature/search",
    path: "/repo/__worktrees/feature-search",
    meta: {
      schemaVersion: 1,
      worktreeId: "wt_feature_search",
      branch: "feature/search",
      createdAt: "2026-03-19T00:00:00.000Z",
      profile: "default",
      agent: "codex",
      runtime: "host",
      startupEnvValues: {},
      allocatedPorts: {},
    },
    git: {
      exists: true,
      branch: "feature/search",
      dirty: false,
      aheadCount: 0,
      currentCommit: "abc123",
    },
    session: {
      exists: true,
      sessionName: "wm-project-12345678",
      windowName: "wm-feature/search",
      paneCount: 2,
    },
    agent: {
      runtime: "host",
      lifecycle: "running",
      lastStartedAt: null,
      lastEventAt: null,
      lastError: null,
    },
    services: [],
    prs: [],
    linearIssue: null,
    creation: null,
    ...overrides,
  };
}

describe("buildNativeTerminalTmuxCommand", () => {
  it("uses isolated tmux socket and config when available", () => {
    expect(buildNativeTerminalTmuxCommand({
      WEBMUX_ISOLATED_TMUX_SOCKET: "webmux-native-demo",
      WEBMUX_ISOLATED_TMUX_CONFIG: "/tmp/webmux.conf",
    })).toBe("tmux -L 'webmux-native-demo' -f '/tmp/webmux.conf'");
  });

  it("falls back to plain tmux when no isolated settings are present", () => {
    expect(buildNativeTerminalTmuxCommand({})).toBe("tmux");
  });
});

describe("buildNativeTerminalLaunch", () => {
  it("builds a grouped tmux attach command", () => {
    const launch = buildNativeTerminalLaunch({
      branch: "feature/search",
      state: makeState(),
      tmuxCommand: "tmux -L 'webmux-native-demo' -f '/tmp/webmux.conf'",
      sessionPrefix: "wm-native-5111-",
    });

    expect(launch.ok).toBe(true);
    if (!launch.ok) return;

    expect(launch.data.worktreeId).toBe("wt_feature_search");
    expect(launch.data.path).toBe("/repo/__worktrees/feature-search");
    expect(launch.data.shellCommand).toContain("/bin/sh -lc");
    expect(launch.data.shellCommand).toContain("wm-native-5111-wt_feature_search");
    expect(launch.data.shellCommand).toContain("new-session -d -s \"$g_name\" -t");
    expect(launch.data.shellCommand).toContain("wm-project-12345678");
    expect(launch.data.shellCommand).toContain("attach-session -t \"$g_name\"");
  });

  it("returns not_found when the worktree does not exist", () => {
    const launch = buildNativeTerminalLaunch({
      branch: "feature/missing",
      state: null,
      tmuxCommand: "tmux",
    });

    expect(launch).toEqual({
      ok: false,
      reason: "not_found",
      message: "Worktree not found: feature/missing",
    });
  });

  it("returns closed when the tmux window is not open", () => {
    const launch = buildNativeTerminalLaunch({
      branch: "feature/search",
      state: makeState({
        session: {
          exists: false,
          sessionName: null,
          windowName: "wm-feature/search",
          paneCount: 0,
        },
      }),
      tmuxCommand: "tmux",
    });

    expect(launch).toEqual({
      ok: false,
      reason: "closed",
      message: "No open tmux window found for worktree: feature/search",
    });
  });
});
