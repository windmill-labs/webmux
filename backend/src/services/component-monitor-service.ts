import type { PortProbe } from "../adapters/port-probe";
import type { TmuxPaneSummary } from "../adapters/tmux";
import type { ComponentDefinition, ComponentRuntimeState } from "../domain/components";

interface ComponentMonitorInput {
  worktreeId: string;
  selectedComponentIds: string[];
  componentPorts: Record<string, Record<string, number>>;
  definitions: ComponentDefinition[];
  session: {
    exists: boolean;
    sessionName: string | null;
    windowName: string;
  };
  panes: TmuxPaneSummary[];
}

export interface ComponentMonitorOptions {
  readinessGraceMs?: number;
  now?: () => number;
}

export class ComponentMonitorService {
  private readonly readinessGraceMs: number;
  private readonly now: () => number;
  private readonly firstUnreadyAt = new Map<string, number>();
  private readonly previouslyReady = new Set<string>();

  constructor(
    private readonly portProbe: PortProbe,
    options: ComponentMonitorOptions = {},
  ) {
    this.readinessGraceMs = options.readinessGraceMs ?? 60_000;
    this.now = options.now ?? Date.now;
  }

  async buildStates(input: ComponentMonitorInput): Promise<ComponentRuntimeState[]> {
    const definitions = new Map(input.definitions.map((component) => [component.id, component]));
    return await Promise.all(input.selectedComponentIds.map(async (componentId): Promise<ComponentRuntimeState> => {
      const definition = definitions.get(componentId);
      const ports = { ...(input.componentPorts[componentId] ?? {}) };
      const urls = definition ? this.buildUrls(definition, ports) : {};
      const pane = input.panes.find((candidate) =>
        candidate.sessionName === input.session.sessionName
        && candidate.windowName === input.session.windowName
        && candidate.componentId === componentId
      );

      const base = {
        id: componentId,
        label: definition?.label ?? componentId,
        kind: definition?.kind ?? "unknown",
        paneIndex: pane?.paneIndex ?? null,
        ports,
        urls,
      };
      const key = `${input.worktreeId}:${componentId}`;

      if (!input.session.exists) {
        this.reset(key);
        return {
          ...base,
          processStatus: "stopped",
          healthStatus: "unavailable",
          exitCode: null,
        };
      }
      if (!pane || pane.dead) {
        this.reset(key);
        return {
          ...base,
          processStatus: "exited",
          healthStatus: "unavailable",
          exitCode: pane?.exitCode ?? null,
        };
      }

      const healthPorts = definition?.ports.filter((port) => port.health?.type === "tcp") ?? [];
      const ready = healthPorts.length === 0
        || (await Promise.all(
          healthPorts.map(async (port) => {
            const allocated = ports[port.name];
            return allocated !== undefined && await this.portProbe.isListening(allocated);
          }),
        )).every(Boolean);

      if (ready) {
        this.firstUnreadyAt.delete(key);
        this.previouslyReady.add(key);
        return {
          ...base,
          processStatus: "running",
          healthStatus: "ready",
          exitCode: null,
        };
      }

      const firstUnreadyAt = this.firstUnreadyAt.get(key) ?? this.now();
      this.firstUnreadyAt.set(key, firstUnreadyAt);
      const healthStatus = this.previouslyReady.has(key)
        || this.now() - firstUnreadyAt >= this.readinessGraceMs
        ? "unhealthy"
        : "starting";
      return {
        ...base,
        processStatus: "running",
        healthStatus,
        exitCode: null,
      };
    }));
  }

  private buildUrls(
    component: ComponentDefinition,
    ports: Record<string, number>,
  ): Record<string, string> {
    return Object.fromEntries(component.ports.flatMap((port) => {
      const allocated = ports[port.name];
      if (allocated === undefined || port.protocol === "tcp") return [];
      return [[port.name, `${port.protocol}://localhost:${allocated}`]];
    }));
  }

  private reset(key: string): void {
    this.firstUnreadyAt.delete(key);
    this.previouslyReady.delete(key);
  }
}
