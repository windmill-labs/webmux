import { describe, expect, it } from "bun:test";
import { parseOneshotArgs } from "./oneshot";

describe("parseOneshotArgs", () => {
  it("requires --prompt for new oneshots", () => {
    expect(() => parseOneshotArgs(["feature/search"])).toThrow("oneshot requires --prompt");
  });

  it("defaults to --close-on-merge for new oneshots", () => {
    const parsed = parseOneshotArgs(["feature/search", "--prompt", "Fix bug"]);
    expect(parsed?.onMergeAction).toBe("close");
    expect(parsed?.body.onMergeAction).toBe("close");
    expect(parsed?.body.branch).toBe("feature/search");
    expect(parsed?.body.prompt).toBe("Fix bug");
    expect(parsed?.resume).toBe(false);
  });

  it("supports --remove-on-merge", () => {
    const parsed = parseOneshotArgs(["feature/search", "--prompt", "Fix bug", "--remove-on-merge"]);
    expect(parsed?.onMergeAction).toBe("remove");
    expect(parsed?.body.onMergeAction).toBe("remove");
  });

  it("supports --keep-open (no on-merge action)", () => {
    const parsed = parseOneshotArgs(["feature/search", "--prompt", "Fix bug", "--keep-open"]);
    expect(parsed?.onMergeAction).toBeNull();
    expect(parsed?.body.onMergeAction).toBeUndefined();
    expect(parsed?.keepOpen).toBe(true);
  });

  it("rejects --keep-open with --close-on-merge", () => {
    expect(() => parseOneshotArgs(["feature/search", "--prompt", "Fix bug", "--keep-open", "--close-on-merge"]))
      .toThrow("Cannot use --keep-open with --close-on-merge or --remove-on-merge");
  });

  it("rejects conflicting close/remove flags", () => {
    expect(() => parseOneshotArgs(["feature/search", "--prompt", "Fix bug", "--close-on-merge", "--remove-on-merge"]))
      .toThrow("Conflicting on-merge options");
  });

  it("parses --resume without prompt", () => {
    const parsed = parseOneshotArgs(["--resume", "feature/search"]);
    expect(parsed?.resume).toBe(true);
    expect(parsed?.branch).toBe("feature/search");
    expect(parsed?.prompt).toBeNull();
    // No on-merge action defaulted on resume — it's already configured per-worktree.
    expect(parsed?.body.onMergeAction).toBeUndefined();
  });

  it("parses --resume with follow-up prompt", () => {
    const parsed = parseOneshotArgs(["--resume", "feature/search", "--prompt", "you're stuck, continue"]);
    expect(parsed?.resume).toBe(true);
    expect(parsed?.prompt).toBe("you're stuck, continue");
  });

  it("rejects --resume without a branch", () => {
    expect(() => parseOneshotArgs(["--resume="])).toThrow("--resume requires a branch name");
  });

  it("rejects positional branch combined with --resume of a different branch", () => {
    expect(() => parseOneshotArgs(["other", "--resume", "feature/search", "--prompt", "x"]))
      .toThrow("Cannot pass both a positional branch and --resume");
  });

  it("parses agent, base, profile, env overrides", () => {
    const parsed = parseOneshotArgs([
      "feature/search",
      "--prompt", "Fix bug",
      "--agent", "codex",
      "--base", "main",
      "--profile", "sandbox",
      "--env", "FOO=bar",
      "--env=BAZ=qux",
    ]);
    expect(parsed?.body.agent).toBe("codex");
    expect(parsed?.body.baseBranch).toBe("main");
    expect(parsed?.body.profile).toBe("sandbox");
    expect(parsed?.body.envOverrides).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("returns null for --help", () => {
    expect(parseOneshotArgs(["--help"])).toBeNull();
  });

  it("supports --post-to-linear with an issue id", () => {
    const parsed = parseOneshotArgs(["feature/search", "--prompt", "Fix", "--post-to-linear", "ENG-42"]);
    expect(parsed?.postToLinearTarget).toEqual({ kind: "issue", issueId: "ENG-42" });
  });

  it("supports --post-to-linear with a team key", () => {
    const parsed = parseOneshotArgs(["feature/search", "--prompt", "Fix", "--post-to-linear", "ENG"]);
    expect(parsed?.postToLinearTarget).toEqual({ kind: "team", teamKey: "ENG" });
  });

  it("rejects invalid --post-to-linear values", () => {
    expect(() => parseOneshotArgs(["feature/search", "--prompt", "Fix", "--post-to-linear", "eng-1"]))
      .toThrow("Invalid Linear target");
  });

  it("supports --resume-from-linear without --prompt", () => {
    const parsed = parseOneshotArgs(["--resume-from-linear", "ENG-12"]);
    expect(parsed?.resumeFromLinearIssueId).toBe("ENG-12");
    expect(parsed?.resume).toBe(false);
  });

  it("rejects --resume-from-linear combined with --resume", () => {
    expect(() => parseOneshotArgs(["--resume", "feat/foo", "--resume-from-linear", "ENG-12"]))
      .toThrow("Cannot use --resume with --resume-from-linear");
  });

  it("rejects malformed --resume-from-linear values", () => {
    expect(() => parseOneshotArgs(["--resume-from-linear", "eng-99"]))
      .toThrow("--resume-from-linear expects an issue id like ENG-123");
  });

  it("accepts --branch as override alongside --resume-from-linear", () => {
    const parsed = parseOneshotArgs(["--resume-from-linear", "ENG-12", "--branch", "feat/override"]);
    expect(parsed?.branch).toBe("feat/override");
    expect(parsed?.resumeFromLinearIssueId).toBe("ENG-12");
  });

  it("rejects --branch with conflicting positional branch", () => {
    expect(() => parseOneshotArgs(["feat/positional", "--prompt", "Fix", "--branch", "feat/override"]))
      .toThrow("Conflicting branch values");
  });
});
