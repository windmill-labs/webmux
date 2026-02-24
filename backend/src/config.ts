import { join } from "node:path";
import { parse as parseYaml } from "yaml";

export interface ServiceConfig {
  name: string;
  portEnv: string;
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

export interface WmdevConfig {
  services: ServiceConfig[];
  profiles: {
    default: ProfileConfig;
    sandbox?: SandboxProfileConfig;
  };
}

const DEFAULT_CONFIG: WmdevConfig = {
  services: [],
  profiles: { default: { name: "default" } },
};

/** Load .wmdev.yaml from a directory, merging with defaults. */
export function loadConfig(dir: string): WmdevConfig {
  try {
    const filePath = join(dir, ".wmdev.yaml");
    const result = Bun.spawnSync(["cat", filePath], { stdout: "pipe" });
    const text = new TextDecoder().decode(result.stdout).trim();
    if (!text) return DEFAULT_CONFIG;
    const parsed = parseYaml(text) as Record<string, unknown>;
    const profiles = parsed.profiles as Record<string, unknown> | undefined;
    const defaultProfile = profiles?.default as ProfileConfig | undefined;
    const sandboxProfile = profiles?.sandbox as SandboxProfileConfig | undefined;
    return {
      services: Array.isArray(parsed.services) ? parsed.services as ServiceConfig[] : DEFAULT_CONFIG.services,
      profiles: {
        default: defaultProfile?.name ? defaultProfile : DEFAULT_CONFIG.profiles.default,
        ...(sandboxProfile?.name && sandboxProfile?.image ? { sandbox: sandboxProfile } : {}),
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
