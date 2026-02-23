export interface ServiceStatus {
  name: string;
  port: number | null;
  running: boolean;
}

export interface WorktreeInfo {
  branch: string;
  agent: string;
  mux: string;
  path: string;
  dir: string | null;
  status: string;
  elapsed: string;
  title: string;
  profile: string | null;
  agentName: string | null;
  services: ServiceStatus[];
}

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

export interface AppConfig {
  services: ServiceConfig[];
  profiles: ProfileConfig[];
}
