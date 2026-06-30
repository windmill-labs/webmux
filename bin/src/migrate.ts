import { unlinkSync } from "node:fs";
import { createApi, type MigrateProjectsResponse } from "@webmux/api-contract";
import { createInstanceRegistry, type InstanceEntry } from "../../backend/src/adapters/instance-registry";
import { listInstalledServices, type InstalledService, type ServiceRunner } from "./service-restart.ts";
import { readPortFromUnit } from "./service.ts";
import { formatServerError, run, withServerConnection } from "./shared.ts";

type Command = [bin: string, args: string[]];

/** The live servers to retire: everyone except the survivor we're consolidating
 *  into (the one this command is talking to). */
export function otherInstances(instances: InstanceEntry[], survivorPort: number): InstanceEntry[] {
  return instances.filter((entry) => entry.port !== survivorPort);
}

/** Find the installed service unit serving `port`, if any. `portOf` is injected
 *  so the matching stays unit-testable without real unit files. */
export function findUnitForPort(
  services: InstalledService[],
  port: number,
  portOf: (filePath: string) => number | null = readPortFromUnit,
): InstalledService | null {
  for (const service of services) {
    if (portOf(service.filePath) === port) return service;
  }
  return null;
}

/** Stop AND disable a unit so it neither respawns (Restart=on-failure /
 *  KeepAlive) nor returns on next login/reboot. The caller removes the file
 *  afterwards so `webmux update` doesn't resurrect it. */
export function disableUnitCommands(service: InstalledService): Command[] {
  if (service.platform === "linux") {
    return [
      ["systemctl", ["--user", "stop", service.name]],
      ["systemctl", ["--user", "disable", service.name]],
    ];
  }
  return [["launchctl", ["unload", "-w", service.filePath]]];
}

export interface MigrateDeps {
  listLive?: () => InstanceEntry[];
  listServices?: () => InstalledService[];
  runner?: ServiceRunner;
  removeFile?: (filePath: string) => void;
  /** Read the `--port` of a unit file (injected so the orchestration is
   *  testable without real unit files on disk). */
  portOf?: (filePath: string) => number | null;
  /** Register the given repos into the survivor server. */
  migrate?: (port: number, paths: string[]) => Promise<MigrateProjectsResponse>;
}

async function defaultMigrate(port: number, paths: string[]): Promise<MigrateProjectsResponse> {
  const api = createApi(`http://localhost:${port}`);
  return withServerConnection(port, () => api.migrateProjects({ body: { paths } }));
}

/** Consolidate every other live webmux server into the one on `port`:
 *  1. register their repos into the survivor (so it serves them before any old
 *     server stops — no service gap), then
 *  2. stop + disable + remove each old server's service unit, then
 *  3. nudge the user to install the survivor as a service if it isn't one. */
export async function runMigrate(port: number, deps: MigrateDeps = {}): Promise<number> {
  const listLive = deps.listLive ?? ((): InstanceEntry[] => createInstanceRegistry().listLive());
  const listServices = deps.listServices ?? listInstalledServices;
  const runner = deps.runner ?? { run };
  const removeFile = deps.removeFile ?? unlinkSync;
  const portOf = deps.portOf ?? readPortFromUnit;
  const migrate = deps.migrate ?? defaultMigrate;

  const others = otherInstances(listLive(), port);
  if (others.length === 0) {
    console.log("No other webmux servers detected — nothing to migrate.");
    return 0;
  }

  // 1. Register first (survivor serves the repos before any old server stops).
  let result: MigrateProjectsResponse;
  try {
    result = await migrate(port, others.map((entry) => entry.projectDir));
  } catch (error) {
    console.error(formatServerError(error, port));
    return 1;
  }
  for (const project of result.migrated) {
    console.log(`Now serving ${project.name} (${project.prefix}) — ${project.path}`);
  }
  for (const failure of result.failed) {
    console.error(`Warning: could not add ${failure.path}: ${failure.error}`);
  }

  // 2. Stop + disable + remove each old server's service unit — but only for
  // repos the survivor actually picked up. If registration failed (e.g. the
  // repo is gone or its config is unreadable), retiring its unit would leave
  // the project neither served here nor running where it was: leave it alone.
  const failedPaths = new Set(result.failed.map((failure) => failure.path));
  const services = listServices();
  for (const instance of others) {
    if (failedPaths.has(instance.projectDir)) {
      console.error(
        `Skipping retirement of the server on port ${instance.port} (${instance.projectDir}) — its repo wasn't migrated. Resolve the error above, then stop it yourself.`,
      );
      continue;
    }
    const unit = findUnitForPort(services, instance.port, portOf);
    if (!unit) {
      console.error(
        `Warning: no installed service found for the server on port ${instance.port} (${instance.projectDir}). If it's a manual \`webmux serve\`, stop it yourself.`,
      );
      continue;
    }
    let ok = true;
    for (const [bin, args] of disableUnitCommands(unit)) {
      const outcome = runner.run(bin, args);
      if (!outcome.success) {
        ok = false;
        console.error(`Warning: ${bin} ${args.join(" ")} failed: ${outcome.stderr.toString().trim()}`);
      }
    }
    try {
      removeFile(unit.filePath);
    } catch (err: unknown) {
      console.error(`Warning: could not remove ${unit.filePath}: ${String(err)}`);
    }
    if (ok) console.log(`Retired ${unit.name} (port ${instance.port}).`);
  }

  // 3. Make sure something comes back after a reboot.
  if (!findUnitForPort(listServices(), port, portOf)) {
    console.log("\nThis server isn't installed as a service. Run `webmux service install` so it starts on boot.");
  }
  console.log("\nMigration complete.");
  return 0;
}

/** Print a one-line nudge when other webmux servers are running, so the user
 *  knows to consolidate. Best-effort: a registry read failure is silent. */
export function warnIfOtherInstances(port: number, listLive: () => InstanceEntry[] = () => createInstanceRegistry().listLive()): void {
  let others: InstanceEntry[];
  try {
    others = otherInstances(listLive(), port);
  } catch {
    return;
  }
  if (others.length === 0) return;
  const ports = others.map((entry) => entry.port).join(", ");
  const message = `Warning: ${others.length} other webmux server(s) detected on port(s) ${ports}. Run \`webmux project migrate\` to consolidate them into this dashboard.`;
  // Amber, not red — this is a nudge, not an error. Colorize only on a TTY so
  // piped/redirected stderr stays plain (no escape codes in logs).
  console.error(process.stderr.isTTY ? `\x1b[38;5;214m${message}\x1b[0m` : message);
}
