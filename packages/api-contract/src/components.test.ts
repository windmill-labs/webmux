import { describe, expect, it } from "bun:test";
import {
  ComponentCatalogStateSchema,
  ComponentRuntimeStatusSchema,
  CreateWorktreeRequestSchema,
  ProjectWorktreeSnapshotSchema,
} from "./schemas";

describe("component API contracts", () => {
  it("accepts selected component ids on create", () => {
    expect(CreateWorktreeRequestSchema.parse({
      branch: "feature/catalog",
      components: ["service-alerts", "gateway-web"],
    }).components).toEqual(["service-alerts", "gateway-web"]);
  });

  it("validates catalog and runtime component status", () => {
    expect(ComponentCatalogStateSchema.parse({
      status: "ready",
      components: [{ id: "service-alerts", label: "Alerts", kind: "service" }],
      error: null,
    }).components).toHaveLength(1);

    expect(ComponentRuntimeStatusSchema.parse({
      id: "service-alerts",
      label: "Alerts",
      kind: "service",
      paneIndex: 1,
      processStatus: "running",
      healthStatus: "ready",
      ports: { http: 24_000 },
      urls: { http: "http://localhost:24000" },
      exitCode: null,
    }).healthStatus).toBe("ready");
  });

  it("defaults components for older worktree snapshots", () => {
    const snapshot = ProjectWorktreeSnapshotSchema.parse({
      branch: "feature/catalog",
      label: null,
      path: "/repo/worktree",
      dir: "/repo/worktree",
      archived: false,
      profile: "host",
      agentName: "claude",
      agentLabel: "Claude",
      agentTerminalStale: false,
      mux: true,
      dirty: false,
      unpushed: false,
      paneCount: 1,
      status: "running",
      elapsed: "1m",
      services: [],
      prs: [],
      linearIssue: null,
      creation: null,
      source: "ui",
      oneshot: null,
    });

    expect(snapshot.components).toEqual([]);
  });
});
