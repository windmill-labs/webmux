import { describe, expect, it } from "bun:test";
import { NotificationIdParamsSchema, RunIdParamsSchema, WorktreeNameParamsSchema } from "@webmux/api-contract";
import { z } from "zod";
import { parseParams } from "../api-validation";

describe("parseParams", () => {
  it("decodes encoded worktree names before validation", () => {
    const parsed = parseParams({ name: "feature%2Fsearch" }, WorktreeNameParamsSchema);

    expect(parsed).toEqual({
      ok: true,
      data: { name: "feature/search" },
    });
  });

  it("parses numeric route params through the shared contract schemas", () => {
    const notification = parseParams({ id: "42" }, NotificationIdParamsSchema);
    const run = parseParams({ runId: "317" }, RunIdParamsSchema);

    expect(notification).toEqual({
      ok: true,
      data: { id: 42 },
    });
    expect(run).toEqual({
      ok: true,
      data: { runId: 317 },
    });
  });

  it("returns a 400 response for malformed path encoding", async () => {
    const parsed = parseParams({ name: "%E0%A4%A" }, WorktreeNameParamsSchema);

    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error("Expected malformed path parameters to fail");

    expect(parsed.response.status).toBe(400);
    expect(await parsed.response.json()).toEqual({
      error: "Invalid path parameters: malformed encoding",
    });
  });

  it("mentions additional validation errors after the first one", async () => {
    const schema = z.object({
      first: z.string(),
      second: z.string(),
    });

    const parsed = parseParams({}, schema);

    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error("Expected validation to fail");

    expect(await parsed.response.json()).toEqual({
      error: "Invalid path parameters: first: Required (and 1 more error)",
    });
  });
});
