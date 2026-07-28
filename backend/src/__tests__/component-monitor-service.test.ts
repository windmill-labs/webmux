import { describe, expect, it } from "bun:test";
import type { PortProbe } from "../adapters/port-probe";
import type { TmuxPaneSummary } from "../adapters/tmux";
import type { ComponentDefinition } from "../domain/components";
import { ComponentMonitorService } from "../services/component-monitor-service";

const definition: ComponentDefinition = {
  id: "service-alerts",
  label: "Alerts",
  kind: "service",
  workingDir: "services/service-alerts",
  command: "yarn dev",
  environment: {},
  ports: [{ name: "http", processEnv: "PORT", protocol: "http", health: { type: "tcp" } }],
};

const pane: TmuxPaneSummary = {
  sessionName: "session",
  windowName: "window",
  paneId: "%2",
  paneIndex: 1,
  pid: 123,
  dead: false,
  exitCode: null,
  componentId: definition.id,
};

function input(panes: TmuxPaneSummary[] = [pane], exists = true) {
  return {
    worktreeId: "worktree-1",
    selectedComponentIds: [definition.id],
    componentPorts: { [definition.id]: { http: 24_000 } },
    definitions: [definition],
    session: { exists, sessionName: exists ? "session" : null, windowName: "window" },
    panes,
  };
}

describe("ComponentMonitorService", () => {
  it("moves from starting to ready and unhealthy", async () => {
    let now = 0;
    let listening = false;
    const portProbe: PortProbe = { isListening: async () => listening };
    const monitor = new ComponentMonitorService(portProbe, {
      readinessGraceMs: 100,
      now: () => now,
    });

    expect((await monitor.buildStates(input()))[0]?.healthStatus).toBe("starting");
    now = 101;
    expect((await monitor.buildStates(input()))[0]?.healthStatus).toBe("unhealthy");
    listening = true;
    expect((await monitor.buildStates(input()))[0]?.healthStatus).toBe("ready");
    listening = false;
    expect((await monitor.buildStates(input()))[0]?.healthStatus).toBe("unhealthy");
  });

  it("reports exited and stopped processes", async () => {
    const monitor = new ComponentMonitorService({ isListening: async () => false });
    const exited = await monitor.buildStates(input([{ ...pane, dead: true, exitCode: 2 }]));
    expect(exited[0]).toMatchObject({
      processStatus: "exited",
      healthStatus: "unavailable",
      exitCode: 2,
    });

    const stopped = await monitor.buildStates(input([], false));
    expect(stopped[0]).toMatchObject({
      processStatus: "stopped",
      healthStatus: "unavailable",
    });
  });
});
