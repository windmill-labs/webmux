export type AgentKind = "claude" | "codex";
export type RuntimeKind = "host" | "docker";
export type PaneKind = "agent" | "shell" | "command";
export type PaneSplit = "right" | "bottom";

export interface WorkspaceConfig {
  mainBranch: string;
  worktreeRoot: string;
  defaultAgent: AgentKind;
}

export interface PaneTemplate {
  id: string;
  kind: PaneKind;
  split?: PaneSplit;
  sizePct?: number;
  focus?: boolean;
  command?: string;
  cwd?: "worktree" | "repo";
  workingDir?: string;
}

export interface MountSpec {
  hostPath: string;
  guestPath?: string;
  writable?: boolean;
}

export interface ProfileConfig {
  runtime: RuntimeKind;
  systemPrompt?: string;
  envPassthrough: string[];
  yolo?: boolean;
  panes: PaneTemplate[];
  image?: string;
  mounts?: MountSpec[];
}

export interface ServiceSpec {
  name: string;
  portEnv: string;
  portStart?: number;
  portStep?: number;
  urlTemplate?: string;
}

export interface LinkedRepoConfig {
  repo: string;
  alias: string;
  dir?: string;
}

export interface GitHubIntegrationConfig {
  linkedRepos: LinkedRepoConfig[];
}

export interface LinearIntegrationConfig {
  enabled: boolean;
  autoCreateWorktrees: boolean;
  createTicketOption: boolean;
  teamId?: string;
}

export interface IntegrationConfig {
  github: GitHubIntegrationConfig;
  linear: LinearIntegrationConfig;
}

export interface LifecycleHooksConfig {
  postCreate?: string;
  preRemove?: string;
}

export interface AutoNameConfig {
  provider: "claude" | "codex";
  model?: string;
  systemPrompt?: string;
}

export interface ProjectConfig {
  name: string;
  workspace: WorkspaceConfig;
  profiles: Record<string, ProfileConfig>;
  services: ServiceSpec[];
  startupEnvs: Record<string, string | boolean>;
  integrations: IntegrationConfig;
  lifecycleHooks: LifecycleHooksConfig;
  autoName: AutoNameConfig | null;
}
