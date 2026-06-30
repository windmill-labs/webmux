import { describe, expect, it } from "bun:test";
import type { ProjectInitState } from "@webmux/api-contract";
import { awaitProjectSetup, parseProjectArgs } from "./project-commands";
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

function initState(over: Partial<ProjectInitState>): ProjectInitState {
  return { path: "/repo/a", phase: "creating_config", prefix: null, name: null, error: null, ...over };
}

describe("awaitProjectSetup", () => {
  it("logs each phase once and resolves with the ready state", async () => {
    const logs: string[] = [];
    const frames: ProjectInitState[][] = [
      [initState({ phase: "creating_config" })],
      [initState({ phase: "creating_config" })], // unchanged → not logged again
      [initState({ phase: "analyzing" })],
      [initState({ phase: "ready", prefix: "a", name: "A" })],
    ];
    let i = 0;

    const ready = await awaitProjectSetup("/repo/a", {
      poll: async () => frames[Math.min(i++, frames.length - 1)],
      sleep: async () => {},
      log: (m) => logs.push(m),
    });

    expect(ready).toMatchObject({ phase: "ready", prefix: "a", name: "A" });
    expect(logs).toEqual([
      "  Creating .webmux.yaml…",
      "  Analyzing project structure…",
    ]);
  });

  it("throws with the server error when setup fails", async () => {
    await expect(
      awaitProjectSetup("/repo/a", {
        poll: async () => [initState({ phase: "failed", error: "no git" })],
        sleep: async () => {},
        log: () => {},
      }),
    ).rejects.toThrow("no git");
  });

  it("throws on timeout when the job never appears", async () => {
    let clock = 0;
    await expect(
      awaitProjectSetup("/repo/a", {
        poll: async () => [],
        sleep: async () => { clock += 1000; },
        now: () => clock,
        timeoutMs: 1500,
        log: () => {},
      }),
    ).rejects.toThrow("timed out");
  });
});
