import { describe, expect, it } from "bun:test";
import {
  switchMultiplexer,
  type MultiplexerSwitchDependencies,
} from "../services/multiplexer-switch-service";

interface Recorder {
  log: string[];
  deps: MultiplexerSwitchDependencies;
}

function makeDeps(overrides: Partial<MultiplexerSwitchDependencies> & { open?: string[] } = {}): Recorder {
  const log: string[] = [];
  const open = overrides.open ?? ["alpha", "beta"];

  const deps: MultiplexerSwitchDependencies = {
    listOpenBranches: overrides.listOpenBranches ?? (async () => open),
    closeWorktree: overrides.closeWorktree ?? (async (branch) => { log.push(`close:${branch}`); }),
    persistMultiplexer: overrides.persistMultiplexer ?? (async (kind) => { log.push(`persist:${kind}`); }),
    openWorktree: overrides.openWorktree ?? (async (branch) => { log.push(`open:${branch}`); }),
    ...(overrides.onProgress ? { onProgress: overrides.onProgress } : {}),
  };

  return { log, deps };
}

describe("switchMultiplexer", () => {
  it("is a no-op when the target is already active", async () => {
    const { log, deps } = makeDeps();

    const result = await switchMultiplexer("tmux", "tmux", deps);

    expect(result).toEqual({ ok: true, changed: false, multiplexer: "tmux" });
    expect(log).toEqual([]);
  });

  it("closes every open worktree, flips the config, then reopens them", async () => {
    const { log, deps } = makeDeps();

    const result = await switchMultiplexer("tmux", "herdr", deps);

    expect(result).toMatchObject({
      ok: true,
      changed: true,
      from: "tmux",
      to: "herdr",
      closed: ["alpha", "beta"],
      restored: ["alpha", "beta"],
      failures: [],
    });
    expect(log).toEqual([
      "close:alpha",
      "close:beta",
      "persist:herdr",
      "open:alpha",
      "open:beta",
    ]);
  });

  it("closes everything BEFORE persisting, so no window is stranded on the old multiplexer", async () => {
    const { log, deps } = makeDeps();

    await switchMultiplexer("tmux", "herdr", deps);

    // every close must precede the persist — after it, the old gateway is unreachable
    expect(log.indexOf("persist:herdr")).toBeGreaterThan(log.lastIndexOf("close:beta"));
    expect(log.indexOf("persist:herdr")).toBeLessThan(log.indexOf("open:alpha"));
  });

  it("aborts without touching the config when a close fails", async () => {
    const { log, deps } = makeDeps({
      closeWorktree: async (branch) => {
        log.push(`close:${branch}`);
        if (branch === "beta") throw new Error("tmux window busy");
      },
    });

    const result = await switchMultiplexer("tmux", "herdr", deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("left the project on tmux");
      expect(result.failures).toEqual([
        { branch: "beta", stage: "close", message: "tmux window busy" },
      ]);
    }
    // critically: no persist, and no reopen on the new backend
    expect(log.some((entry) => entry.startsWith("persist:"))).toBe(false);
    expect(log.some((entry) => entry.startsWith("open:"))).toBe(false);
  });

  it("reports restore failures without failing the switch", async () => {
    const { deps } = makeDeps({
      openWorktree: async (branch) => {
        if (branch === "beta") throw new Error("herdr server gone");
      },
    });

    const result = await switchMultiplexer("tmux", "herdr", deps);

    expect(result).toMatchObject({
      ok: true,
      changed: true,
      closed: ["alpha", "beta"],
      restored: ["alpha"],
      failures: [{ branch: "beta", stage: "restore", message: "herdr server gone" }],
    });
  });

  it("still flips the config when nothing is open", async () => {
    const { log, deps } = makeDeps({ open: [] });

    const result = await switchMultiplexer("herdr", "tmux", deps);

    expect(result).toMatchObject({ ok: true, changed: true, closed: [], restored: [] });
    expect(log).toEqual(["persist:tmux"]);
  });

  it("does not touch the config when the open set cannot be read", async () => {
    const { log, deps } = makeDeps({
      listOpenBranches: async () => { throw new Error("socket refused"); },
    });

    const result = await switchMultiplexer("tmux", "herdr", deps);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("socket refused");
    expect(log).toEqual([]);
  });

  it("emits progress for each stage", async () => {
    const seen: string[] = [];
    const { deps } = makeDeps({
      onProgress: (p) => seen.push(p.branch ? `${p.stage}:${p.branch}` : p.stage),
    });

    await switchMultiplexer("tmux", "herdr", deps);

    expect(seen).toEqual([
      "close:alpha",
      "close:beta",
      "persist",
      "restore:alpha",
      "restore:beta",
    ]);
  });
});
