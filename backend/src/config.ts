import { join } from "node:path";

export interface ServiceConfig {
  name: string;
  portEnv: string;
}

export interface ProfileConfig {
  name: string;
  panes: string[];
  sandbox?: boolean;
  systemPrompt?: string;
}

export interface WmdevConfig {
  services: ServiceConfig[];
  profiles: ProfileConfig[];
}

const DEFAULT_CONFIG: WmdevConfig = {
  services: [],
  profiles: [{ name: "Full", panes: [] }],
};

/** Load .wmdev.json from a directory, merging with defaults. */
export function loadConfig(dir: string): WmdevConfig {
  try {
    const filePath = join(dir, ".wmdev.json");
    const file = Bun.file(filePath);
    // Bun.file().json() is async; use spawnSync + JSON.parse for sync loading at startup
    const result = Bun.spawnSync(["cat", filePath], { stdout: "pipe" });
    const text = new TextDecoder().decode(result.stdout).trim();
    if (!text) return DEFAULT_CONFIG;
    const parsed = JSON.parse(text) as Partial<WmdevConfig>;
    return {
      services: Array.isArray(parsed.services) ? parsed.services : DEFAULT_CONFIG.services,
      profiles: Array.isArray(parsed.profiles) && parsed.profiles.length > 0
        ? parsed.profiles
        : DEFAULT_CONFIG.profiles,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

/** Expand ${VAR} placeholders in a template string using an env map. */
export function expandTemplate(template: string, env: Record<string, string>): string {
  return template.replace(/\$\{(\w+)\}/g, (_, key: string) => env[key] ?? "");
}
