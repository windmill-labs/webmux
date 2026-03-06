import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type {
  AgentKind,
  LinkedRepoConfig,
  MountSpec,
  PaneTemplate,
  ProfileConfig,
  ProjectConfig,
  ServiceSpec,
} from "../domain/config";

export type { LinkedRepoConfig, MountSpec, PaneTemplate, ProfileConfig, ProjectConfig };
export type ServiceConfig = ServiceSpec;
export type DockerProfileConfig = ProfileConfig & { runtime: "docker"; image: string };

const DEFAULT_PANES: PaneTemplate[] = [
  { id: "agent", kind: "agent", focus: true },
  { id: "shell", kind: "shell", split: "right", sizePct: 25 },
];

const DEFAULT_CONFIG: ProjectConfig = {
  name: "Webmux",
  workspace: {
    mainBranch: "main",
    worktreeRoot: "__worktrees",
    defaultAgent: "claude",
  },
  profiles: {
    default: {
      runtime: "host",
      envPassthrough: [],
      panes: clonePanes(DEFAULT_PANES),
    },
  },
  services: [],
  startupEnvs: {},
  integrations: {
    github: { linkedRepos: [] },
    linear: { enabled: true },
  },
};

function clonePanes(panes: PaneTemplate[]): PaneTemplate[] {
  return panes.map((pane) => ({ ...pane }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function parseAgentKind(value: unknown): AgentKind {
  return value === "codex" ? "codex" : "claude";
}

function parsePanes(raw: unknown): PaneTemplate[] {
  if (!Array.isArray(raw)) return clonePanes(DEFAULT_PANES);

  const panes = raw
    .map((entry, index) => parsePane(entry, index))
    .filter((pane): pane is PaneTemplate => pane !== null);

  return panes.length > 0 ? panes : clonePanes(DEFAULT_PANES);
}

function parsePane(raw: unknown, index: number): PaneTemplate | null {
  if (!isRecord(raw)) return null;
  if (raw.kind !== "agent" && raw.kind !== "shell" && raw.kind !== "command") return null;

  const pane: PaneTemplate = {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : `pane-${index + 1}`,
    kind: raw.kind,
  };

  if (raw.split === "right" || raw.split === "bottom") pane.split = raw.split;
  if (typeof raw.sizePct === "number" && Number.isFinite(raw.sizePct)) pane.sizePct = raw.sizePct;
  if (raw.focus === true) pane.focus = true;
  if (raw.cwd === "repo" || raw.cwd === "worktree") pane.cwd = raw.cwd;

  if (raw.kind === "command") {
    if (typeof raw.command !== "string" || !raw.command.trim()) return null;
    pane.command = raw.command.trim();
  }

  return pane;
}

function parseMounts(raw: unknown): MountSpec[] | undefined {
  if (!Array.isArray(raw)) return undefined;

  const mounts = raw
    .filter(isRecord)
    .filter((entry) => typeof entry.hostPath === "string" && entry.hostPath.length > 0)
    .map((entry) => ({
      hostPath: entry.hostPath as string,
      ...(typeof entry.guestPath === "string" && entry.guestPath.length > 0 ? { guestPath: entry.guestPath } : {}),
      ...(typeof entry.writable === "boolean" ? { writable: entry.writable } : {}),
    }));

  return mounts.length > 0 ? mounts : undefined;
}

function parseProfile(raw: unknown, fallbackRuntime: "host" | "docker"): ProfileConfig {
  if (!isRecord(raw)) {
    return {
      runtime: fallbackRuntime,
      envPassthrough: [],
      panes: clonePanes(DEFAULT_PANES),
    };
  }

  const runtime = raw.runtime === "docker" ? "docker" : fallbackRuntime;
  const envPassthrough = isStringArray(raw.envPassthrough) ? raw.envPassthrough : [];
  const panes = parsePanes(raw.panes);
  const mounts = parseMounts(raw.mounts);
  const image = typeof raw.image === "string" && raw.image.trim() ? raw.image.trim() : undefined;

  return {
    runtime,
    envPassthrough,
    ...(raw.yolo === true ? { yolo: true } : {}),
    panes,
    ...(typeof raw.systemPrompt === "string" && raw.systemPrompt.length > 0 ? { systemPrompt: raw.systemPrompt } : {}),
    ...(image ? { image } : {}),
    ...(mounts ? { mounts } : {}),
  };
}

function parseProfiles(raw: unknown): Record<string, ProfileConfig> {
  if (!isRecord(raw)) return { default: DEFAULT_CONFIG.profiles.default };

  const profiles = Object.entries(raw).reduce<Record<string, ProfileConfig>>((acc, [name, value]) => {
    const fallbackRuntime = name === "sandbox" ? "docker" : "host";
    acc[name] = parseProfile(value, fallbackRuntime);
    return acc;
  }, {});

  if (!profiles.default) {
    profiles.default = { ...DEFAULT_CONFIG.profiles.default, panes: clonePanes(DEFAULT_CONFIG.profiles.default.panes) };
  }

  return profiles;
}

function parseServices(raw: unknown): ServiceSpec[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .filter(isRecord)
    .filter((entry) => typeof entry.name === "string" && typeof entry.portEnv === "string")
    .map((entry) => ({
      name: entry.name as string,
      portEnv: entry.portEnv as string,
      ...(typeof entry.portStart === "number" && Number.isFinite(entry.portStart) ? { portStart: entry.portStart } : {}),
      ...(typeof entry.portStep === "number" && Number.isFinite(entry.portStep) ? { portStep: entry.portStep } : {}),
      ...(typeof entry.urlTemplate === "string" && entry.urlTemplate.length > 0 ? { urlTemplate: entry.urlTemplate } : {}),
    }));
}

function parseStartupEnvs(raw: unknown): Record<string, string | boolean> {
  if (!isRecord(raw)) return {};

  const startupEnvs: Record<string, string | boolean> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "boolean") {
      startupEnvs[key] = value;
    } else {
      startupEnvs[key] = typeof value === "string" ? value : String(value);
    }
  }
  return startupEnvs;
}

function parseLinkedRepos(raw: unknown): LinkedRepoConfig[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .filter(isRecord)
    .filter((entry) => typeof entry.repo === "string")
    .map((entry) => ({
      repo: entry.repo as string,
      alias: typeof entry.alias === "string" ? entry.alias : (entry.repo as string).split("/").pop() ?? "repo",
    }));
}

export function isDockerProfile(profile: ProfileConfig | undefined): profile is DockerProfileConfig {
  return !!profile && profile.runtime === "docker" && typeof profile.image === "string" && profile.image.length > 0;
}

export function getDefaultProfileName(config: ProjectConfig): string {
  if (config.profiles.default) return "default";
  return Object.keys(config.profiles)[0] ?? "default";
}

export function getDefaultAgent(config: ProjectConfig): AgentKind {
  return parseAgentKind(config.workspace.defaultAgent);
}

function readConfigFile(root: string): string {
  return readFileSync(join(root, ".webmux.yaml"), "utf8");
}

/** Resolve the git repository root from a directory. */
export function gitRoot(dir: string): string {
  const result = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], { stdout: "pipe", stderr: "pipe", cwd: dir });
  if (result.exitCode !== 0) return dir;
  const root = new TextDecoder().decode(result.stdout).trim();
  return root || dir;
}

