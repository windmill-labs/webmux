import { describe, expect, test } from "bun:test";
import { selectInstancePort } from "./instance-port";
import type { InstanceEntry } from "../../backend/src/adapters/instance-registry";

function entry(overrides: Partial<InstanceEntry>): InstanceEntry {
  return {
    prefix: "windmill",
    port: 5112,
    projectDir: "/home/me/windmill",
    pid: 1012,
    startedAt: 1,
    ...overrides,
  };
}

describe("selectInstancePort", () => {
  test("matches the instance serving the current project root", () => {
    const result = selectInstancePort({
      defaultPort: 5111,
      candidateDirs: ["/home/me/windmill"],
      instances: [entry({ port: 5112 })],
    });
    expect(result).toEqual({ port: 5112, source: "project" });
  });

  test("matches when cwd is a subdirectory of the project", () => {
    const result = selectInstancePort({
      defaultPort: 5111,
      candidateDirs: ["/home/me/windmill/backend/src"],
      instances: [entry({ port: 5112, projectDir: "/home/me/windmill" })],
    });
    expect(result).toEqual({ port: 5112, source: "project" });
  });

  test("prefers the project match over other live instances", () => {
    const result = selectInstancePort({
      defaultPort: 5111,
      candidateDirs: ["/home/me/windmill"],
      instances: [
        entry({ port: 5113, projectDir: "/home/me/other" }),
        entry({ port: 5112, projectDir: "/home/me/windmill" }),
      ],
    });
    expect(result).toEqual({ port: 5112, source: "project" });
  });

  test("falls back to the sole live instance when none matches the project", () => {
    const result = selectInstancePort({
      defaultPort: 5111,
      candidateDirs: ["/home/me/windmill"],
      instances: [entry({ port: 5112, projectDir: "/home/me/other" })],
    });
    expect(result).toEqual({ port: 5112, source: "sole" });
  });

  test("falls back to default when nothing matches and multiple are live", () => {
    const result = selectInstancePort({
      defaultPort: 5111,
      candidateDirs: ["/home/me/windmill"],
      instances: [
        entry({ port: 5112, projectDir: "/home/me/a" }),
        entry({ port: 5113, projectDir: "/home/me/b" }),
      ],
    });
    expect(result).toEqual({ port: 5111, source: "default" });
  });

  test("falls back to default when no instances are live", () => {
    const result = selectInstancePort({
      defaultPort: 5111,
      candidateDirs: ["/home/me/windmill"],
      instances: [],
    });
    expect(result).toEqual({ port: 5111, source: "default" });
  });

  test("does not treat a sibling project with a shared prefix as inside", () => {
    const result = selectInstancePort({
      defaultPort: 5111,
      candidateDirs: ["/home/me/windmill-fork"],
      instances: [entry({ port: 5112, projectDir: "/home/me/windmill" })],
    });
    // No project match → sole-instance fallback, not a bogus "project" match.
    expect(result).toEqual({ port: 5112, source: "sole" });
  });
});
