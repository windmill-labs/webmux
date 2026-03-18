import { describe, expect, it } from "bun:test";
import { mapWithConcurrency, startSerializedInterval } from "../lib/async";
import { parseReviewComments } from "../services/pr-service";

describe("parseReviewComments", () => {
  it("parses normal review comments", () => {
    const json = JSON.stringify([
      {
        body: "Looks good",
        path: "src/main.ts",
        line: 42,
        diff_hunk: "@@ -40,3 +40,5 @@\n code here",
        user: { login: "alice" },
        created_at: "2026-01-15T10:00:00Z",
      },
      {
        body: "Needs fix",
        path: "src/utils.ts",
        line: 10,
        diff_hunk: "@@ -8,3 +8,5 @@",
        user: { login: "bob" },
        created_at: "2026-01-16T12:00:00Z",
        in_reply_to_id: 123,
      },
    ]);

    const result = parseReviewComments(json);
    expect(result).toHaveLength(2);
    // Sorted by most recent first
    expect(result[0].type).toBe("inline");
    expect(result[0].author).toBe("bob");
    expect(result[0].path).toBe("src/utils.ts");
    expect(result[0].line).toBe(10);
    expect(result[0].isReply).toBe(true);
    expect(result[0].diffHunk).toBe("@@ -8,3 +8,5 @@");

    expect(result[1].type).toBe("inline");
    expect(result[1].author).toBe("alice");
    expect(result[1].line).toBe(42);
    expect(result[1].isReply).toBe(false);
    expect(result[1].diffHunk).toContain("code here");
  });

  it("returns empty array for empty input", () => {
    expect(parseReviewComments("[]")).toEqual([]);
  });

  it("handles missing/null fields gracefully", () => {
    const json = JSON.stringify([
      {
        body: null,
        path: null,
        line: null,
        diff_hunk: null,
        user: null,
        created_at: null,
      },
    ]);

    const result = parseReviewComments(json);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("inline");
    expect(result[0].author).toBe("unknown");
    expect(result[0].body).toBe("");
    expect(result[0].path).toBe("");
    expect(result[0].line).toBeNull();
    expect(result[0].diffHunk).toBe("");
    expect(result[0].isReply).toBe(false);
  });

  it("truncates to 50 comments", () => {
    const comments = Array.from({ length: 60 }, (_, i) => ({
      body: `comment ${i}`,
      path: "file.ts",
      line: i,
      diff_hunk: "",
      user: { login: "user" },
      created_at: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
    }));
    const result = parseReviewComments(JSON.stringify(comments));
    expect(result).toHaveLength(50);
  });
});

describe("mapWithConcurrency", () => {
  it("maps all items with results in order", async () => {
    const items = [1, 2, 3, 4, 5];
    const result = await mapWithConcurrency(items, 2, async (n) => n * 10);
    expect(result).toEqual([10, 20, 30, 40, 50]);
  });

  it("limits concurrency", async () => {
    let active = 0;
    let maxActive = 0;
    const items = [1, 2, 3, 4, 5, 6];
    await mapWithConcurrency(items, 3, async (n) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await Bun.sleep(10);
      active--;
      return n;
    });
    expect(maxActive).toBeLessThanOrEqual(3);
  });

  it("handles empty input", async () => {
    const result = await mapWithConcurrency([], 5, async (n: number) => n);
    expect(result).toEqual([]);
  });
});

describe("startSerializedInterval", () => {
  it("coalesces overlapping ticks into a single rerun", async () => {
    const ticks: Array<() => void> = [];
    const completions: Array<() => void> = [];
    let runs = 0;
    const stop = startSerializedInterval(
      async () => {
        runs += 1;
        await new Promise<void>((resolve) => {
          completions.push(resolve);
        });
      },
      1000,
      {
        scheduleEvery: (handler) => {
          ticks.push(handler);
          return ticks.length;
        },
        cancelSchedule: () => {},
      },
    );

    await Promise.resolve();
    expect(runs).toBe(1);

    ticks[0]!();
    ticks[0]!();
    expect(runs).toBe(1);

    completions.shift()?.();
    for (let i = 0; i < 10 && runs < 2; i += 1) {
      await Promise.resolve();
    }
    expect(runs).toBe(2);

    completions.shift()?.();
    await Promise.resolve();
    stop();
  });

  it("stops scheduling reruns after disposal", async () => {
    const ticks: Array<() => void> = [];
    const completions: Array<() => void> = [];
    let runs = 0;
    let cancelledHandle: number | null = null;
    const stop = startSerializedInterval(
      async () => {
        runs += 1;
        await new Promise<void>((resolve) => {
          completions.push(resolve);
        });
      },
      1000,
      {
        scheduleEvery: (handler) => {
          ticks.push(handler);
          return 42;
        },
        cancelSchedule: (handle) => {
          cancelledHandle = handle;
        },
      },
    );

    await Promise.resolve();
    expect(runs).toBe(1);
    ticks[0]!();
    stop();
    completions.shift()?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(cancelledHandle === 42).toBe(true);
    expect(runs).toBe(1);
  });
});
