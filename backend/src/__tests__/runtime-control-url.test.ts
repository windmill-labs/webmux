import { describe, expect, it } from "bun:test";
import { buildControlBaseUrl } from "../runtime";

// Regression: the server mounts every project's routes under `/${prefix}`
// (see server.ts buildServeRoutes), so the control base URL that agent hooks
// POST to must carry the same prefix or the events fall through to the SPA and
// Claude's status never updates.
describe("buildControlBaseUrl", () => {
  it("includes the project prefix so it matches the prefixed server route", () => {
    expect(buildControlBaseUrl(5111, "webmux")).toBe("http://127.0.0.1:5111/webmux");
  });

  it("keeps an unprefixed URL for an empty prefix (legacy single-project edge)", () => {
    expect(buildControlBaseUrl(5111, "")).toBe("http://127.0.0.1:5111");
  });

  it("returns undefined when there is no prefix, disabling control reporting", () => {
    // The CLI passes undefined when it can't resolve a prefix (no server
    // running). No control URL is better than a wrong one: the agent's hooks
    // no-op cleanly instead of POSTing to an unrouted path.
    expect(buildControlBaseUrl(5111, undefined)).toBeUndefined();
  });
});
