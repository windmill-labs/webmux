import { describe, expect, it } from "bun:test";
import { parseProjectArgs } from "./project-commands";
import { CommandUsageError } from "./shared";

describe("parseProjectArgs", () => {
  it("returns null (help) for no args or --help", () => {
    expect(parseProjectArgs([])).toBeNull();
    expect(parseProjectArgs(["--help"])).toBeNull();
    expect(parseProjectArgs(["-h"])).toBeNull();
  });

  it("parses ls / list", () => {
    expect(parseProjectArgs(["ls"])).toEqual({ subcommand: "ls" });
    expect(parseProjectArgs(["list"])).toEqual({ subcommand: "ls" });
  });

  it("rejects extra args to ls", () => {
    expect(() => parseProjectArgs(["ls", "extra"])).toThrow(CommandUsageError);
  });

  it("parses add with a path and defaults to the current dir", () => {
    expect(parseProjectArgs(["add", "/code/foo"])).toEqual({ subcommand: "add", path: "/code/foo" });
    expect(parseProjectArgs(["add"])).toEqual({ subcommand: "add", path: "." });
  });

  it("rejects extra args to add", () => {
    expect(() => parseProjectArgs(["add", "/a", "/b"])).toThrow(CommandUsageError);
  });

  it("parses rm / remove with a prefix", () => {
    expect(parseProjectArgs(["rm", "my-service"])).toEqual({ subcommand: "rm", prefix: "my-service" });
    expect(parseProjectArgs(["remove", "my-service"])).toEqual({ subcommand: "rm", prefix: "my-service" });
  });

  it("requires a prefix for rm", () => {
    expect(() => parseProjectArgs(["rm"])).toThrow(CommandUsageError);
  });

  it("parses migrate", () => {
    expect(parseProjectArgs(["migrate"])).toEqual({ subcommand: "migrate" });
  });

  it("rejects extra args to migrate", () => {
    expect(() => parseProjectArgs(["migrate", "extra"])).toThrow(CommandUsageError);
  });

  it("rejects unknown subcommands", () => {
    expect(() => parseProjectArgs(["frobnicate"])).toThrow(CommandUsageError);
  });
});
