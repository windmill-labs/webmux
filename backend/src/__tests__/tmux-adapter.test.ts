import { describe, expect, it } from "bun:test";
import {
  buildProjectSessionName,
  buildWorktreeWindowName,
  parseWindowSummaries,
  sanitizeTmuxNameSegment,
} from "../adapters/tmux";

describe("sanitizeTmuxNameSegment", () => {
  it("normalizes arbitrary path-like input", () => {
    expect(sanitizeTmuxNameSegment("Workmux Web/Desktop")).toBe("workmux-web-desktop");
  });

  it("falls back to x for empty sanitization", () => {
    expect(sanitizeTmuxNameSegment("////")).toBe("x");
  });
});

describe("buildProjectSessionName", () => {
  it("is deterministic for the same repo root", () => {
    const a = buildProjectSessionName("/tmp/my-project");
    const b = buildProjectSessionName("/tmp/my-project");
    expect(a).toBe(b);
  });

  it("changes across different repo roots", () => {
    expect(buildProjectSessionName("/tmp/project-a")).not.toBe(buildProjectSessionName("/tmp/project-b"));
  });
});

describe("buildWorktreeWindowName", () => {
  it("uses the wm- prefix", () => {
    expect(buildWorktreeWindowName("feature/search")).toBe("wm-feature/search");
  });
});

describe("parseWindowSummaries", () => {
  it("parses tmux list-windows output", () => {
    const output = [
      "wm-project-a1b2c3d4\twm-main\t2",
      "wm-project-a1b2c3d4\twm-feature/search\t3",
    ].join("\n");

    expect(parseWindowSummaries(output)).toEqual([
      {
        sessionName: "wm-project-a1b2c3d4",
        windowName: "wm-main",
        paneCount: 2,
      },
      {
        sessionName: "wm-project-a1b2c3d4",
        windowName: "wm-feature/search",
        paneCount: 3,
      },
    ]);
  });
});
