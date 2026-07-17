import { describe, expect, it } from "bun:test";
import type { ProjectsRegistry } from "../adapters/projects-registry";
import type { ProjectEntry } from "../domain/projects";
import {
  ProjectManager,
  type ManagedProject,
  type ProjectLoopController,
} from "../services/project-manager";

interface FakeRuntime {
  config: { name: string };
}

function fakeRegistry(initial: ProjectEntry[] = []): ProjectsRegistry & { entries: ProjectEntry[] } {
  const entries = [...initial];
  return {
    entries,
    list: (): ProjectEntry[] => [...entries],
    add(entry: ProjectEntry): void {
      const i = entries.findIndex((e) => e.path === entry.path);
      if (i >= 0) entries[i] = entry;
      else entries.push(entry);
    },
    remove(path: string): void {
      const i = entries.findIndex((e) => e.path === path);
      if (i >= 0) entries.splice(i, 1);
    },
  };
}

function makeManager(initial: ProjectEntry[] = []): {
  manager: ProjectManager<FakeRuntime>;
  registry: ProjectsRegistry & { entries: ProjectEntry[] };
  loopCalls: Map<string, string[]>;
  createdFor: string[];
  createdWith: Array<{ projectDir: string; port: number; prefix: string }>;
} {
  const registry = fakeRegistry(initial);
  const loopCalls = new Map<string, string[]>();
  const createdFor: string[] = [];
  const createdWith: Array<{ projectDir: string; port: number; prefix: string }> = [];
  const manager = new ProjectManager<FakeRuntime>({
    registry,
    port: 5111,
    resolveRoot: (path) => path,
    createRuntime: ({ projectDir, port, prefix }) => {
      createdFor.push(projectDir);
      createdWith.push({ projectDir, port, prefix });
      return { config: { name: `name:${projectDir}` } };
    },
    createLoops: (project: ManagedProject<FakeRuntime>): ProjectLoopController => {
      const calls: string[] = [];
      loopCalls.set(project.prefix, calls);
      return {
        startLight: (): number => calls.push("startLight"),
        stopLight: (): number => calls.push("stopLight"),
        startHeavy: (): number => calls.push("startHeavy"),
        stopHeavy: (): number => calls.push("stopHeavy"),
      };
    },
  });
  return { manager, registry, loopCalls, createdFor, createdWith };
}

