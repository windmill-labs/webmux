import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { allocatePorts, readEnvLocal, writeEnvLocal } from "../env";
import type { ServiceConfig } from "../config";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SERVICES: ServiceConfig[] = [
  { name: "BE", portEnv: "BACKEND_PORT", portStart: 5111, portStep: 10 },
  { name: "FE", portEnv: "FRONTEND_PORT", portStart: 5112, portStep: 10 },
];

describe("allocatePorts", () => {
  it("returns index-1 ports when no existing worktrees", () => {
    const result = allocatePorts([], SERVICES);
    expect(result).toEqual({ BACKEND_PORT: "5121", FRONTEND_PORT: "5122" });
  });

  it("skips occupied indices", () => {
    const existing = [
      { BACKEND_PORT: "5121" }, // slot 1
      { BACKEND_PORT: "5131" }, // slot 2
    ];
    const result = allocatePorts(existing, SERVICES);
    expect(result).toEqual({ BACKEND_PORT: "5141", FRONTEND_PORT: "5142" });
  });

  it("fills gaps in occupied indices", () => {
    const existing = [
      { BACKEND_PORT: "5131" }, // slot 2 (gap at slot 1)
    ];
    const result = allocatePorts(existing, SERVICES);
    expect(result).toEqual({ BACKEND_PORT: "5121", FRONTEND_PORT: "5122" });
  });

  it("returns empty when no services have portStart", () => {
    const services: ServiceConfig[] = [
      { name: "BE", portEnv: "BACKEND_PORT" },
    ];
    const result = allocatePorts([], services);
    expect(result).toEqual({});
  });

  it("defaults portStep to 1 when not set", () => {
    const services: ServiceConfig[] = [
      { name: "BE", portEnv: "PORT", portStart: 3000 },
    ];
    const result = allocatePorts([], services);
    expect(result).toEqual({ PORT: "3001" });
  });

  it("ignores non-numeric port values in existing envs", () => {
    const existing = [
      { BACKEND_PORT: "auto" },
      { BACKEND_PORT: "not-a-number" },
    ];
    const result = allocatePorts(existing, SERVICES);
    expect(result).toEqual({ BACKEND_PORT: "5121", FRONTEND_PORT: "5122" });
  });

  it("ignores port values below portStart", () => {
    const existing = [
      { BACKEND_PORT: "80" },
    ];
    const result = allocatePorts(existing, SERVICES);
    expect(result).toEqual({ BACKEND_PORT: "5121", FRONTEND_PORT: "5122" });
  });

  it("ignores port values not aligned to portStep", () => {
    const existing = [
      { BACKEND_PORT: "5115" }, // not aligned to step 10 from 5111
    ];
    const result = allocatePorts(existing, SERVICES);
    expect(result).toEqual({ BACKEND_PORT: "5121", FRONTEND_PORT: "5122" });
  });

  it("does not assign slot 0 (reserved for main)", () => {
    // Slot 0 = portStart itself (5111). Even if no existing worktrees have it,
    // allocation should start from slot 1.
    const result = allocatePorts([], SERVICES);
    expect(Number(result.BACKEND_PORT)).toBeGreaterThan(5111);
    expect(Number(result.FRONTEND_PORT)).toBeGreaterThan(5112);
  });
});

describe("writeEnvLocal / readEnvLocal round-trip", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "env-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("round-trips simple values without quotes", async () => {
    await writeEnvLocal(dir, { PORT: "3000", NAME: "hello" });
    const raw = await Bun.file(join(dir, ".env.local")).text();
    expect(raw).toBe("PORT=3000\nNAME=hello\n");

    const env = await readEnvLocal(dir);
    expect(env).toEqual({ PORT: "3000", NAME: "hello" });
  });

  it("single-quotes JSON values on disk and strips quotes on read", async () => {
    const json = JSON.stringify([{ repo: "foo/bar", number: 42, state: "open" }]);
    await writeEnvLocal(dir, { PR_DATA: json });

    const raw = await Bun.file(join(dir, ".env.local")).text();
    expect(raw).toBe(`PR_DATA='${json}'\n`);

    const env = await readEnvLocal(dir);
    expect(env.PR_DATA).toBe(json);
    expect(JSON.parse(env.PR_DATA)).toEqual([{ repo: "foo/bar", number: 42, state: "open" }]);
  });

  it("quoted .env.local is safe to source in bash", async () => {
    const json = JSON.stringify([{ repo: "org/repo", base: "origin/main" }]);
    await writeEnvLocal(dir, { PR_DATA: json, PORT: "3000" });

    const proc = Bun.spawn(["bash", "-c", `source "${dir}/.env.local" && echo "$PR_DATA"`], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    await proc.exited;

    expect(proc.exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe(json);
  });

  it("upserts existing keys preserving quoting", async () => {
    await writeEnvLocal(dir, { PORT: "3000", PR_DATA: '{"old":true}' });
    await writeEnvLocal(dir, { PR_DATA: '{"new":true}' });

    const raw = await Bun.file(join(dir, ".env.local")).text();
    expect(raw).toBe("PORT=3000\nPR_DATA='{\"new\":true}'\n");

    const env = await readEnvLocal(dir);
    expect(env.PORT).toBe("3000");
    expect(env.PR_DATA).toBe('{"new":true}');
  });
});
