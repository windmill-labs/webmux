import { describe, expect, it } from "bun:test";
import { parseOneshotArgs } from "./oneshot";

describe("parseOneshotArgs", () => {
  it("requires --prompt for new oneshots", () => {
    expect(() => parseOneshotArgs(["feature/search"])).toThrow("oneshot requires --prompt");
  });

  it("parses positional branch and prompt", () => {
    const parsed = parseOneshotArgs(["feature/search", "--prompt", "Fix bug"]);
    expect(parsed?.body.branch).toBe("feature/search");
    expect(parsed?.body.prompt).toBe("Fix bug");
    expect(parsed?.resume).toBe(false);
  });

  it("parses --keep-open", () => {
    const parsed = parseOneshotArgs(["feature/search", "--prompt", "Fix bug", "--keep-open"]);
    expect(parsed?.keepOpen).toBe(true);
  });

  it("rejects --resume without --prompt", () => {
    expect(() => parseOneshotArgs(["--resume", "feature/search"]))
      .toThrow("--resume requires --prompt");
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

  it("--linear with an issue id sets both seed and post target (round-trip)", () => {
    const parsed = parseOneshotArgs(["--linear", "ENG-42"]);
    expect(parsed?.fromLinearIssueId).toBe("ENG-42");
    expect(parsed?.postToLinearTarget).toEqual({ kind: "issue", issueId: "ENG-42" });
    expect(parsed?.resume).toBe(false);
  });

  it("--linear with a team key sets only the post target", () => {
    const parsed = parseOneshotArgs(["feature/search", "--prompt", "Fix", "--linear", "ENG"]);
    expect(parsed?.fromLinearIssueId).toBeNull();
    expect(parsed?.postToLinearTarget).toEqual({ kind: "team", teamKey: "ENG" });
  });

  it("rejects invalid --linear values", () => {
    expect(() => parseOneshotArgs(["feature/search", "--prompt", "Fix", "--linear", "eng-1"]))
      .toThrow("--linear expects either an issue id");
    expect(() => parseOneshotArgs(["feature/search", "--prompt", "Fix", "--linear", ""]))
      .toThrow("--linear expects either an issue id");
  });

  it("rejects --linear combined with --resume", () => {
    expect(() => parseOneshotArgs(["--resume", "feat/foo", "--linear", "ENG-12"]))
      .toThrow("Cannot use --resume with --linear <issue-id>");
  });

  it("accepts --branch as override alongside --linear (issue id)", () => {
    const parsed = parseOneshotArgs(["--linear", "ENG-12", "--branch", "feat/override"]);
    expect(parsed?.branch).toBe("feat/override");
    expect(parsed?.fromLinearIssueId).toBe("ENG-12");
  });

  it("rejects --branch with conflicting positional branch", () => {
    expect(() => parseOneshotArgs(["feat/positional", "--prompt", "Fix", "--branch", "feat/override"]))
      .toThrow("Conflicting branch values");
  });

  it("rejects --branch without --linear", () => {
    expect(() => parseOneshotArgs(["--prompt", "Fix", "--branch", "feat/override"]))
      .toThrow("--branch only applies with --linear");
  });

  it("rejects --branch with --resume with a precise message", () => {
    expect(() => parseOneshotArgs(["--resume", "feat/foo", "--branch", "feat/bar"]))
      .toThrow("Cannot use --branch with --resume");
  });
});
