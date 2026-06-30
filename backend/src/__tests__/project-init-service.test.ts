import { describe, expect, it } from "bun:test";
import {
  ProjectInitTracker,
  runProjectInit,
  type ProjectInitDeps,
} from "../services/project-init-service";

describe("ProjectInitTracker", () => {
  it("upserts phase transitions and carries prefix/name into ready", () => {
    const tracker = new ProjectInitTracker();
    tracker.set("/repo/a", { phase: "creating_config" });
    expect(tracker.isActive("/repo/a")).toBe(true);

    tracker.set("/repo/a", { phase: "analyzing" });
    tracker.set("/repo/a", { phase: "ready", prefix: "a", name: "A" });

    const state = tracker.get("/repo/a");
    expect(state).toMatchObject({ phase: "ready", prefix: "a", name: "A", error: null });
    expect(tracker.isActive("/repo/a")).toBe(false);
  });

  it("evicts terminal entries past the TTL but keeps in-flight ones", () => {
    let clock = 1000;
    const tracker = new ProjectInitTracker({ ttlMs: 100, now: () => clock });

    tracker.set("/repo/done", { phase: "ready", prefix: "done", name: "Done" });
    tracker.set("/repo/busy", { phase: "analyzing" });

    clock = 1050; // within TTL — both visible
    expect(tracker.list().map((s) => s.path).sort()).toEqual(["/repo/busy", "/repo/done"]);

    clock = 1200; // terminal entry now past TTL; in-flight stays
    expect(tracker.list().map((s) => s.path)).toEqual(["/repo/busy"]);
  });
});

function makeDeps(overrides: Partial<ProjectInitDeps> & { calls?: string[] } = {}): ProjectInitDeps {
  const calls = overrides.calls ?? [];
  return {
    analyzerAvailable: overrides.analyzerAvailable ?? ((): boolean => true),
    scaffold: overrides.scaffold ?? (async (): Promise<void> => { calls.push("scaffold"); }),
    analyze: overrides.analyze ?? (async (): Promise<void> => { calls.push("analyze"); }),
    register: overrides.register ?? ((): { prefix: string; name: string } => {
      calls.push("register");
      return { prefix: "a", name: "A" };
    }),
  };
}

describe("runProjectInit", () => {
  it("scaffolds, analyzes, registers, then marks ready (in order)", async () => {
    const calls: string[] = [];
    const tracker = new ProjectInitTracker();
    await runProjectInit(tracker, "/repo/a", makeDeps({ calls }));

    expect(calls).toEqual(["scaffold", "analyze", "register"]);
    expect(tracker.get("/repo/a")).toMatchObject({ phase: "ready", prefix: "a", name: "A" });
  });

  it("skips analysis when no analyzer is available but still registers", async () => {
    const calls: string[] = [];
    const tracker = new ProjectInitTracker();
    await runProjectInit(tracker, "/repo/a", makeDeps({ calls, analyzerAvailable: () => false }));

    expect(calls).toEqual(["scaffold", "register"]);
    expect(tracker.get("/repo/a")?.phase).toBe("ready");
  });

  it("registers anyway when analysis throws (best-effort enrichment)", async () => {
    const calls: string[] = [];
    const tracker = new ProjectInitTracker();
    await runProjectInit(tracker, "/repo/a", makeDeps({
      calls,
      analyze: async () => { throw new Error("claude blew up"); },
    }));

    expect(calls).toEqual(["scaffold", "register"]);
    expect(tracker.get("/repo/a")?.phase).toBe("ready");
  });

  it("marks failed and does not register when scaffold throws", async () => {
    const calls: string[] = [];
    const tracker = new ProjectInitTracker();
    await runProjectInit(tracker, "/repo/a", makeDeps({
      calls,
      scaffold: async () => { throw new Error("cannot write .webmux.yaml"); },
    }));

    expect(calls).toEqual([]);
    expect(tracker.get("/repo/a")).toMatchObject({ phase: "failed", error: "cannot write .webmux.yaml" });
  });
});
