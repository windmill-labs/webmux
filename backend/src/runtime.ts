import { loadConfig, projectRoot, type ProjectConfig } from "./adapters/config";
import { loadControlToken } from "./adapters/control-token";
import { BunDockerGateway } from "./adapters/docker";
import { BunGitGateway } from "./adapters/git";
import { BunLifecycleHookRunner } from "./adapters/hooks";
import { BunPortProbe } from "./adapters/port-probe";
import { BunTmuxGateway } from "./adapters/tmux";
import { AutoNameService } from "./services/auto-name-service";
import { LifecycleService } from "./services/lifecycle-service";
import { NotificationService as RuntimeNotificationService } from "./services/notification-service";
import { ProjectRuntime } from "./services/project-runtime";
import { ReconciliationService } from "./services/reconciliation-service";
import { WorktreeCreationTracker } from "./services/worktree-creation-service";

export interface WebmuxRuntimeOptions {
  projectDir?: string;
  port?: number;
}

export interface WebmuxRuntime {
  port: number;
  projectDir: string;
  config: ProjectConfig;
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
  const projectDir = projectRoot(options.projectDir ?? Bun.env.WEBMUX_PROJECT_DIR ?? process.cwd());
  const config = loadConfig(projectDir);
  const git = new BunGitGateway();
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
    controlBaseUrl: `http://127.0.0.1:${port}`,
    getControlToken: loadControlToken,
    config,
    git,
    tmux,
    docker,
    reconciliation: reconciliationService,
    hooks,
    autoName,
    onCreateProgress: (progress) => {
      worktreeCreationTracker.set(progress);
    },
    onCreateFinished: (branch) => {
      worktreeCreationTracker.clear(branch);
    },
  });

  return {
    port,
    projectDir,
    config,
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
