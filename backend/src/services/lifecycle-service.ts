import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { ensureAgentRuntimeArtifacts, type AgentRuntimeArtifacts } from "../adapters/agent-runtime";
import type { GitGateway, GitWorktreeEntry } from "../adapters/git";
import {
  buildControlEnvMap,
  buildRuntimeEnvMap,
  getWorktreeStoragePaths,
  readWorktreeMeta,
  writeControlEnv,
  writeRuntimeEnv,
} from "../adapters/fs";
import { expandTemplate, isDockerProfile, type DockerProfileConfig } from "../adapters/config";
import { type DockerGateway } from "../adapters/docker";
import { buildProjectSessionName, buildWorktreeWindowName, type TmuxGateway } from "../adapters/tmux";
import type { AgentKind, ProfileConfig, ProjectConfig, RuntimeKind } from "../domain/config";
import type { WorktreeMeta } from "../domain/model";
import { allocateServicePorts, isValidBranchName, isValidEnvKey } from "../domain/policies";
import {
  buildAgentPaneCommand,
  buildDockerAgentPaneCommand,
  buildDockerShellCommand,
  buildManagedShellCommand,
} from "./agent-service";
import type { ReconciliationService } from "./reconciliation-service";
import { ensureSessionLayout, planSessionLayout } from "./session-service";
import {
  createManagedWorktree,
  initializeManagedWorktree,
  mergeManagedWorktree,
  removeManagedWorktree,
  type InitializeManagedWorktreeResult,
} from "./worktree-service";

