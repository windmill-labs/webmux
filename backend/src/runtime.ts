import { loadConfig, projectRoot, type ProjectConfig } from "./adapters/config";
import { loadControlToken } from "./adapters/control-token";
import { BunDockerGateway } from "./adapters/docker";
import { BunGitGateway } from "./adapters/git";
import { BunLifecycleHookRunner } from "./adapters/hooks";
import { BunPortProbe } from "./adapters/port-probe";
import { BunTmuxGateway } from "./adapters/tmux";
import { FileSessionDiscovery } from "./adapters/session-discovery";
import { AutoNameService } from "./services/auto-name-service";
import { ArchiveStateService } from "./services/archive-state-service";
import { LifecycleService, type CreateWorktreeProgress } from "./services/lifecycle-service";
import { NotificationService as RuntimeNotificationService } from "./services/notification-service";
import { ProjectRuntime } from "./services/project-runtime";
import { ReconciliationService } from "./services/reconciliation-service";
import { WorktreeCreationTracker } from "./services/worktree-creation-service";

export interface WebmuxRuntimeOptions {
  projectDir?: string;
  port?: number;
  /** URL-path prefix the server mounts this project's routes under. Agent hooks
   *  POST status events to the control URL, which must carry the same prefix or
   *  the events fall through to the SPA and Claude's status never updates. */
  prefix?: string;
  onCreateProgress?: (progress: CreateWorktreeProgress) => void | Promise<void>;
}

/** Base URL agent hooks POST runtime events to. The server serves each project
 *  under `/${prefix}` (see server.ts buildServeRoutes), so the control URL must
 *  include the prefix to hit the project's `/api/runtime/events` route.
 *
 *  `undefined` prefix means control reporting is not configured (the CLI passes
 *  it when it can't resolve a prefix — no server running). We return undefined
 *  rather than an unprefixed URL so no control.env is written and the agent's
 *  hooks no-op cleanly instead of POSTing to an unrouted path. */
export function buildControlBaseUrl(port: number, prefix: string | undefined): string | undefined {
  if (prefix === undefined) return undefined;
  return prefix ? `http://127.0.0.1:${port}/${prefix}` : `http://127.0.0.1:${port}`;
}

export interface WebmuxRuntime {
  port: number;
  projectDir: string;
  config: ProjectConfig;
  archiveStateService: ArchiveStateService;
  git: BunGitGateway;
  portProbe: BunPortProbe;
  tmux: BunTmuxGateway;
  docker: BunDockerGateway;
  hooks: BunLifecycleHookRunner;
  autoName: AutoNameService;
  projectRuntime: ProjectRuntime;
  worktreeCreationTracker: WorktreeCreationTracker;
  runtimeNotifications: RuntimeNotificationService;
  reconciliationService: ReconciliationService;
  lifecycleService: LifecycleService;
}

export function createWebmuxRuntime(options: WebmuxRuntimeOptions = {}): WebmuxRuntime {
  const port = options.port ?? parseInt(Bun.env.PORT || "5111", 10);
  // ProjectManager (the only server-side caller) always passes an explicit
  // projectDir; cwd is just the default for direct/CLI/test calls.
  const projectDir = projectRoot(options.projectDir ?? process.cwd());
  const config = loadConfig(projectDir, { resolvedRoot: true });
  const git = new BunGitGateway();
  const archiveStateService = new ArchiveStateService(git.resolveWorktreeGitDir(projectDir));
  const portProbe = new BunPortProbe();
  const tmux = new BunTmuxGateway();
  const docker = new BunDockerGateway();
  const hooks = new BunLifecycleHookRunner();
  const autoName = new AutoNameService();
  const projectRuntime = new ProjectRuntime();
  const worktreeCreationTracker = new WorktreeCreationTracker();
  const runtimeNotifications = new RuntimeNotificationService();
  const reconciliationService = new ReconciliationService({
    config,
    git,
    tmux,
    portProbe,
    runtime: projectRuntime,
  });
  const lifecycleService = new LifecycleService({
    projectRoot: projectDir,
    controlBaseUrl: buildControlBaseUrl(port, options.prefix),
    getControlToken: loadControlToken,
    config,
    archiveState: archiveStateService,
    git,
    tmux,
    sessionDiscovery: new FileSessionDiscovery(),
    docker,
    reconciliation: reconciliationService,
    hooks,
    autoName,
    onCreateProgress: (progress) => {
      worktreeCreationTracker.set(progress);
      options.onCreateProgress?.(progress);
    },
    onCreateFinished: (branch) => {
      worktreeCreationTracker.clear(branch);
    },
  });

  return {
    port,
    projectDir,
    config,
    archiveStateService,
    git,
    portProbe,
    tmux,
    docker,
    hooks,
    autoName,
    projectRuntime,
    worktreeCreationTracker,
    runtimeNotifications,
    reconciliationService,
    lifecycleService,
  };
}
