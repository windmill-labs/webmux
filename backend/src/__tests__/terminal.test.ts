import { describe, expect, it } from "bun:test";
import { parseTmuxSessionForWorktree } from "../terminal";

describe("parseTmuxSessionForWorktree", () => {
  it("finds the exact worktree window in its session", () => {
    const output = [
      "main-session:bash",
      "workmux:wm-my-branch",
      "workmux:wm-other-branch",
    ].join("\n");
    expect(parseTmuxSessionForWorktree(output, "my-branch")).toBe("workmux");
  });

  it("skips wm-dash-* viewer sessions even if they have the window", () => {
    const output = [
      "wm-dash-5111-1:wm-my-branch",
      "wm-dash-5222-2:wm-my-branch",
      "real-session:wm-my-branch",
    ].join("\n");
    expect(parseTmuxSessionForWorktree(output, "my-branch")).toBe("real-session");
  });

  it("falls back to any non-viewer session with a wm-* window", () => {
    const output = [
      "wm-dash-5111-1:wm-other",
      "workmux:wm-other",
    ].join("\n");
    expect(parseTmuxSessionForWorktree(output, "missing-branch")).toBe("workmux");
  });

  it("returns null when only viewer sessions have wm-* windows", () => {
    const output = [
      "wm-dash-5111-1:wm-my-branch",
      "wm-dash-5222-2:wm-other",
    ].join("\n");
    expect(parseTmuxSessionForWorktree(output, "my-branch")).toBeNull();
  });

  it("returns null when no wm-* windows exist", () => {
    const output = [
      "main:bash",
      "other:vim",
    ].join("\n");
    expect(parseTmuxSessionForWorktree(output, "my-branch")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(parseTmuxSessionForWorktree("", "my-branch")).toBeNull();
  });

  it("prefers exact match over fallback", () => {
    const output = [
      "session-a:wm-other-branch",
      "session-b:wm-my-branch",
    ].join("\n");
    expect(parseTmuxSessionForWorktree(output, "my-branch")).toBe("session-b");
  });
});
