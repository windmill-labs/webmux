import { describe, expect, it } from "bun:test";
import { parseLinearArgs, parseLinearTargetArg } from "./linear-commands";

describe("parseLinearTargetArg", () => {
  it("recognises issue ids", () => {
    expect(parseLinearTargetArg("ENG-42")).toEqual({ kind: "issue", issueId: "ENG-42" });
  });

  it("recognises team keys", () => {
    expect(parseLinearTargetArg("ENG")).toEqual({ kind: "team", teamKey: "ENG" });
  });

  it("throws on invalid input", () => {
    expect(() => parseLinearTargetArg("eng-1")).toThrow("Invalid Linear target");
    expect(() => parseLinearTargetArg("")).toThrow("Invalid Linear target");
  });
});

describe("parseLinearArgs", () => {
  it("returns null for help", () => {
    expect(parseLinearArgs([])).toBeNull();
    expect(parseLinearArgs(["--help"])).toBeNull();
  });

  it("parses post with issue id", () => {
    const parsed = parseLinearArgs(["post", "feat/foo", "ENG-42"]);
    expect(parsed?.subcommand).toBe("post");
    expect(parsed?.post.branch).toBe("feat/foo");
    expect(parsed?.post.target).toEqual({ kind: "issue", issueId: "ENG-42" });
  });

  it("parses post with team key and --title", () => {
    const parsed = parseLinearArgs(["post", "feat/foo", "ENG", "--title", "Investigate flaky test"]);
    expect(parsed?.post.target).toEqual({
      kind: "team",
      teamKey: "ENG",
      title: "Investigate flaky test",
    });
  });

  it("rejects unknown subcommand", () => {
    expect(() => parseLinearArgs(["pull", "ENG-1"])).toThrow("Unknown linear subcommand: pull");
  });

  it("requires branch + target", () => {
    expect(() => parseLinearArgs(["post"])).toThrow("requires a <branch>");
    expect(() => parseLinearArgs(["post", "feat/foo"])).toThrow("requires an <issue-or-team>");
  });
});
