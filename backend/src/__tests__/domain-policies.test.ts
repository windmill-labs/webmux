import { describe, expect, it } from "bun:test";
import {
  allocateServicePorts,
  deriveInstancePrefix,
  isValidInstancePrefix,
  sanitizeInstancePrefix,
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

describe("sanitizeInstancePrefix", () => {
  it("lowercases and replaces non-alphanumerics with hyphens", () => {
    expect(sanitizeInstancePrefix("My Project")).toBe("my-project");
    expect(sanitizeInstancePrefix("Some_Repo.v2")).toBe("some-repo-v2");
  });

  it("collapses runs of hyphens and trims edges", () => {
    expect(sanitizeInstancePrefix("--__foo bar__--")).toBe("foo-bar");
  });

  it("returns an empty string when nothing usable remains", () => {
    expect(sanitizeInstancePrefix("***")).toBe("");
  });
});

describe("isValidInstancePrefix", () => {
  it("accepts alphanumeric (any case) and hyphens", () => {
    expect(isValidInstancePrefix("webmux")).toBe(true);
    expect(isValidInstancePrefix("webmux-2")).toBe(true);
    expect(isValidInstancePrefix("ab12-cd")).toBe(true);
    expect(isValidInstancePrefix("Webmux")).toBe(true);
  });

  it("rejects leading hyphen, spaces, or empty", () => {
    expect(isValidInstancePrefix("-bad")).toBe(false);
    expect(isValidInstancePrefix("has space")).toBe(false);
    expect(isValidInstancePrefix("")).toBe(false);
  });

  it("rejects reserved path segments owned by the route map", () => {
    expect(isValidInstancePrefix("api")).toBe(false);
    expect(isValidInstancePrefix("ws")).toBe(false);
    expect(isValidInstancePrefix("assets")).toBe(false);
  });
});

describe("deriveInstancePrefix", () => {
  it("returns the basename when no collision", () => {
    expect(deriveInstancePrefix("/home/me/projects/webmux", [])).toBe("webmux");
    expect(deriveInstancePrefix("/srv/widgets/", [])).toBe("widgets");
  });

  it("falls back to a default when the basename has no alphanumerics", () => {
    expect(deriveInstancePrefix("/repo/...", [])).toBe("webmux");
  });

  it("appends -2, -3, ... to avoid collisions", () => {
    expect(deriveInstancePrefix("/a/webmux", ["webmux"])).toBe("webmux-2");
    expect(deriveInstancePrefix("/a/webmux", ["webmux", "webmux-2"])).toBe("webmux-3");
  });

  it("sanitizes weird basenames", () => {
    expect(deriveInstancePrefix("/projects/My Cool App!", [])).toBe("my-cool-app");
  });

  it("never returns a reserved prefix even when the basename matches one", () => {
    expect(deriveInstancePrefix("/srv/api", [])).toBe("api-2");
    expect(deriveInstancePrefix("/srv/ws", [])).toBe("ws-2");
    expect(deriveInstancePrefix("/srv/assets", [])).toBe("assets-2");
  });
});
