import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProjectsRegistry } from "../adapters/projects-registry";
import type { ProjectEntry } from "../domain/projects";

describe("projects-registry", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function freshRegistry(): Promise<{ file: string; registry: ReturnType<typeof createProjectsRegistry> }> {
    const dir = await mkdtemp(join(tmpdir(), "webmux-projects-registry-"));
    tempDirs.push(dir);
    const file = join(dir, "projects.json");
    return { file, registry: createProjectsRegistry(file) };
  }

  function makeEntry(overrides: Partial<ProjectEntry> = {}): ProjectEntry {
    return { path: "/repo/demo", name: "Demo", addedAt: 1, ...overrides };
  }

  it("adds, lists, and removes an entry", async () => {
    const { registry } = await freshRegistry();
    const entry = makeEntry();

    registry.add(entry);
    expect(registry.list()).toEqual([entry]);

    registry.remove(entry.path);
    expect(registry.list()).toEqual([]);
  });

  it("returns an empty list when the file does not exist", async () => {
    const { registry } = await freshRegistry();
    expect(registry.list()).toEqual([]);
  });

  it("preserves insertion order across multiple adds", async () => {
    const { registry } = await freshRegistry();
    registry.add(makeEntry({ path: "/a", name: "A" }));
    registry.add(makeEntry({ path: "/b", name: "B" }));
    expect(registry.list().map((e) => e.path)).toEqual(["/a", "/b"]);
  });

  it("upserts by path, replacing the existing entry in place", async () => {
    const { registry } = await freshRegistry();
    registry.add(makeEntry({ path: "/a", name: "Old" }));
    registry.add(makeEntry({ path: "/b", name: "B" }));
    registry.add(makeEntry({ path: "/a", name: "New" }));

    const entries = registry.list();
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.name)).toEqual(["B", "New"]);
  });

  it("ignores a malformed (non-JSON) file", async () => {
    const { file, registry } = await freshRegistry();
    writeFileSync(file, "not json");
    expect(registry.list()).toEqual([]);
  });

  it("ignores a non-array payload and malformed entries", async () => {
    const { file, registry } = await freshRegistry();
    writeFileSync(file, JSON.stringify({ not: "an array" }));
    expect(registry.list()).toEqual([]);

    writeFileSync(file, JSON.stringify([
      makeEntry({ path: "/good" }),
      { path: 123, name: "bad", addedAt: 1 },
      { path: "/missing-name", addedAt: 1 },
    ]));
    expect(registry.list().map((e) => e.path)).toEqual(["/good"]);
  });

  it("remove is a no-op for an unknown path", async () => {
    const { registry } = await freshRegistry();
    registry.add(makeEntry({ path: "/a" }));
    registry.remove("/does-not-exist");
    expect(registry.list().map((e) => e.path)).toEqual(["/a"]);
  });
});
