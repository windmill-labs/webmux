import { describe, expect, it } from "bun:test";
import { allocatePorts } from "../env";
import type { ServiceConfig } from "../config";

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
