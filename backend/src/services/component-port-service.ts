import type { PortProbe } from "../adapters/port-probe";
import type { ComponentDefinition } from "../domain/components";
import type { WorktreeMeta } from "../domain/model";

export const COMPONENT_PORT_RANGE_START = 24_000;
export const COMPONENT_PORT_RANGE_END = 29_999;

function collectReservedPorts(existingMetas: WorktreeMeta[]): Set<number> {
  const ports = existingMetas.flatMap((meta) => [
    ...Object.values(meta.allocatedPorts),
    ...Object.values(meta.componentPorts ?? {}).flatMap((componentPorts) => Object.values(componentPorts)),
  ]);
  return new Set(ports.filter((port) => Number.isInteger(port) && port > 0));
}

export async function allocateComponentPorts(
  existingMetas: WorktreeMeta[],
  components: ComponentDefinition[],
  portProbe: PortProbe,
  range: { start: number; end: number } = {
    start: COMPONENT_PORT_RANGE_START,
    end: COMPONENT_PORT_RANGE_END,
  },
): Promise<Record<string, Record<string, number>>> {
  const reserved = collectReservedPorts(existingMetas);
  const result: Record<string, Record<string, number>> = {};
  let candidate = range.start;

  for (const component of components) {
    const ports: Record<string, number> = {};
    for (const portDefinition of component.ports) {
      while (
        candidate <= range.end
        && (reserved.has(candidate) || await portProbe.isListening(candidate))
      ) {
        candidate++;
      }
      if (candidate > range.end) {
        throw new Error(`No component ports available in range ${range.start}-${range.end}`);
      }
      ports[portDefinition.name] = candidate;
      reserved.add(candidate);
      candidate++;
    }
    result[component.id] = ports;
  }

  return result;
}
