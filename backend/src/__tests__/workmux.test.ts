import { describe, expect, it } from "bun:test";
import { resolveDetachedBranch } from "../workmux";

describe("resolveDetachedBranch", () => {
  it("recovers branch name from path when detached", () => {
    expect(
      resolveDetachedBranch("(detached)", "../workmux-web__worktrees/linear-integration"),
    ).toBe("linear-integration");
  });

  it("leaves normal branch names unchanged", () => {
    expect(
      resolveDetachedBranch("my-feature", "../workmux-web__worktrees/my-feature"),
    ).toBe("my-feature");
  });

  it("returns (detached) when path is empty", () => {
    expect(resolveDetachedBranch("(detached)", "")).toBe("(detached)");
  });
});
