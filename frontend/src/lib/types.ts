export interface ServiceStatus {
  name: string;
  port: number | null;
  running: boolean;
}

export interface CiCheck {
  name: string;
  status: string;
  url: string;
  runId: number;
}

export interface PrEntry {
  repo: string;
  number: number;
  state: string;
  url: string;
  ciStatus: string;
  ciChecks: CiCheck[];
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
  paneCount: number;
  prs: PrEntry[];
}

export interface ServiceConfig {
  name: string;
  portEnv: string;
}

export interface ProfileConfig {
  name: string;
  systemPrompt?: string;
}

export interface AppConfig {
  services: ServiceConfig[];
  profiles: {
    default: ProfileConfig;
    sandbox?: ProfileConfig;
  };
  autoName: boolean;
}
