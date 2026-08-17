export type AgentKind = "claude" | "codex";
/** Which multiplexer backs a project's panes. `tmux` is the default; `herdr`
 *  drives herdr's local socket API instead (see adapters/herdr.ts). */
export type MultiplexerKind = "tmux" | "herdr";
export type AgentId = string;
export type RuntimeKind = "host" | "docker";

export interface CustomAgentConfig {
  label: string;
  startCommand: string;
  resumeCommand?: string;
}
export type PaneKind = "agent" | "shell" | "command";
export type PaneSplit = "right" | "bottom";

export interface AutoPullConfig {
  enabled: boolean;
  intervalSeconds: number;
}

export interface WorkspaceConfig {
  mainBranch: string;
  worktreeRoot: string;
  defaultAgent: AgentKind;
  autoPull: AutoPullConfig;
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
  autoRemoveOnMerge: boolean;
}

export interface LinearIntegrationConfig {
  enabled: boolean;
  autoCreateWorktrees: boolean;
  createTicketOption: boolean;
  /** Restrict the auto-create watcher to issues from these team keys (e.g. ["ENG", "OPS"]).
   *  When unset, all teams the authenticated user is assigned in are watched. */
  watchTeams?: string[];
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

export interface OneshotConfig {
  systemPrompt: string;
}

export interface ProjectConfig {
  name: string;
  /** Which multiplexer backs this project's panes. Defaults to tmux. */
  multiplexer: MultiplexerKind;
  workspace: WorkspaceConfig;
  profiles: Record<string, ProfileConfig>;
  agents: Record<AgentId, CustomAgentConfig>;
  services: ServiceSpec[];
  startupEnvs: Record<string, string | boolean>;
  integrations: IntegrationConfig;
  lifecycleHooks: LifecycleHooksConfig;
  autoName: AutoNameConfig | null;
  oneshot: OneshotConfig;
}
