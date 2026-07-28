import { stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import type {
  ComponentCatalogConfig,
  ComponentCatalogState,
  ComponentDefinition,
  ComponentPortDefinition,
  ComponentProtocol,
} from "../domain/components";
import { isValidEnvKey } from "../domain/policies";

const COMPONENT_ID_RE = /^[a-z0-9][a-z0-9._-]*$/;
const DEFAULT_CATALOG_TIMEOUT_MS = 10_000;

interface CatalogCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ComponentCatalogLoaderDependencies {
  runCommand?: (command: string, cwd: string, timeoutMs: number) => Promise<CatalogCommandResult>;
  pathExists?: (path: string) => Promise<boolean>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPathInside(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return relativePath === "" || (!relativePath.startsWith("..") && !relativePath.startsWith("/"));
}

function parseEnvironment(raw: unknown, componentId: string): Record<string, string> {
  if (raw === undefined) return {};
  if (!isRecord(raw)) {
    throw new Error(`Component "${componentId}" environment must be an object`);
  }

  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!isValidEnvKey(key)) {
      throw new Error(`Component "${componentId}" has invalid environment key "${key}"`);
    }
    if (typeof value !== "string") {
      throw new Error(`Component "${componentId}" environment value "${key}" must be a string`);
    }
    environment[key] = value;
  }
  return environment;
}

function parseProtocol(raw: unknown, componentId: string, portName: string): ComponentProtocol {
  if (raw === undefined) return "http";
  if (raw === "http" || raw === "https" || raw === "tcp") return raw;
  throw new Error(`Component "${componentId}" port "${portName}" has invalid protocol`);
}

function parseHealth(raw: unknown, componentId: string, portName: string): ComponentPortDefinition["health"] {
  if (raw === undefined) return null;
  if (!isRecord(raw) || raw.type !== "tcp") {
    throw new Error(`Component "${componentId}" port "${portName}" only supports TCP health checks`);
  }
  return { type: "tcp" };
}

function parsePorts(raw: unknown, componentId: string): ComponentPortDefinition[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new Error(`Component "${componentId}" ports must be an array`);
  }

  const names = new Set<string>();
  const processEnvs = new Set<string>();
  return raw.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Component "${componentId}" port ${index + 1} must be an object`);
    }
    if (typeof entry.name !== "string" || !entry.name.trim()) {
      throw new Error(`Component "${componentId}" port ${index + 1} requires a name`);
    }
    if (typeof entry.processEnv !== "string" || !isValidEnvKey(entry.processEnv)) {
      throw new Error(`Component "${componentId}" port "${entry.name}" requires a valid processEnv`);
    }

    const name = entry.name.trim();
    const processEnv = entry.processEnv;
    if (names.has(name)) {
      throw new Error(`Component "${componentId}" has duplicate port name "${name}"`);
    }
    if (processEnvs.has(processEnv)) {
      throw new Error(`Component "${componentId}" has duplicate processEnv "${processEnv}"`);
    }
    names.add(name);
    processEnvs.add(processEnv);

    return {
      name,
      processEnv,
      protocol: parseProtocol(entry.protocol, componentId, name),
      health: parseHealth(entry.health, componentId, name),
    };
  });
}

async function defaultPathExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export async function parseComponentCatalog(
  raw: unknown,
  projectRoot: string,
  pathExists: (path: string) => Promise<boolean> = defaultPathExists,
): Promise<ComponentDefinition[]> {
  if (!Array.isArray(raw)) {
    throw new Error("Component catalog must be a JSON array");
  }

  const normalizedRoot = resolve(projectRoot);
  const ids = new Set<string>();
  const components: ComponentDefinition[] = [];

  for (const [index, entry] of raw.entries()) {
    if (!isRecord(entry)) {
      throw new Error(`Component ${index + 1} must be an object`);
    }
    if (typeof entry.id !== "string" || !COMPONENT_ID_RE.test(entry.id)) {
      throw new Error(`Component ${index + 1} requires a safe lowercase id`);
    }
    if (ids.has(entry.id)) {
      throw new Error(`Duplicate component id "${entry.id}"`);
    }
    if (typeof entry.kind !== "string" || !entry.kind.trim()) {
      throw new Error(`Component "${entry.id}" requires a kind`);
    }
    if (typeof entry.workingDir !== "string" || !entry.workingDir.trim()) {
      throw new Error(`Component "${entry.id}" requires a workingDir`);
    }
    if (typeof entry.command !== "string" || !entry.command.trim()) {
      throw new Error(`Component "${entry.id}" requires a command`);
    }

    const workingDir = entry.workingDir.trim();
    const absoluteWorkingDir = resolve(normalizedRoot, workingDir);
    if (!isPathInside(normalizedRoot, absoluteWorkingDir)) {
      throw new Error(`Component "${entry.id}" workingDir escapes the project root`);
    }
    if (!await pathExists(absoluteWorkingDir)) {
      throw new Error(`Component "${entry.id}" workingDir does not exist: ${workingDir}`);
    }

    ids.add(entry.id);
    components.push({
      id: entry.id,
      label: typeof entry.label === "string" && entry.label.trim() ? entry.label.trim() : entry.id,
      kind: entry.kind.trim(),
      workingDir,
      command: entry.command.trim(),
      environment: parseEnvironment(entry.environment, entry.id),
      ports: parsePorts(entry.ports, entry.id),
    });
  }

  return components.sort((left, right) => left.id.localeCompare(right.id));
}

async function runCatalogCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
): Promise<CatalogCommandResult> {
  const process = Bun.spawn(["bash", "-lc", command], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const timeout = setTimeout(() => process.kill(), timeoutMs);
  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ]);
    return { exitCode, stdout, stderr };
  } finally {
    clearTimeout(timeout);
  }
}

export async function loadComponentCatalog(
  config: ComponentCatalogConfig | null,
  projectRoot: string,
  dependencies: ComponentCatalogLoaderDependencies = {},
): Promise<ComponentCatalogState> {
  if (!config) {
    return { status: "disabled", components: [], error: null };
  }

  const runCommand = dependencies.runCommand ?? runCatalogCommand;
  try {
    const result = await runCommand(config.command, projectRoot, DEFAULT_CATALOG_TIMEOUT_MS);
    if (result.exitCode !== 0) {
      const detail = result.stderr.trim() || `exit code ${result.exitCode}`;
      throw new Error(`Catalog command failed: ${detail}`);
    }

    let raw: unknown;
    try {
      raw = JSON.parse(result.stdout);
    } catch {
      throw new Error("Catalog command did not output valid JSON");
    }

    const components = await parseComponentCatalog(raw, projectRoot, dependencies.pathExists);
    return { status: "ready", components, error: null };
  } catch (error) {
    return {
      status: "error",
      components: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
