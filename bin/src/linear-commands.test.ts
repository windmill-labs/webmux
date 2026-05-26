import { describe, expect, it } from "bun:test";
import { parseLinearArgs, parseLinearTargetArg } from "./linear-commands";

describe("parseLinearTargetArg", () => {
  it("recognises team keys", () => {
    expect(parseLinearTargetArg("ENG")).toEqual({ kind: "team", teamKey: "ENG" });
  });

  it("rejects issue ids with a helpful pointer to --linear", () => {
    expect(() => parseLinearTargetArg("ENG-42")).toThrow("--linear ENG-42");
  });

  it("throws on invalid input", () => {
    expect(() => parseLinearTargetArg("eng-1")).toThrow("Invalid Linear team key");
    expect(() => parseLinearTargetArg("")).toThrow("Invalid Linear team key");
  });
});

describe("parseLinearArgs", () => {
  it("returns null for help", () => {
    expect(parseLinearArgs([])).toBeNull();
    expect(parseLinearArgs(["--help"])).toBeNull();
  });

  it("rejects post with an issue id (use --linear instead)", () => {
    expect(() => parseLinearArgs(["post", "feat/foo", "ENG-42"])).toThrow("--linear ENG-42");
  });

  it("parses post with team key", () => {
    const parsed = parseLinearArgs(["post", "feat/foo", "ENG"]);
    expect(parsed?.subcommand).toBe("post");
    expect(parsed?.post.branch).toBe("feat/foo");
    expect(parsed?.post.target).toEqual({ kind: "team", teamKey: "ENG" });
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

  it("requires branch + team key", () => {
    expect(() => parseLinearArgs(["post"])).toThrow("requires a <branch>");
    expect(() => parseLinearArgs(["post", "feat/foo"])).toThrow("requires a <team-key>");
  });
});
