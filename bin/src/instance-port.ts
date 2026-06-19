import { createInstanceRegistry, type InstanceEntry } from "../../backend/src/adapters/instance-registry";
import { getGitRoot } from "./shared";

export type PortSource = "project" | "sole" | "default";

export interface ResolvedPort {
  port: number;
  source: PortSource;
}

export interface SelectInstancePortInput {
  defaultPort: number;
  /** Directories that identify the current project — typically `[cwd, gitRoot]`. */
  candidateDirs: string[];
  instances: InstanceEntry[];
}

function isInside(child: string, parent: string): boolean {
  const root = parent.endsWith("/") ? parent.slice(0, -1) : parent;
  return child === root || child.startsWith(`${root}/`);
}

/**
 * Pick the port of the live webmux instance that serves the current project.
 * Server-backed CLI commands (`oneshot`, `linear`, `send`) talk to a running
 * `webmux serve`, whose port is whatever it bound at startup — not necessarily
 * the 5111 default (it walks to a free port when 5111 is taken). Matching the
 * registry by project dir lets those commands find the right server instead of
 * blindly hitting 5111.
 *
 * Falls back to the sole live instance when nothing matches the project (the
 * common single-instance setup), then to `defaultPort`.
 */
export function selectInstancePort(input: SelectInstancePortInput): ResolvedPort {
  const match = input.instances.find((entry) =>
    input.candidateDirs.some((dir) => isInside(dir, entry.projectDir)),
  );
  if (match) return { port: match.port, source: "project" };
  if (input.instances.length === 1) return { port: input.instances[0]!.port, source: "sole" };
  return { port: input.defaultPort, source: "default" };
}

/** I/O wrapper: read the live registry + resolve the current project's git root,
 *  then delegate to the pure `selectInstancePort`. */
export function resolveLiveServerPort(opts: {
  defaultPort: number;
  cwd: string;
  registryDir?: string;
}): ResolvedPort {
  const instances = createInstanceRegistry(opts.registryDir).listLive();
  const gitRoot = getGitRoot();
  const candidateDirs = [opts.cwd, gitRoot].filter(
    (dir): dir is string => typeof dir === "string" && dir.length > 0,
  );
  return selectInstancePort({ defaultPort: opts.defaultPort, candidateDirs, instances });
}