/** Load `.webmux.yaml` from the git root into the final project config shape. */
export function loadConfig(dir: string): ProjectConfig {
  try {
    const root = gitRoot(dir);
    const text = readConfigFile(root).trim();
    if (!text) return DEFAULT_CONFIG;

    const parsed = parseYaml(text) as Record<string, unknown>;

    return {
      name: typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim() : DEFAULT_CONFIG.name,
      workspace: {
        mainBranch: isRecord(parsed.workspace) && typeof parsed.workspace.mainBranch === "string"
          ? parsed.workspace.mainBranch
          : DEFAULT_CONFIG.workspace.mainBranch,
        worktreeRoot: isRecord(parsed.workspace) && typeof parsed.workspace.worktreeRoot === "string"
          ? parsed.workspace.worktreeRoot
          : DEFAULT_CONFIG.workspace.worktreeRoot,
        defaultAgent: isRecord(parsed.workspace)
          ? parseAgentKind(parsed.workspace.defaultAgent)
          : DEFAULT_CONFIG.workspace.defaultAgent,
      },
      profiles: parseProfiles(parsed.profiles),
      services: parseServices(parsed.services),
      startupEnvs: parseStartupEnvs(parsed.startupEnvs),
      integrations: {
        github: {
          linkedRepos: isRecord(parsed.integrations) && isRecord(parsed.integrations.github)
            ? parseLinkedRepos(parsed.integrations.github.linkedRepos)
            : [],
        },
        linear: {
          enabled: isRecord(parsed.integrations) && isRecord(parsed.integrations.linear) && typeof parsed.integrations.linear.enabled === "boolean"
            ? parsed.integrations.linear.enabled
            : DEFAULT_CONFIG.integrations.linear.enabled,
        },
      },
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

/** Expand ${VAR} placeholders in a template string using an env map. */
export function expandTemplate(template: string, env: Record<string, string>): string {
  return template.replace(/\$\{(\w+)\}/g, (_, key: string) => env[key] ?? "");
}
