import { describe, expect, it } from "bun:test";
import type { PortProbe } from "../adapters/port-probe";
import type { ComponentDefinition } from "../domain/components";
import type { WorktreeMeta } from "../domain/model";
import { allocateComponentPorts } from "../services/component-port-service";

const components: ComponentDefinition[] = [
  {
    id: "service-alerts",
    label: "Alerts",
    kind: "service",
    workingDir: "services/service-alerts",
    command: "yarn dev",
    environment: {},
    ports: [{ name: "http", processEnv: "PORT", protocol: "http", health: { type: "tcp" } }],
  },
  {
    id: "gateway-web",
    label: "Gateway",
    kind: "gateway",
    workingDir: "services/gateway-web",
    command: "yarn dev",
    environment: {},
    ports: [{ name: "http", processEnv: "PORT", protocol: "http", health: { type: "tcp" } }],
  },
];

function meta(componentPorts: Record<string, Record<string, number>>): WorktreeMeta {
  return {
    schemaVersion: 1,
    worktreeId: "worktree-1",
    branch: "feature",
    createdAt: "2026-01-01T00:00:00.000Z",
    profile: "default",
    agent: "codex",
    runtime: "host",
    startupEnvValues: {},
    allocatedPorts: {},
    selectedComponents: Object.keys(componentPorts),
    componentPorts,
  };
}

describe("allocateComponentPorts", () => {
  it("skips persisted and listening ports", async () => {
    const listening = new Set([24_001]);
    const portProbe: PortProbe = {
      isListening: async (port) => listening.has(port),
    };

    const result = await allocateComponentPorts(
      [meta({ existing: { http: 24_000 } })],
      components,
      portProbe,
      { start: 24_000, end: 24_010 },
    );

    expect(result).toEqual({
      "service-alerts": { http: 24_002 },
      "gateway-web": { http: 24_003 },
    });
  });

  it("fails when the configured range is exhausted", async () => {
    const portProbe: PortProbe = { isListening: async () => false };
    expect(allocateComponentPorts([], components, portProbe, { start: 24_000, end: 24_000 }))
      .rejects.toThrow("No component ports available");
  });
});
