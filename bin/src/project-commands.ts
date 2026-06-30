import { resolve } from "node:path";
import { createApi, type ProjectInitPhase, type ProjectInitState } from "@webmux/api-contract";
import { CommandUsageError, formatServerError } from "./shared";
import { runMigrate } from "./migrate.ts";

const PROJECT_SETUP_POLL_INTERVAL_MS = 700;
const PROJECT_SETUP_TIMEOUT_MS = 5 * 60_000;

function projectSetupPhaseLabel(phase: ProjectInitPhase): string {
  switch (phase) {
    case "creating_config":
      return "Creating .webmux.yaml";
    case "analyzing":
      return "Analyzing project structure";
    case "ready":
      return "Project ready";
    case "failed":
      return "Setup failed";
  }
}

export interface ProjectSetupPoller {
  poll: () => Promise<ProjectInitState[]>;
  sleep: (ms: number) => Promise<void>;
  log?: (message: string) => void;
  now?: () => number;
  timeoutMs?: number;
}

/** Follow an in-progress on-add project setup to completion, printing each
 *  phase as it changes. Resolves with the ready state (carrying the prefix) or
 *  throws on failure/timeout. Poller is injected so it's testable. */
export async function awaitProjectSetup(path: string, deps: ProjectSetupPoller): Promise<ProjectInitState> {
  const log = deps.log ?? ((message: string): void => console.log(message));
  const now = deps.now ?? Date.now;
  const deadline = now() + (deps.timeoutMs ?? PROJECT_SETUP_TIMEOUT_MS);
  let lastPhase: ProjectInitPhase | null = null;

  while (now() < deadline) {
    // A transient poll failure shouldn't abort the flow — the backend job keeps
    // running, so just retry until the deadline.
    let state: ProjectInitState | undefined;
    try {
      state = (await deps.poll()).find((init) => init.path === path);
    } catch {
      state = undefined;
    }
    if (state && state.phase !== lastPhase) {
      lastPhase = state.phase;
      if (state.phase !== "ready" && state.phase !== "failed") {
        log(`  ${projectSetupPhaseLabel(state.phase)}…`);
      }
    }
    if (state?.phase === "ready") return state;
    if (state?.phase === "failed") throw new Error(state.error ?? "Project setup failed.");
    await deps.sleep(PROJECT_SETUP_POLL_INTERVAL_MS);
  }
  throw new Error("Project setup timed out.");
}

export type ParsedProjectCommand =
  | { subcommand: "ls" }
  | { subcommand: "add"; path: string }
  | { subcommand: "rm"; prefix: string }
  | { subcommand: "migrate" };

export function getProjectUsage(): string {
  return [
    "Usage:",
    "  webmux project ls                 List projects the dashboard is serving",
    "  webmux project add [path]         Add a project (defaults to the current repo)",
    "  webmux project rm <prefix>        Remove a project by its prefix",
    "  webmux project migrate            Fold other running webmux servers into this one",
    "",
    "All projects are served together on one dashboard and one port. `add` persists",
    "the project so it is reloaded on the next start. These commands talk to the live",
    "webmux server for this directory (or the server on --port when given).",
    "",
    "Examples:",
    "  webmux project ls",
    "  webmux project add ~/code/my-service",
    "  webmux project rm my-service",
    "  webmux project migrate",
  ].join("\n");
}

export function parseProjectArgs(args: string[]): ParsedProjectCommand | null {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") return null;
  const subcommand = args[0];

  if (subcommand === "ls" || subcommand === "list") {
    if (args.length > 1) throw new CommandUsageError(`Unexpected argument: ${args[1]}`);
    return { subcommand: "ls" };
  }

  if (subcommand === "add") {
    if (args.length > 2) throw new CommandUsageError(`Unexpected argument: ${args[2]}`);
    return { subcommand: "add", path: args[1] ?? "." };
  }

  if (subcommand === "rm" || subcommand === "remove") {
    const prefix = args[1];
    if (!prefix) throw new CommandUsageError("project rm requires a <prefix> argument");
    if (args.length > 2) throw new CommandUsageError(`Unexpected argument: ${args[2]}`);
    return { subcommand: "rm", prefix };
  }

  if (subcommand === "migrate") {
    if (args.length > 1) throw new CommandUsageError(`Unexpected argument: ${args[1]}`);
    return { subcommand: "migrate" };
  }

  throw new CommandUsageError(`Unknown project subcommand: ${subcommand}`);
}

export async function runProjectCommand(args: string[], port: number): Promise<number> {
  let parsed: ParsedProjectCommand | null;
  try {
    parsed = parseProjectArgs(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(getProjectUsage());
    return 1;
  }
  if (!parsed) {
    console.log(getProjectUsage());
    return 0;
  }

  if (parsed.subcommand === "migrate") {
    return runMigrate(port);
  }

  const api = createApi(`http://localhost:${port}`);
  try {
    if (parsed.subcommand === "ls") {
      const { projects } = await api.fetchProjects();
      if (projects.length === 0) {
        console.log("No projects. Add one with: webmux project add [path]");
        return 0;
      }
      for (const project of projects) {
        const marker = project.active ? "●" : "○";
        console.log(`${marker} ${project.prefix}\t${project.name}\t${project.path}`);
      }
      return 0;
    }

    if (parsed.subcommand === "add") {
      const absolute = resolve(process.cwd(), parsed.path);
      const res = await api.addProject({ body: { path: absolute } });
      if (!res.initializing) {
        if (!res.project) {
          console.error("Server accepted the project but returned nothing to open.");
          return 1;
        }
        console.log(`Added ${res.project.name} (${res.project.prefix}) — ${res.project.path}`);
        return 0;
      }
      // Repo had no .webmux.yaml — webmux is setting it up. Show the phases.
      const ready = await awaitProjectSetup(res.path, {
        poll: async () => (await api.projectInits()).inits,
        sleep: (ms) => Bun.sleep(ms),
      });
      console.log(`Added ${ready.name ?? ready.prefix} (${ready.prefix}) — ${res.path}`);
      return 0;
    }

    await api.removeProject({ params: { prefix: parsed.prefix } });
    console.log(`Removed project: ${parsed.prefix}`);
    return 0;
  } catch (error) {
    console.error(formatServerError(error, port));
    return 1;
  }
}
