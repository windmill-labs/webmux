import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { createInstanceRegistry, type InstanceEntry } from "../adapters/instance-registry";

describe("instance-registry", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function freshRegistry(): Promise<{ dir: string; registry: ReturnType<typeof createInstanceRegistry> }> {
    const dir = await mkdtemp(join(tmpdir(), "webmux-instance-registry-"));
    tempDirs.push(dir);
    return { dir, registry: createInstanceRegistry(dir) };
  }

  function makeEntry(overrides: Partial<InstanceEntry> = {}): InstanceEntry {
    return {
      prefix: "demo",
      port: 5111,
      projectDir: "/repo/demo",
      pid: process.pid,
      startedAt: Date.now(),
      ...overrides,
    };
  }

  it("registers, lists, and deregisters an entry", async () => {
    const { registry } = await freshRegistry();
    const entry = makeEntry();

    registry.register(entry);
    expect(registry.listLive()).toEqual([entry]);

    registry.deregister(entry.port);
    expect(registry.listLive()).toEqual([]);
  });

  it("returns an empty list when the registry directory does not exist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "webmux-instance-registry-"));
    await rm(dir, { recursive: true, force: true });
    const registry = createInstanceRegistry(dir);
    expect(registry.listLive()).toEqual([]);
  });

  it("evicts entries whose PID is no longer alive", async () => {
    const { dir, registry } = await freshRegistry();
    const live = makeEntry({ port: 5111 });
    const dead = makeEntry({ port: 5112, pid: 1 << 30 });

    registry.register(live);
    registry.register(dead);

    const result = registry.listLive();
    expect(result.map((e) => e.port)).toEqual([live.port]);

    // The dead entry's file should be cleaned up on read.
    const remaining = createInstanceRegistry(dir).listLive();
    expect(remaining).toEqual([live]);
  });

  it("ignores malformed json files", async () => {
    const { dir, registry } = await freshRegistry();
    registry.register(makeEntry({ port: 5111 }));
    writeFileSync(join(dir, "5112.json"), "not json");
    writeFileSync(join(dir, "5113.json"), JSON.stringify({ prefix: 1 }));

    expect(registry.listLive().map((e) => e.port)).toEqual([5111]);
  });

  it("rejects entries whose prefix is not a valid instance prefix", async () => {
    const { dir, registry } = await freshRegistry();
    registry.register(makeEntry({ port: 5111, prefix: "good" }));
    // Forge an entry with a bad prefix (leading hyphen, reserved, etc.)
    writeFileSync(join(dir, "5112.json"), JSON.stringify({
      prefix: "-bad",
      port: 5112,
      projectDir: "/x",
      pid: process.pid,
      startedAt: 1,
    }));
    writeFileSync(join(dir, "5113.json"), JSON.stringify({
      prefix: "api",
      port: 5113,
      projectDir: "/x",
      pid: process.pid,
      startedAt: 1,
    }));

    expect(registry.listLive().map((e) => e.port)).toEqual([5111]);
  });

  it("deregister with a mismatched expectedPid leaves the entry alone", async () => {
    const { registry } = await freshRegistry();
    registry.register(makeEntry({ port: 5111, pid: process.pid }));
    registry.deregister(5111, 9999);
    expect(registry.listLive()).toHaveLength(1);
    registry.deregister(5111, process.pid);
    expect(registry.listLive()).toEqual([]);
  });

  it("deregister is a no-op when the file is missing", async () => {
    const { registry } = await freshRegistry();
    expect(() => registry.deregister(9999)).not.toThrow();
  });

  it("overwrites an existing entry when registering the same port twice", async () => {
    const { registry } = await freshRegistry();
    registry.register(makeEntry({ port: 5111, prefix: "alpha" }));
    registry.register(makeEntry({ port: 5111, prefix: "beta" }));

    const entries = registry.listLive();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.prefix).toBe("beta");
  });
});
