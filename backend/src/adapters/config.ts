import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type {
  AgentKind,
  AutoNameConfig,
  LifecycleHooksConfig,
  LinearIntegrationConfig,
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

interface LoadConfigOptions {
  resolvedRoot?: boolean;
}

interface LocalProjectConfigOverlay {
  worktreeRoot: string | null;
  profiles: Record<string, ProfileConfig>;
  lifecycleHooks: LifecycleHooksConfig;
  linear: Partial<LinearIntegrationConfig> | null;
}

const DEFAULT_PANES: PaneTemplate[] = [
  { id: "agent", kind: "agent", focus: true },
  { id: "shell", kind: "shell", split: "right", sizePct: 25 },
];

const DEFAULT_CONFIG: ProjectConfig = {
  name: "Webmux",
  workspace: {
    mainBranch: "main",
    worktreeRoot: "../worktrees",
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
    linear: { enabled: true, autoCreateWorktrees: false },
  },
  lifecycleHooks: {},
  autoName: null,
};

function clonePanes(panes: PaneTemplate[]): PaneTemplate[] {
  return panes.map((pane) => ({ ...pane }));
}

function cloneMounts(mounts: MountSpec[] | undefined): MountSpec[] | undefined {
  return mounts?.map((mount) => ({ ...mount }));
}

function cloneProfile(profile: ProfileConfig): ProfileConfig {
  return {
    ...profile,
    envPassthrough: [...profile.envPassthrough],
    panes: clonePanes(profile.panes),
    ...(profile.mounts ? { mounts: cloneMounts(profile.mounts) } : {}),
  };
}

function cloneProfiles(profiles: Record<string, ProfileConfig>): Record<string, ProfileConfig> {
  return Object.fromEntries(
    Object.entries(profiles).map(([name, profile]) => [name, cloneProfile(profile)]),
  );
}

function defaultProfiles(): Record<string, ProfileConfig> {
  return { default: cloneProfile(DEFAULT_CONFIG.profiles.default) };
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

function parseProfiles(raw: unknown, includeDefaultProfile: boolean): Record<string, ProfileConfig> {
  if (!isRecord(raw)) return includeDefaultProfile ? defaultProfiles() : {};

  const profiles = Object.entries(raw).reduce<Record<string, ProfileConfig>>((acc, [name, value]) => {
    const fallbackRuntime = name === "sandbox" ? "docker" : "host";
    acc[name] = parseProfile(value, fallbackRuntime);
    return acc;
  }, {});

  if (Object.keys(profiles).length === 0) {
    return includeDefaultProfile ? defaultProfiles() : {};
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

function parseLifecycleHooks(raw: unknown): LifecycleHooksConfig {
  if (!isRecord(raw)) return {};

  const hooks: LifecycleHooksConfig = {};
  if (typeof raw.postCreate === "string" && raw.postCreate.trim()) {
    hooks.postCreate = raw.postCreate.trim();
  }
  if (typeof raw.preRemove === "string" && raw.preRemove.trim()) {
    hooks.preRemove = raw.preRemove.trim();
  }
  return hooks;
}

function parseAutoName(raw: unknown): AutoNameConfig | null {
  if (!isRecord(raw)) return null;
  const provider = raw.provider;
  if (provider !== "claude" && provider !== "codex") return null;

  return {
    provider,
    ...(typeof raw.model === "string" && raw.model.trim()
      ? { model: raw.model.trim() }
      : {}),
    ...(typeof raw.system_prompt === "string" && raw.system_prompt.trim()
      ? { systemPrompt: raw.system_prompt.trim() }
      : {}),
  };
}

function parseLinkedRepos(raw: unknown): LinkedRepoConfig[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .filter(isRecord)
    .filter((entry) => typeof entry.repo === "string")
    .map((entry) => ({
      repo: entry.repo as string,
      alias: typeof entry.alias === "string" ? entry.alias : (entry.repo as string).split("/").pop() ?? "repo",
      ...(typeof entry.dir === "string" && entry.dir.trim() ? { dir: entry.dir.trim() } : {}),
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

function readLocalConfigFile(root: string): string {
  return readFileSync(join(root, ".webmux.local.yaml"), "utf8");
}

function parseConfigDocument(text: string): Record<string, unknown> {
  const parsed = parseYaml(text);
  return isRecord(parsed) ? parsed : {};
}

function parseProjectConfig(parsed: Record<string, unknown>): ProjectConfig {
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
    profiles: parseProfiles(parsed.profiles, true),
    services: parseServices(parsed.services),
    startupEnvs: parseStartupEnvs(parsed.startupEnvs),
    integrations: {
      github: {
        linkedRepos: isRecord(parsed.integrations) && isRecord(parsed.integrations.github)
          ? parseLinkedRepos(parsed.integrations.github.linkedRepos)
          : isRecord(parsed.integrations) && Array.isArray(parsed.integrations.github)
            ? parseLinkedRepos(parsed.integrations.github)
            : [],
      },
      linear: {
        enabled: isRecord(parsed.integrations) && isRecord(parsed.integrations.linear) && typeof parsed.integrations.linear.enabled === "boolean"
          ? parsed.integrations.linear.enabled
          : DEFAULT_CONFIG.integrations.linear.enabled,
        autoCreateWorktrees: isRecord(parsed.integrations) && isRecord(parsed.integrations.linear) && typeof parsed.integrations.linear.autoCreateWorktrees === "boolean"
          ? parsed.integrations.linear.autoCreateWorktrees
          : DEFAULT_CONFIG.integrations.linear.autoCreateWorktrees,
      },
    },
    lifecycleHooks: parseLifecycleHooks(parsed.lifecycleHooks),
    autoName: parseAutoName(parsed.auto_name),
  };
}

function defaultConfig(): ProjectConfig {
  return parseProjectConfig({});
}

function parseLocalLinearOverlay(parsed: Record<string, unknown>): Partial<LinearIntegrationConfig> | null {
  if (!isRecord(parsed.integrations)) return null;
  const linear = parsed.integrations.linear;
  if (!isRecord(linear)) return null;

  const overlay: Partial<LinearIntegrationConfig> = {};
  if (typeof linear.enabled === "boolean") overlay.enabled = linear.enabled;
  if (typeof linear.autoCreateWorktrees === "boolean") overlay.autoCreateWorktrees = linear.autoCreateWorktrees;
  return Object.keys(overlay).length > 0 ? overlay : null;
}

function loadLocalProjectConfigOverlay(root: string): LocalProjectConfigOverlay {
  try {
    const text = readLocalConfigFile(root).trim();
    if (!text) {
      return { worktreeRoot: null, profiles: {}, lifecycleHooks: {}, linear: null };
    }

    const parsed = parseConfigDocument(text);
    const ws = isRecord(parsed.workspace) ? parsed.workspace : null;
    return {
      worktreeRoot: ws && typeof ws.worktreeRoot === "string" ? ws.worktreeRoot : null,
      profiles: parseProfiles(parsed.profiles, false),
      lifecycleHooks: parseLifecycleHooks(parsed.lifecycleHooks),
      linear: parseLocalLinearOverlay(parsed),
    };
  } catch {
    return { worktreeRoot: null, profiles: {}, lifecycleHooks: {}, linear: null };
  }
}

function mergeHookCommand(projectCommand: string | undefined, localCommand: string | undefined): string | undefined {
  if (projectCommand && localCommand) {
    return ["set -e", projectCommand, localCommand].join("\n");
  }

  return localCommand ?? projectCommand;
}

function mergeLifecycleHooks(
  projectHooks: LifecycleHooksConfig,
  localHooks: LifecycleHooksConfig,
): LifecycleHooksConfig {
  const postCreate = mergeHookCommand(projectHooks.postCreate, localHooks.postCreate);
  const preRemove = mergeHookCommand(projectHooks.preRemove, localHooks.preRemove);

  return {
    ...(postCreate ? { postCreate } : {}),
    ...(preRemove ? { preRemove } : {}),
  };
}

/** Resolve the git repository root from a directory. */
export function gitRoot(dir: string): string {
  const result = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], { stdout: "pipe", stderr: "pipe", cwd: dir });
  if (result.exitCode !== 0) return dir;
  const root = new TextDecoder().decode(result.stdout).trim();
  return root || dir;
}

/** Resolve the shared project root for a repository, even from a linked worktree. */
export function projectRoot(dir: string): string {
  const result = Bun.spawnSync(["git", "rev-parse", "--git-common-dir"], { stdout: "pipe", stderr: "pipe", cwd: dir });
  if (result.exitCode !== 0) return gitRoot(dir);

  const commonDir = new TextDecoder().decode(result.stdout).trim();
  return commonDir ? dirname(resolve(dir, commonDir)) : gitRoot(dir);
}

/** Load `.webmux.yaml` from the shared project root into the final project config shape. */
export function loadConfig(dir: string, options: LoadConfigOptions = {}): ProjectConfig {
  const root = options.resolvedRoot ? dir : projectRoot(dir);

  let projectConfig: ProjectConfig;
  try {
    const text = readConfigFile(root).trim();
    projectConfig = text ? parseProjectConfig(parseConfigDocument(text)) : defaultConfig();
  } catch {
    projectConfig = defaultConfig();
  }

  const localOverlay = loadLocalProjectConfigOverlay(root);

  return {
    ...projectConfig,
    ...(localOverlay.worktreeRoot !== null ? {
      workspace: { ...projectConfig.workspace, worktreeRoot: localOverlay.worktreeRoot },
    } : {}),
    profiles: {
      ...cloneProfiles(projectConfig.profiles),
      ...cloneProfiles(localOverlay.profiles),
    },
    lifecycleHooks: mergeLifecycleHooks(projectConfig.lifecycleHooks, localOverlay.lifecycleHooks),
    ...(localOverlay.linear ? {
      integrations: {
        ...projectConfig.integrations,
        linear: { ...projectConfig.integrations.linear, ...localOverlay.linear },
      },
    } : {}),
  };
}

/** Expand ${VAR} placeholders in a template string using an env map. */
export function expandTemplate(template: string, env: Record<string, string>): string {
  return template.replace(/\$\{(\w+)\}/g, (_, key: string) => env[key] ?? "");
}