describe("ProjectManager", () => {
  it("adds a project: derives prefix, labels from config, starts light loops, persists", () => {
    const { manager, registry, loopCalls } = makeManager();

    const project = manager.add("/repo/alpha");

    expect(project.prefix).toBe("alpha");
    expect(project.entry).toMatchObject({ path: "/repo/alpha", name: "name:/repo/alpha" });
    expect(project.active).toBe(false);
    expect(manager.list()).toHaveLength(1);
    expect(registry.entries.map((e) => e.path)).toEqual(["/repo/alpha"]);
    expect(loopCalls.get("alpha")).toEqual(["startLight"]);
  });

  it("passes the derived prefix to createRuntime so the runtime can build a prefixed control URL", () => {
    const { manager, createdWith } = makeManager();

    manager.add("/repo/alpha");
    manager.add("/repo/alpha-clone/alpha");

    expect(createdWith).toEqual([
      { projectDir: "/repo/alpha", port: 5111, prefix: "alpha" },
      { projectDir: "/repo/alpha-clone/alpha", port: 5111, prefix: "alpha-2" },
    ]);
  });

  it("addEphemeral serves the project in-memory but does not persist it", () => {
    const { manager, registry, loopCalls } = makeManager();

    const project = manager.addEphemeral("/repo/alpha");

    expect(project.prefix).toBe("alpha");
    expect(manager.list()).toHaveLength(1);
    expect(manager.getByPrefix("alpha")).toBe(project);
    expect(loopCalls.get("alpha")).toEqual(["startLight"]);
    // The whole point: nothing is written to the shared registry, so other
    // running servers won't reload (and double-serve) this repo on restart.
    expect(registry.entries).toEqual([]);
  });

  it("addEphemeral returns an already-persisted project without dropping its persistence", () => {
    const { manager, registry } = makeManager();

    const persisted = manager.add("/repo/alpha");
    const ephemeral = manager.addEphemeral("/repo/alpha");

    expect(ephemeral).toBe(persisted);
    expect(manager.list()).toHaveLength(1);
    expect(registry.entries.map((e) => e.path)).toEqual(["/repo/alpha"]);
  });

  it("returns the existing project (no duplicate runtime/entry) when adding the same path twice", () => {
    const { manager, registry, createdFor } = makeManager();

    const first = manager.add("/repo/alpha");
    const second = manager.add("/repo/alpha");

    expect(second).toBe(first);
    expect(manager.list()).toHaveLength(1);
    expect(registry.entries).toHaveLength(1);
    expect(createdFor).toEqual(["/repo/alpha"]);
  });

  it("disambiguates prefixes when two projects share a basename", () => {
    const { manager } = makeManager();

    const a = manager.add("/x/alpha");
    const b = manager.add("/y/alpha");

    expect(a.prefix).toBe("alpha");
    expect(b.prefix).toBe("alpha-2");
  });

  it("looks projects up by prefix and by path", () => {
    const { manager } = makeManager();
    const project = manager.add("/repo/alpha");

    expect(manager.getByPrefix("alpha")).toBe(project);
    expect(manager.getByPath("/repo/alpha")).toBe(project);
    expect(manager.getByPrefix("nope")).toBeNull();
    expect(manager.getByPath("/repo/none")).toBeNull();
  });

  it("removes a project: stops loops, drops it from the map and the registry", () => {
    const { manager, registry, loopCalls } = makeManager();
    manager.add("/repo/alpha");

    manager.remove("alpha");

    expect(manager.list()).toEqual([]);
    expect(registry.entries).toEqual([]);
    expect(loopCalls.get("alpha")).toEqual(["startLight", "stopHeavy", "stopLight"]);
  });

  it("remove is a no-op for an unknown prefix", () => {
    const { manager } = makeManager();
    expect(() => manager.remove("ghost")).not.toThrow();
  });

  it("setActive toggles heavy loops idempotently without touching light loops", () => {
    const { manager, loopCalls } = makeManager();
    const project = manager.add("/repo/alpha");

    manager.setActive("alpha", true);
    expect(project.active).toBe(true);
    manager.setActive("alpha", true); // idempotent — no second startHeavy
    manager.setActive("alpha", false);
    expect(project.active).toBe(false);
    manager.setActive("alpha", false); // idempotent — no second stopHeavy

    expect(loopCalls.get("alpha")).toEqual(["startLight", "startHeavy", "stopHeavy"]);
  });

  it("loadPersisted registers known projects without re-persisting and skips failures", () => {
    const initial: ProjectEntry[] = [
      { path: "/repo/alpha", name: "stale", addedAt: 1 },
      { path: "/repo/beta", name: "stale", addedAt: 2 },
    ];
    const registry = fakeRegistry(initial);
    const manager = new ProjectManager<FakeRuntime>({
      registry,
      port: 5111,
      resolveRoot: (path) => path,
      createRuntime: ({ projectDir }) => {
        if (projectDir === "/repo/beta") throw new Error("boom");
        return { config: { name: `name:${projectDir}` } };
      },
    });

    manager.loadPersisted();

    expect(manager.list().map((p) => p.entry.path)).toEqual(["/repo/alpha"]);
    // Names are re-derived from fresh config, not the stale persisted label.
    expect(manager.getByPrefix("alpha")?.entry.name).toBe("name:/repo/alpha");
    // persist=false: the registry file is left untouched (beta stays known).
    expect(registry.entries.map((e) => e.path)).toEqual(["/repo/alpha", "/repo/beta"]);
  });
});
