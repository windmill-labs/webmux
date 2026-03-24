import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type {
  AgentKind,
  AutoNameConfig,
  AutoPullConfig,
  GitHubIntegrationConfig,
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
  github: Partial<GitHubIntegrationConfig> | null;
  autoPull: Partial<AutoPullConfig> | null;
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
    autoPull: { enabled: false, intervalSeconds: 300 },
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
    github: { linkedRepos: [], autoRemoveOnMerge: false },
    linear: { enabled: true, autoCreateWorktrees: false, createTicketOption: false },
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

function parseAutoPull(raw: unknown): AutoPullConfig {
  if (!isRecord(raw)) return DEFAULT_CONFIG.workspace.autoPull;
  const enabled = typeof raw.enabled === "boolean" ? raw.enabled : false;
  const interval = typeof raw.intervalSeconds === "number" && Number.isFinite(raw.intervalSeconds) && raw.intervalSeconds >= 30
    ? raw.intervalSeconds
    : 300;
  return { enabled, intervalSeconds: interval };
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
      autoPull: isRecord(parsed.workspace)
        ? parseAutoPull(parsed.workspace.autoPull)
        : DEFAULT_CONFIG.workspace.autoPull,
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
        autoRemoveOnMerge: isRecord(parsed.integrations) && isRecord(parsed.integrations.github) && typeof parsed.integrations.github.autoRemoveOnMerge === "boolean"
          ? parsed.integrations.github.autoRemoveOnMerge
          : DEFAULT_CONFIG.integrations.github.autoRemoveOnMerge,
      },
      linear: {
        enabled: isRecord(parsed.integrations) && isRecord(parsed.integrations.linear) && typeof parsed.integrations.linear.enabled === "boolean"
          ? parsed.integrations.linear.enabled
          : DEFAULT_CONFIG.integrations.linear.enabled,
        autoCreateWorktrees: isRecord(parsed.integrations) && isRecord(parsed.integrations.linear) && typeof parsed.integrations.linear.autoCreateWorktrees === "boolean"
          ? parsed.integrations.linear.autoCreateWorktrees
          : DEFAULT_CONFIG.integrations.linear.autoCreateWorktrees,
        createTicketOption: isRecord(parsed.integrations) &&
            isRecord(parsed.integrations.linear) &&
            typeof parsed.integrations.linear.createTicketOption === "boolean"
          ? parsed.integrations.linear.createTicketOption
          : DEFAULT_CONFIG.integrations.linear.createTicketOption,
        ...(isRecord(parsed.integrations) &&
            isRecord(parsed.integrations.linear) &&
            typeof parsed.integrations.linear.teamId === "string" &&
            parsed.integrations.linear.teamId.trim()
          ? { teamId: parsed.integrations.linear.teamId.trim() }
          : {}),
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
  if (typeof linear.createTicketOption === "boolean") overlay.createTicketOption = linear.createTicketOption;
  if (typeof linear.teamId === "string" && linear.teamId.trim()) overlay.teamId = linear.teamId.trim();
  return Object.keys(overlay).length > 0 ? overlay : null;
}

function parseLocalGitHubOverlay(parsed: Record<string, unknown>): Partial<GitHubIntegrationConfig> | null {
  if (!isRecord(parsed.integrations)) return null;
  const github = parsed.integrations.github;
  if (!isRecord(github)) return null;

  const overlay: Partial<GitHubIntegrationConfig> = {};
  if (typeof github.autoRemoveOnMerge === "boolean") overlay.autoRemoveOnMerge = github.autoRemoveOnMerge;
  return Object.keys(overlay).length > 0 ? overlay : null;
}

function parseLocalAutoPullOverlay(parsed: Record<string, unknown>): Partial<AutoPullConfig> | null {
  if (!isRecord(parsed.workspace)) return null;
  const autoPull = parsed.workspace.autoPull;
  if (!isRecord(autoPull)) return null;

  const overlay: Partial<AutoPullConfig> = {};
  if (typeof autoPull.enabled === "boolean") overlay.enabled = autoPull.enabled;
  if (typeof autoPull.intervalSeconds === "number" && Number.isFinite(autoPull.intervalSeconds) && autoPull.intervalSeconds >= 30) {
    overlay.intervalSeconds = autoPull.intervalSeconds;
  }
  return Object.keys(overlay).length > 0 ? overlay : null;
}

function loadLocalProjectConfigOverlay(root: string): LocalProjectConfigOverlay {
  try {
    const text = readLocalConfigFile(root).trim();
    if (!text) {
      return { worktreeRoot: null, profiles: {}, lifecycleHooks: {}, linear: null, github: null, autoPull: null };
    }

    const parsed = parseConfigDocument(text);
    const ws = isRecord(parsed.workspace) ? parsed.workspace : null;
    return {
      worktreeRoot: ws && typeof ws.worktreeRoot === "string" ? ws.worktreeRoot : null,
      profiles: parseProfiles(parsed.profiles, false),
      lifecycleHooks: parseLifecycleHooks(parsed.lifecycleHooks),
      linear: parseLocalLinearOverlay(parsed),
      github: parseLocalGitHubOverlay(parsed),
      autoPull: parseLocalAutoPullOverlay(parsed),
    };
  } catch {
    return { worktreeRoot: null, profiles: {}, lifecycleHooks: {}, linear: null, github: null, autoPull: null };
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

  const workspace = localOverlay.worktreeRoot !== null || localOverlay.autoPull
    ? {
        ...projectConfig.workspace,
        ...(localOverlay.worktreeRoot !== null ? { worktreeRoot: localOverlay.worktreeRoot } : {}),
        ...(localOverlay.autoPull ? { autoPull: { ...projectConfig.workspace.autoPull, ...localOverlay.autoPull } } : {}),
      }
    : projectConfig.workspace;

  const hasIntegrationOverlay = localOverlay.linear || localOverlay.github;
  const integrations = hasIntegrationOverlay
    ? {
        ...projectConfig.integrations,
        ...(localOverlay.linear ? { linear: { ...projectConfig.integrations.linear, ...localOverlay.linear } } : {}),
        ...(localOverlay.github ? { github: { ...projectConfig.integrations.github, ...localOverlay.github } } : {}),
      }
    : projectConfig.integrations;

  return {
    ...projectConfig,
    workspace,
    profiles: {
      ...cloneProfiles(projectConfig.profiles),
      ...cloneProfiles(localOverlay.profiles),
    },
    lifecycleHooks: mergeLifecycleHooks(projectConfig.lifecycleHooks, localOverlay.lifecycleHooks),
    integrations,
  };
}

/** Persist a partial Linear integration config override into `.webmux.local.yaml`.
 *  Reads the existing file, merges the changes under `integrations.linear`, and writes back. */
export async function persistLocalLinearConfig(
  dir: string,
  changes: Partial<LinearIntegrationConfig>,
): Promise<void> {
  const root = projectRoot(dir);
  const localPath = join(root, ".webmux.local.yaml");

  let existing: Record<string, unknown> = {};
  try {
    const text = readFileSync(localPath, "utf8").trim();
    if (text) existing = parseConfigDocument(text);
  } catch { /* file doesn't exist yet */ }

  const integrations = isRecord(existing.integrations) ? { ...existing.integrations } : {};
  const linear = isRecord(integrations.linear) ? { ...integrations.linear } : {};
  Object.assign(linear, changes);
  integrations.linear = linear;
  existing.integrations = integrations;

  await Bun.write(localPath, stringifyYaml(existing));
}

/** Persist a partial GitHub integration config override into `.webmux.local.yaml`. */
export async function persistLocalGitHubConfig(
  dir: string,
  changes: Partial<GitHubIntegrationConfig>,
): Promise<void> {
  const root = projectRoot(dir);
  const localPath = join(root, ".webmux.local.yaml");

  let existing: Record<string, unknown> = {};
  try {
    const text = readFileSync(localPath, "utf8").trim();
    if (text) existing = parseConfigDocument(text);
  } catch { /* file doesn't exist yet */ }

  const integrations = isRecord(existing.integrations) ? { ...existing.integrations } : {};
  const github = isRecord(integrations.github) ? { ...integrations.github } : {};
  Object.assign(github, changes);
  integrations.github = github;
  existing.integrations = integrations;

  await Bun.write(localPath, stringifyYaml(existing));
}

/** Expand ${VAR} placeholders in a template string using an env map. */
export function expandTemplate(template: string, env: Record<string, string>): string {
  return template.replace(/\$\{(\w+)\}/g, (_, key: string) => env[key] ?? "");
}
