import { join } from "node:path";
import { parse as parseYaml } from "yaml";

export interface ServiceConfig {
  name: string;
  portEnv: string;
  portStart?: number;
  portStep?: number;
}

export interface ProfileConfig {
  name: string;
  systemPrompt?: string;
  envPassthrough?: string[];
}

export interface SandboxProfileConfig extends ProfileConfig {
  image: string;
  extraMounts?: { hostPath: string; guestPath?: string; writable?: boolean }[];
}

export interface LinkedRepoConfig {
  repo: string;
  alias: string;
}

export interface WmdevConfig {
  services: ServiceConfig[];
  profiles: {
    default: ProfileConfig;
    sandbox?: SandboxProfileConfig;
  };
  autoName: boolean;
  linkedRepos: LinkedRepoConfig[];
}

const DEFAULT_CONFIG: WmdevConfig = {
  services: [],
  profiles: { default: { name: "default" } },
  autoName: false,
  linkedRepos: [],
};

/** Check if .workmux.yaml has auto_name configured. */
function hasAutoName(dir: string): boolean {
  try {
    const filePath = join(gitRoot(dir), ".workmux.yaml");
    const result = Bun.spawnSync(["cat", filePath], { stdout: "pipe", stderr: "pipe" });
    const text = new TextDecoder().decode(result.stdout).trim();
    if (!text) return false;
    const parsed = parseYaml(text) as Record<string, unknown>;
    const autoName = parsed.auto_name as Record<string, unknown> | undefined;
    return !!autoName?.model;
  } catch {
    return false;
  }
}

/** Resolve the git repository root from a directory. */
export function gitRoot(dir: string): string {
  const result = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], { stdout: "pipe", cwd: dir });
  return new TextDecoder().decode(result.stdout).trim() || dir;
}

/** Load .wmdev.yaml from the git root, merging with defaults. */
export function loadConfig(dir: string): WmdevConfig {
  try {
    const root = gitRoot(dir);
    const filePath = join(root, ".wmdev.yaml");
    const result = Bun.spawnSync(["cat", filePath], { stdout: "pipe" });
    const text = new TextDecoder().decode(result.stdout).trim();
    if (!text) return DEFAULT_CONFIG;
    const parsed = parseYaml(text) as Record<string, unknown>;
    const profiles = parsed.profiles as Record<string, unknown> | undefined;
    const defaultProfile = profiles?.default as ProfileConfig | undefined;
    const sandboxProfile = profiles?.sandbox as SandboxProfileConfig | undefined;
    const autoName = hasAutoName(dir);
    const linkedRepos: LinkedRepoConfig[] = Array.isArray(parsed.linkedRepos)
      ? (parsed.linkedRepos as Array<Record<string, unknown>>)
          .filter((r) => typeof r === "object" && r !== null && typeof r.repo === "string")
          .map((r) => ({
            repo: r.repo as string,
            alias: typeof r.alias === "string" ? r.alias : (r.repo as string).split("/").pop()!,
          }))
      : [];
    return {
      services: Array.isArray(parsed.services) ? parsed.services as ServiceConfig[] : DEFAULT_CONFIG.services,
      profiles: {
        default: defaultProfile?.name ? defaultProfile : DEFAULT_CONFIG.profiles.default,
        ...(sandboxProfile?.name && sandboxProfile?.image ? { sandbox: sandboxProfile } : {}),
      },
      autoName,
      linkedRepos,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

/** Expand ${VAR} placeholders in a template string using an env map. */
export function expandTemplate(template: string, env: Record<string, string>): string {
  return template.replace(/\$\{(\w+)\}/g, (_, key: string) => env[key] ?? "");
}