function generateBranchName(): string {
  return `change-${randomUUID().slice(0, 8)}`;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stringifyStartupEnvValue(value: string | boolean): string {
  return typeof value === "boolean" ? String(value) : value;
}

interface ResolvedLifecycleWorktree {
  entry: GitWorktreeEntry;
  gitDir: string;
  meta: WorktreeMeta | null;
}

export interface LifecycleServiceDependencies {
  projectRoot: string;
  controlBaseUrl: string;
  getControlToken: () => Promise<string>;
  config: ProjectConfig;
  git: GitGateway;
  tmux: TmuxGateway;
  docker: DockerGateway;
  reconciliation: ReconciliationService;
}

export interface CreateLifecycleWorktreeInput {
  branch?: string;
  prompt?: string;
  profile?: string;
  agent?: AgentKind;
  envOverrides?: Record<string, string>;
}

export class LifecycleError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export class LifecycleService {
  constructor(private readonly deps: LifecycleServiceDependencies) {}

  async createWorktree(input: CreateLifecycleWorktreeInput): Promise<{
    branch: string;
    worktreeId: string;
  }> {
    const branch = this.resolveBranch(input.branch);
    this.ensureBranchAvailable(branch);

    const { profileName, profile } = this.resolveProfile(input.profile);
    const agent = this.resolveAgent(input.agent);
    const worktreePath = this.resolveWorktreePath(branch);
    let initialized: InitializeManagedWorktreeResult | null = null;

    try {
      await mkdir(dirname(worktreePath), { recursive: true });

      initialized = await createManagedWorktree(
        {
          repoRoot: this.deps.projectRoot,
          worktreePath,
          branch,
          baseBranch: this.deps.config.workspace.mainBranch,
          profile: profileName,
          agent,
          runtime: profile.runtime,
          startupEnvValues: await this.buildStartupEnvValues(input.envOverrides),
          allocatedPorts: await this.allocatePorts(),
          runtimeEnvExtras: { WEBMUX_WORKTREE_PATH: worktreePath },
          controlUrl: this.controlUrl(),
          controlToken: await this.deps.getControlToken(),
        },
        {
          git: this.deps.git,
        },
      );

      const artifacts = await ensureAgentRuntimeArtifacts({
        gitDir: initialized.paths.gitDir,
        worktreePath,
      });

      await this.materializeRuntimeSession({
        branch,
        profile,
        agent,
        initialized,
        artifacts,
        worktreePath,
        prompt: input.prompt,
      });

      await this.deps.reconciliation.reconcile(this.deps.projectRoot);

      return {
        branch,
        worktreeId: initialized.meta.worktreeId,
      };
    } catch (error) {
      if (initialized) {
        const cleanupError = await this.cleanupFailedCreate(branch, worktreePath, profile.runtime);
        if (cleanupError) {
          throw this.wrapOperationError(new Error(`${toErrorMessage(error)}; ${cleanupError}`));
        }
      }
      throw this.wrapOperationError(error);
    }
  }

  async openWorktree(branch: string): Promise<{
    branch: string;
    worktreeId: string;
  }> {
    try {
      const resolved = await this.resolveExistingWorktree(branch);
      const initialized = resolved.meta
        ? await this.refreshManagedArtifacts(resolved)
        : await this.initializeUnmanagedWorktree(resolved);
      const { profile } = this.resolveProfile(initialized.meta.profile);
      const artifacts = await ensureAgentRuntimeArtifacts({
        gitDir: initialized.paths.gitDir,
        worktreePath: resolved.entry.path,
      });

      await this.materializeRuntimeSession({
        branch,
        profile,
        agent: initialized.meta.agent,
        initialized,
        artifacts,
        worktreePath: resolved.entry.path,
      });

      await this.deps.reconciliation.reconcile(this.deps.projectRoot);

      return {
        branch,
        worktreeId: initialized.meta.worktreeId,
      };
    } catch (error) {
      throw this.wrapOperationError(error);
    }
  }

  async removeWorktree(branch: string): Promise<void> {
    try {
      const resolved = await this.resolveExistingWorktree(branch);
      this.ensureClean(resolved.entry);

      if (resolved.meta?.runtime === "docker") {
        await this.deps.docker.removeContainer(branch);
      }

      this.deps.tmux.killWindow(
        buildProjectSessionName(this.deps.projectRoot),
        buildWorktreeWindowName(branch),
      );
      removeManagedWorktree(
        {
          repoRoot: this.deps.projectRoot,
          worktreePath: resolved.entry.path,
          branch,
          force: true,
          deleteBranch: true,
          deleteBranchForce: true,
        },
        this.deps.git,
      );

      await this.deps.reconciliation.reconcile(this.deps.projectRoot);
    } catch (error) {
      throw this.wrapOperationError(error);
    }
  }

  async mergeWorktree(branch: string): Promise<void> {
    try {
      const resolved = await this.resolveExistingWorktree(branch);
      this.ensureClean(resolved.entry);

      mergeManagedWorktree(
        {
          repoRoot: this.deps.projectRoot,
          sourceBranch: branch,
          targetBranch: this.deps.config.workspace.mainBranch,
        },
        this.deps.git,
      );

      try {
        await this.removeWorktree(branch);
      } catch (error) {
        throw new LifecycleError(
          `Merged ${branch} into ${this.deps.config.workspace.mainBranch} but cleanup failed: ${toErrorMessage(error)}`,
          500,
        );
      }
    } catch (error) {
      throw this.wrapOperationError(error);
    }
  }

  private resolveBranch(rawBranch: string | undefined): string {
    const branch = rawBranch?.trim() || generateBranchName();
    if (!isValidBranchName(branch)) {
      throw new LifecycleError(`Invalid branch name: ${branch}`, 400);
    }
    return branch;
  }

  private ensureBranchAvailable(branch: string): void {
    const exists = this.listProjectWorktrees().some((entry) => entry.branch === branch);
    if (exists) {
      throw new LifecycleError(`Worktree already exists: ${branch}`, 409);
    }
  }

  private resolveProfile(profileName: string | undefined): {
    profileName: string;
    profile: ProfileConfig;
  } {
    const name = profileName ?? "default";
    const profile = this.deps.config.profiles[name];
    if (!profile) {
      throw new LifecycleError(`Unknown profile: ${name}`, 400);
    }
    return {
      profileName: name,
      profile,
    };
  }

  private resolveAgent(agent: AgentKind | undefined): AgentKind {
    if (!agent) return this.deps.config.workspace.defaultAgent;
    if (agent !== "claude" && agent !== "codex") {
      throw new LifecycleError(`Unknown agent: ${agent}`, 400);
    }
    return agent;
  }

  private async buildStartupEnvValues(
    envOverrides: Record<string, string> | undefined,
  ): Promise<Record<string, string>> {
    const startupEnvValues = Object.fromEntries(
      Object.entries(this.deps.config.startupEnvs).map(([key, value]) => [key, stringifyStartupEnvValue(value)]),
    );

    for (const [key, value] of Object.entries(envOverrides ?? {})) {
      if (!isValidEnvKey(key)) {
        throw new LifecycleError(`Invalid env override key: ${key}`, 400);
      }
      startupEnvValues[key] = value;
    }

    return startupEnvValues;
  }

  private async allocatePorts(): Promise<Record<string, number>> {
    const metas = await this.readManagedMetas();
    return allocateServicePorts(metas, this.deps.config.services);
  }

  private resolveWorktreePath(branch: string): string {
    return join(this.deps.projectRoot, this.deps.config.workspace.worktreeRoot, branch);
  }

  private listProjectWorktrees(): GitWorktreeEntry[] {
    const projectRoot = resolve(this.deps.projectRoot);
    return this.deps.git.listWorktrees(projectRoot).filter((entry) =>
      !entry.bare && resolve(entry.path) !== projectRoot
    );
  }

  private async readManagedMetas(): Promise<WorktreeMeta[]> {
    const metas = await Promise.all(
      this.listProjectWorktrees().map(async (entry) => {
        const gitDir = this.deps.git.resolveWorktreeGitDir(entry.path);
        return readWorktreeMeta(gitDir);
      }),
    );

    return metas.filter((meta): meta is WorktreeMeta => meta !== null);
  }

  private async resolveExistingWorktree(branch: string): Promise<ResolvedLifecycleWorktree> {
    const entry = this.listProjectWorktrees().find((candidate) => candidate.branch === branch);
    if (!entry) {
      throw new LifecycleError(`Worktree not found: ${branch}`, 404);
    }

    const gitDir = this.deps.git.resolveWorktreeGitDir(entry.path);
    const meta = await readWorktreeMeta(gitDir);
    return { entry, gitDir, meta };
  }

  private async initializeUnmanagedWorktree(
    resolved: ResolvedLifecycleWorktree,
  ): Promise<InitializeManagedWorktreeResult> {
    const { profileName, profile } = this.resolveProfile(undefined);

    return initializeManagedWorktree({
      gitDir: resolved.gitDir,
      branch: resolved.entry.branch ?? resolved.entry.path,
      profile: profileName,
      agent: this.deps.config.workspace.defaultAgent,
      runtime: profile.runtime,
      startupEnvValues: await this.buildStartupEnvValues(undefined),
      allocatedPorts: await this.allocatePorts(),
      runtimeEnvExtras: { WEBMUX_WORKTREE_PATH: resolved.entry.path },
      controlUrl: this.controlUrl(),
      controlToken: await this.deps.getControlToken(),
    });
  }

  private async refreshManagedArtifacts(
    resolved: ResolvedLifecycleWorktree,
  ): Promise<InitializeManagedWorktreeResult> {
    if (!resolved.meta) {
      throw new Error("Missing managed metadata");
    }

    const runtimeEnv = buildRuntimeEnvMap(resolved.meta, {
      WEBMUX_WORKTREE_PATH: resolved.entry.path,
    });
    await writeRuntimeEnv(resolved.gitDir, runtimeEnv);

    const controlEnv = buildControlEnvMap({
      controlUrl: this.controlUrl(),
      controlToken: await this.deps.getControlToken(),
      worktreeId: resolved.meta.worktreeId,
      branch: resolved.meta.branch,
    });
    await writeControlEnv(resolved.gitDir, controlEnv);

    return {
      meta: resolved.meta,
      paths: getWorktreeStoragePaths(resolved.gitDir),
      runtimeEnv,
      controlEnv,
    };
  }

  private async materializeRuntimeSession(input: {
    branch: string;
    profile: ProfileConfig;
    agent: AgentKind;
    initialized: InitializeManagedWorktreeResult;
    artifacts: AgentRuntimeArtifacts;
    worktreePath: string;
    prompt?: string;
  }): Promise<void> {
    if (input.profile.runtime === "docker") {
      const dockerProfile = this.requireDockerProfile(input.profile);
      const containerName = await this.deps.docker.launchContainer({
        branch: input.branch,
        wtDir: input.worktreePath,
        mainRepoDir: this.deps.projectRoot,
        sandboxConfig: dockerProfile,
        services: this.deps.config.services,
        runtimeEnv: input.initialized.runtimeEnv,
      });
      ensureSessionLayout(this.deps.tmux, this.buildSessionLayout({
        branch: input.branch,
        profile: input.profile,
        agent: input.agent,
        initialized: input.initialized,
        artifacts: input.artifacts,
        worktreePath: input.worktreePath,
        prompt: input.prompt,
        containerName,
      }));
      return;
    }

    ensureSessionLayout(this.deps.tmux, this.buildSessionLayout({
      branch: input.branch,
      profile: input.profile,
      agent: input.agent,
      initialized: input.initialized,
      artifacts: input.artifacts,
      worktreePath: input.worktreePath,
      prompt: input.prompt,
    }));
  }

  private buildSessionLayout(input: {
    branch: string;
    profile: ProfileConfig;
    agent: AgentKind;
    initialized: InitializeManagedWorktreeResult;
    artifacts: AgentRuntimeArtifacts;
    worktreePath: string;
    prompt?: string;
    containerName?: string;
  }) {
    const systemPrompt = input.profile.systemPrompt
      ? expandTemplate(input.profile.systemPrompt, input.initialized.runtimeEnv)
      : undefined;
    const containerName = input.containerName;

    return planSessionLayout(
      this.deps.projectRoot,
      input.branch,
      input.profile.panes,
      {
        repoRoot: this.deps.projectRoot,
        worktreePath: input.worktreePath,
        paneCommands: containerName
          ? {
              agent: buildDockerAgentPaneCommand({
                agent: input.agent,
                containerName,
                worktreePath: input.worktreePath,
                runtimeEnvPath: input.initialized.paths.runtimeEnvPath,
                agentCtlPath: input.artifacts.agentCtlPath,
                runtime: input.profile.runtime,
                systemPrompt,
                prompt: input.prompt,
              }),
              shell: buildDockerShellCommand(
                containerName,
                input.worktreePath,
                input.initialized.paths.runtimeEnvPath,
              ),
            }
          : {
              agent: buildAgentPaneCommand({
                agent: input.agent,
                runtimeEnvPath: input.initialized.paths.runtimeEnvPath,
                agentCtlPath: input.artifacts.agentCtlPath,
                runtime: input.profile.runtime,
                systemPrompt,
                prompt: input.prompt,
              }),
              shell: buildManagedShellCommand(input.initialized.paths.runtimeEnvPath),
        },
      },
    );
  }

  private requireDockerProfile(profile: ProfileConfig): DockerProfileConfig {
    if (!isDockerProfile(profile)) {
      throw new LifecycleError("Docker profile is missing an image", 422);
    }
    return profile;
  }

  private async cleanupFailedCreate(
    branch: string,
    worktreePath: string,
    runtime: RuntimeKind,
  ): Promise<string | null> {
    const cleanupErrors: string[] = [];

    if (runtime === "docker") {
      try {
        await this.deps.docker.removeContainer(branch);
      } catch (error) {
        cleanupErrors.push(`container cleanup failed: ${toErrorMessage(error)}`);
      }
    }

    try {
      this.deps.tmux.killWindow(
        buildProjectSessionName(this.deps.projectRoot),
        buildWorktreeWindowName(branch),
      );
    } catch (error) {
      cleanupErrors.push(`tmux cleanup failed: ${toErrorMessage(error)}`);
    }

    try {
      removeManagedWorktree(
        {
          repoRoot: this.deps.projectRoot,
          worktreePath,
          branch,
          force: true,
          deleteBranch: true,
          deleteBranchForce: true,
        },
        this.deps.git,
      );
    } catch (error) {
      cleanupErrors.push(`worktree cleanup failed: ${toErrorMessage(error)}`);
    }

    return cleanupErrors.length > 0 ? cleanupErrors.join("; ") : null;
  }

  private ensureClean(entry: GitWorktreeEntry): void {
    const status = this.deps.git.readWorktreeStatus(entry.path);
    if (status.dirty) {
      throw new LifecycleError(`Worktree has uncommitted changes: ${entry.branch ?? entry.path}`, 409);
    }
  }

  private controlUrl(): string {
    return `${this.deps.controlBaseUrl.replace(/\/+$/, "")}/api/runtime/events`;
  }

  private wrapOperationError(error: unknown): LifecycleError {
    if (error instanceof LifecycleError) {
      return error;
    }

    return new LifecycleError(toErrorMessage(error), 422);
  }
}
