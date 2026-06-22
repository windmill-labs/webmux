import { describe, expect, it } from "bun:test";
import {
  allocateServicePorts,
  deriveProjectPrefix,
  sanitizeProjectPrefix,
} from "../domain/policies";

describe("allocateServicePorts", () => {
  it("allocates the first free slot across existing worktree metadata", () => {
    const ports = allocateServicePorts(
      [
        {
          schemaVersion: 1,
          worktreeId: "wt_1",
          branch: "feature/a",
          createdAt: "2026-03-06T00:00:00.000Z",
          profile: "default",
          agent: "claude",
          runtime: "host",
          startupEnvValues: {},
          allocatedPorts: { FRONTEND_PORT: 3010, PORT: 5111 },
        },
        {
          schemaVersion: 1,
          worktreeId: "wt_2",
          branch: "feature/b",
          createdAt: "2026-03-06T00:00:00.000Z",
          profile: "default",
          agent: "claude",
          runtime: "host",
          startupEnvValues: {},
          allocatedPorts: { FRONTEND_PORT: 3030, PORT: 5131 },
        },
      ],
      [
        { name: "frontend", portEnv: "FRONTEND_PORT", portStart: 3000, portStep: 10 },
        { name: "backend", portEnv: "PORT", portStart: 5101, portStep: 10 },
      ],
    );

    expect(ports).toEqual({
      FRONTEND_PORT: 3020,
      PORT: 5121,
    });
  });
});

describe("sanitizeProjectPrefix", () => {
  it("lowercases and replaces non-alphanumerics with hyphens", () => {
    expect(sanitizeProjectPrefix("My Project")).toBe("my-project");
    expect(sanitizeProjectPrefix("Some_Repo.v2")).toBe("some-repo-v2");
  });

  it("collapses runs of hyphens and trims edges", () => {
    expect(sanitizeProjectPrefix("--__foo bar__--")).toBe("foo-bar");
  });

  it("returns an empty string when nothing usable remains", () => {
    expect(sanitizeProjectPrefix("***")).toBe("");
  });
});

describe("deriveProjectPrefix", () => {
  it("returns the basename when no collision", () => {
    expect(deriveProjectPrefix("/home/me/projects/webmux", [])).toBe("webmux");
    expect(deriveProjectPrefix("/srv/widgets/", [])).toBe("widgets");
  });

  it("falls back to a default when the basename has no alphanumerics", () => {
    expect(deriveProjectPrefix("/repo/...", [])).toBe("webmux");
  });

  it("appends -2, -3, ... to avoid collisions", () => {
    expect(deriveProjectPrefix("/a/webmux", ["webmux"])).toBe("webmux-2");
    expect(deriveProjectPrefix("/a/webmux", ["webmux", "webmux-2"])).toBe("webmux-3");
  });

  it("sanitizes weird basenames", () => {
    expect(deriveProjectPrefix("/projects/My Cool App!", [])).toBe("my-cool-app");
  });

  it("never returns a reserved prefix even when the basename matches one", () => {
    expect(deriveProjectPrefix("/srv/api", [])).toBe("api-2");
    expect(deriveProjectPrefix("/srv/ws", [])).toBe("ws-2");
    expect(deriveProjectPrefix("/srv/assets", [])).toBe("assets-2");
  });
});
