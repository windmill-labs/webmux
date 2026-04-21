import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { ensureAgentRuntimeArtifacts } from "../adapters/agent-runtime";
import type { CreateWorktreeMode, GitGateway, GitWorktreeEntry } from "../adapters/git";
import type { LifecycleHookRunner, RunLifecycleHookInput } from "../adapters/hooks";
import {
  buildControlEnvMap,
  buildRuntimeEnvMap,
  getWorktreeStoragePaths,
  loadDotenvLocal,
  readWorktreeMeta,
  writeControlEnv,
  writeRuntimeEnv,
} from "../adapters/fs";
import { expandTemplate, getDefaultProfileName, isDockerProfile, type DockerProfileConfig } from "../adapters/config";
import { type DockerGateway } from "../adapters/docker";
import { buildProjectSessionName, buildWorktreeWindowName, type TmuxGateway } from "../adapters/tmux";
import type { AgentId, CreateWorktreeAgentSelection, ProfileConfig, ProjectConfig, RuntimeKind } from "../domain/config";
import type { WorktreeCreationPhase, WorktreeMeta } from "../domain/model";
import { allocateServicePorts, isValidBranchName, isValidEnvKey } from "../domain/policies";
import type { AutoNameGenerator } from "./auto-name-service";
import {
  type AgentLaunchMode,
  buildAgentPaneCommand,
  buildDockerAgentPaneCommand,
  buildDockerShellCommand,
  buildManagedShellCommand,
} from "./agent-service";
import { getAgentDefinition, type AgentDefinition } from "./agent-registry";
import type { ReconciliationService } from "./reconciliation-service";
import { ensureSessionLayout, planSessionLayout } from "./session-service";
import { ArchiveStateService } from "./archive-state-service";
import {
  createManagedWorktree,
  initializeManagedWorktree,
  mergeManagedWorktree,
  removeManagedWorktree,
  type InitializeManagedWorktreeResult,
} from "./worktree-service";
import { log } from "../lib/log";
import { generateFallbackBranchName } from "../lib/branch-name";

const DOCKER_CONTROL_HOST = "host.docker.internal";

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stringifyStartupEnvValue(value: string | boolean): string {
  return typeof value === "boolean" ? String(value) : value;
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "127.0.0.1"
    || hostname === "localhost"
    || hostname === "::1"
    || hostname === "[::1]";
}

function buildRuntimeControlBaseUrl(controlBaseUrl: string, runtime: RuntimeKind): string {
  const trimmed = trimTrailingSlashes(controlBaseUrl);
  if (runtime !== "docker") return trimmed;

  try {
    const url = new URL(trimmed);
    if (isLoopbackHostname(url.hostname)) {
      url.hostname = DOCKER_CONTROL_HOST;
    }
    return trimTrailingSlashes(url.toString());
  } catch {
    return trimmed;
  }
}

export interface CreateWorktreeTarget {
  branch: string;
  agent: AgentId;
}

export function prefixAgentBranch(agent: AgentId, branch: string): string {
  return `${agent}-${branch}`;
}

export function buildCreateWorktreeTargets(
  branch: string,
  agentSelection: CreateWorktreeAgentSelection,
): CreateWorktreeTarget[] {
  if (agentSelection === "both") {
    return [
      { branch: prefixAgentBranch("claude", branch), agent: "claude" },
      { branch: prefixAgentBranch("codex", branch), agent: "codex" },
    ];
  }

  return [{ branch, agent: agentSelection }];
}

interface ResolvedLifecycleWorktree {
  entry: GitWorktreeEntry;
  gitDir: string;
  meta: WorktreeMeta | null;
}

export interface CreateWorktreeProgress {
  branch: string;
  baseBranch?: string;
  path: string;
  profile: string;
  agent: AgentId;
  phase: WorktreeCreationPhase;
}

export interface LifecycleServiceDependencies {
  projectRoot: string;
  controlBaseUrl: string;
  getControlToken: () => Promise<string>;
  config: ProjectConfig;
  archiveState: ArchiveStateService;
  git: GitGateway;
  tmux: TmuxGateway;
  docker: DockerGateway;
  reconciliation: ReconciliationService;
  hooks: LifecycleHookRunner;
  autoName: AutoNameGenerator;
  onCreateProgress?: (progress: CreateWorktreeProgress) => void | Promise<void>;
  onCreateFinished?: (branch: string) => void | Promise<void>;
}

export interface CreateLifecycleWorktreeInput {
  mode?: CreateWorktreeMode;
  branch?: string;
  baseBranch?: string;
  prompt?: string;
  profile?: string;
  agent?: AgentId;
  envOverrides?: Record<string, string>;
}

export interface CreateLifecycleWorktreesInput extends Omit<CreateLifecycleWorktreeInput, "agent"> {
  agent?: CreateWorktreeAgentSelection;
}

export interface CreateLifecycleWorktreesResult {
  primaryBranch: string;
  branches: string[];
}

interface ResolvedCreateLifecycleWorktreeInput extends Omit<CreateLifecycleWorktreeInput, "mode" | "branch" | "agent"> {
  mode: CreateWorktreeMode;
  branch: string;
  agent: AgentId;
}

export interface PruneWorktreesResult {
  removedBranches: string[];
}

export interface ListAvailableBranchesOptions {
  includeRemote?: boolean;
}

interface ExistingBranchResolution {
  startPoint?: string;
  deleteBranchOnRollback: boolean;
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

  async createWorktrees(input: CreateLifecycleWorktreesInput): Promise<CreateLifecycleWorktreesResult> {
    const mode = input.mode ?? "new";
    const agentSelection = input.agent ?? this.deps.config.workspace.defaultAgent;
    if (agentSelection === "both" && mode === "existing") {
      throw new LifecycleError("Creating both agents is only supported for new worktrees", 400);
    }

    const branch = await this.resolveBranch(input.branch, input.prompt, mode);
    const targets = buildCreateWorktreeTargets(branch, agentSelection);
    const createdBranches: string[] = [];

    try {
      for (const target of targets) {
        const created = await this.createResolvedWorktree({
          ...input,
          mode,
          branch: target.branch,
          agent: target.agent,
        });
        createdBranches.push(created.branch);
      }
    } catch (error) {
      const rollbackError = await this.rollbackCreatedWorktrees(createdBranches);
      if (rollbackError) {
        throw this.wrapOperationError(new Error(`${toErrorMessage(error)}; ${rollbackError}`));
      }
      throw this.wrapOperationError(error);
    }

    return {
      primaryBranch: createdBranches[0],
      branches: createdBranches,
    };
  }

  async createWorktree(input: CreateLifecycleWorktreeInput): Promise<{
    branch: string;
    worktreeId: string;
  }> {
    const mode = input.mode ?? "new";
    const branch = await this.resolveBranch(input.branch, input.prompt, mode);
    const agent = this.resolveAgentDefinition(input.agent);
    return await this.createResolvedWorktree({
      ...input,
      mode,
      branch,
      agent: agent.id,
    });
  }

  async openWorktree(branch: string): Promise<{
    branch: string;
    worktreeId: string;
  }> {
    try {
      const resolved = await this.resolveExistingWorktree(branch);
      const launchMode: AgentLaunchMode = resolved.meta ? "resume" : "fresh";
      const initialized = resolved.meta
        ? await this.refreshManagedArtifacts(resolved)
        : await this.initializeUnmanagedWorktree(resolved);
      const { profileName, profile } = this.resolveProfile(initialized.meta.profile);
      const agent = this.resolveAgentDefinition(initialized.meta.agent);
      await ensureAgentRuntimeArtifacts({
        gitDir: initialized.paths.gitDir,
        worktreePath: resolved.entry.path,
      });

      await this.materializeRuntimeSession({
        branch,
        profileName,
        profile,
        agent,
        initialized,
        worktreePath: resolved.entry.path,
        launchMode,
      });

      await this.deps.reconciliation.reconcile(this.deps.projectRoot, { force: true });

      return {
        branch,
        worktreeId: initialized.meta.worktreeId,
      };
    } catch (error) {
      throw this.wrapOperationError(error);
    }
  }

  async closeWorktree(branch: string): Promise<void> {
    try {
      await this.resolveExistingWorktree(branch);
      await this.closeBranchWindow(branch);
    } catch (error) {
      throw this.wrapOperationError(error);
    }
  }

  async removeWorktree(branch: string): Promise<void> {
    try {
      const resolved = await this.resolveExistingWorktree(branch);
      await this.removeResolvedWorktree(resolved);
    } catch (error) {
      throw this.wrapOperationError(error);
    }
  }

  async pruneWorktrees(): Promise<PruneWorktreesResult> {
    try {
      const resolvedWorktrees = await this.resolveAllWorktrees();
      const removedBranches: string[] = [];

      for (const resolved of resolvedWorktrees) {
        const branch = resolved.entry.branch ?? resolved.entry.path;
        await this.removeResolvedWorktree(resolved);
        removedBranches.push(branch);
      }

      return { removedBranches };
    } catch (error) {
      throw this.wrapOperationError(error);
    }
  }

  async mergeWorktree(branch: string): Promise<void> {
    try {
      const resolved = await this.resolveExistingWorktree(branch);
      this.ensureNoUncommittedChanges(resolved.entry);

      mergeManagedWorktree(
        {
          repoRoot: this.deps.projectRoot,
          sourceBranch: branch,
          targetBranch: this.deps.config.workspace.mainBranch,
        },
        this.deps.git,
      );

      try {
        await this.removeResolvedWorktree(resolved);
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

  async setWorktreeArchived(branch: string, archived: boolean): Promise<void> {
    try {
      const resolved = await this.resolveExistingWorktree(branch);
      if (archived) {
        await this.closeBranchWindow(branch);
      }
      await this.updateWorktreeArchivedState(resolved.entry.path, archived);
    } catch (error) {
      throw this.wrapOperationError(error);
    }
  }

  listAvailableBranches(options: ListAvailableBranchesOptions = {}): Array<{ name: string }> {
    const localBranches = this.listLocalBranches().filter((branch) => isValidBranchName(branch));
    const remoteBranches = options.includeRemote
      ? this.listRemoteBranches().filter((branch) => isValidBranchName(branch))
      : [];
    const checkedOutBranches = this.listCheckedOutBranches();

    const allBranches = [...new Set([...localBranches, ...remoteBranches])];

    return allBranches
      .filter((branch) => !checkedOutBranches.has(branch))
      .sort((left, right) => left.localeCompare(right))
      .map((name) => ({ name }));
  }

  listBaseBranches(): Array<{ name: string }> {
    return this.listLocalBranches()
      .filter((branch) => isValidBranchName(branch))
      .sort((left, right) => left.localeCompare(right))
      .map((name) => ({ name }));
  }

  private async resolveBranch(
    rawBranch: string | undefined,
    prompt: string | undefined,
    mode: CreateWorktreeMode,
  ): Promise<string> {
    const explicitBranch = rawBranch?.trim();
    const branch = mode === "existing"
      ? explicitBranch
      : explicitBranch || await this.generateAutoName(prompt) || generateFallbackBranchName();
    if (!branch) {
      throw new LifecycleError("Existing branch is required", 400);
    }
    if (!isValidBranchName(branch)) {
      throw new LifecycleError(`Invalid branch name: ${branch}`, 400);
    }
    return branch;
  }

  private async generateAutoName(prompt: string | undefined): Promise<string | null> {
    if (!this.deps.config.autoName || !prompt?.trim()) {
      return null;
    }
    return await this.deps.autoName.generateBranchName(this.deps.config.autoName, prompt);
  }

  private resolveBranchAvailability(branch: string, mode: CreateWorktreeMode): ExistingBranchResolution {
    const localBranches = new Set(this.listLocalBranches());
    if (mode === "new") {
      if (localBranches.has(branch)) {
        throw new LifecycleError(`Branch already exists: ${branch}`, 409);
      }
      return { deleteBranchOnRollback: false };
    }

    if (localBranches.has(branch)) {
      if (this.listCheckedOutBranches().has(branch)) {
        throw new LifecycleError(`Branch already has a worktree: ${branch}`, 409);
      }
      return { deleteBranchOnRollback: false };
    }

    const remoteBranches = new Set(this.listRemoteBranches());
    if (!remoteBranches.has(branch)) {
      throw new LifecycleError(`Branch not found: ${branch}`, 404);
    }

    return {
      startPoint: `origin/${branch}`,
      deleteBranchOnRollback: true,
    };
  }

  private resolveProfile(profileName: string | undefined): {
    profileName: string;
    profile: ProfileConfig;
  } {
    const name = profileName ?? getDefaultProfileName(this.deps.config);
    const profile = this.deps.config.profiles[name];
    if (!profile) {
      throw new LifecycleError(`Unknown profile: ${name}`, 400);
    }
    return {
      profileName: name,
      profile,
    };
  }

  private resolveAgentDefinition(agentId: AgentId | undefined): AgentDefinition {
    const resolvedAgentId = agentId ?? this.deps.config.workspace.defaultAgent;
    const agent = getAgentDefinition(this.deps.config, resolvedAgentId);
    if (!agent) {
      throw new LifecycleError(`Unknown agent: ${resolvedAgentId}`, 400);
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
    return resolve(this.deps.projectRoot, this.deps.config.workspace.worktreeRoot, branch);
  }

  private listLocalBranches(): string[] {
    return this.deps.git.listLocalBranches(resolve(this.deps.projectRoot));
  }

  private listRemoteBranches(): string[] {
    return this.deps.git.listRemoteBranches(resolve(this.deps.projectRoot));
  }

  private listCheckedOutBranches(): Set<string> {
    return new Set(
      this.deps.git.listWorktrees(resolve(this.deps.projectRoot))
        .filter((entry): entry is GitWorktreeEntry & { branch: string } => !entry.bare && entry.branch !== null)
        .map((entry) => entry.branch),
    );
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

  private async resolveAllWorktrees(): Promise<ResolvedLifecycleWorktree[]> {
    const entries = this.listProjectWorktrees().sort((left, right) =>
      (left.branch ?? left.path).localeCompare(right.branch ?? right.path)
    );

    return await Promise.all(entries.map(async (entry) => {
      const gitDir = this.deps.git.resolveWorktreeGitDir(entry.path);
      const meta = await readWorktreeMeta(gitDir);
      return { entry, gitDir, meta };
    }));
  }

  private async initializeUnmanagedWorktree(
    resolved: ResolvedLifecycleWorktree,
  ): Promise<InitializeManagedWorktreeResult> {
    const { profileName, profile } = this.resolveProfile(undefined);

    const dotenvValues = await loadDotenvLocal(resolved.entry.path);
    return initializeManagedWorktree({
      gitDir: resolved.gitDir,
      branch: resolved.entry.branch ?? resolved.entry.path,
      profile: profileName,
      agent: this.deps.config.workspace.defaultAgent,
      runtime: profile.runtime,
      startupEnvValues: await this.buildStartupEnvValues(undefined),
      allocatedPorts: await this.allocatePorts(),
      runtimeEnvExtras: { WEBMUX_WORKTREE_PATH: resolved.entry.path },
      dotenvValues,
      controlUrl: this.controlUrl(profile.runtime),
      controlToken: await this.deps.getControlToken(),
    });
  }

  private async refreshManagedArtifacts(
    resolved: ResolvedLifecycleWorktree,
  ): Promise<InitializeManagedWorktreeResult> {
    if (!resolved.meta) {
      throw new Error("Missing managed metadata");
    }

    return await this.refreshManagedArtifactsFromMeta({
      gitDir: resolved.gitDir,
      meta: resolved.meta,
      worktreePath: resolved.entry.path,
    });
  }

  private async refreshManagedArtifactsFromMeta(input: {
    gitDir: string;
    meta: WorktreeMeta;
    worktreePath: string;
  }): Promise<InitializeManagedWorktreeResult> {
    const dotenvValues = await loadDotenvLocal(input.worktreePath);
    const runtimeEnv = buildRuntimeEnvMap(input.meta, {
      WEBMUX_WORKTREE_PATH: input.worktreePath,
    }, dotenvValues);
    await writeRuntimeEnv(input.gitDir, runtimeEnv);

    const controlEnv = buildControlEnvMap({
      controlUrl: this.controlUrl(input.meta.runtime),
      controlToken: await this.deps.getControlToken(),
      worktreeId: input.meta.worktreeId,
      branch: input.meta.branch,
    });
    await writeControlEnv(input.gitDir, controlEnv);

    return {
      meta: input.meta,
      paths: getWorktreeStoragePaths(input.gitDir),
      runtimeEnv,
      controlEnv,
    };
  }

  private async updateWorktreeArchivedState(path: string, archived: boolean): Promise<void> {
    await this.deps.archiveState.setArchived(path, archived);
  }

  private async closeBranchWindow(branch: string): Promise<void> {
    this.deps.tmux.killWindow(
      buildProjectSessionName(this.deps.projectRoot),
      buildWorktreeWindowName(branch),
    );
    await this.deps.reconciliation.reconcile(this.deps.projectRoot, { force: true });
  }

  private async materializeRuntimeSession(input: {
    branch: string;
    profileName: string;
    profile: ProfileConfig;
    agent: AgentDefinition;
    initialized: InitializeManagedWorktreeResult;
    worktreePath: string;
    prompt?: string;
    launchMode: AgentLaunchMode;
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
        profileName: input.profileName,
        profile: input.profile,
        agent: input.agent,
        initialized: input.initialized,
        worktreePath: input.worktreePath,
        prompt: input.prompt,
        launchMode: input.launchMode,
        containerName,
      }));
      return;
    }

    ensureSessionLayout(this.deps.tmux, this.buildSessionLayout({
      branch: input.branch,
      profileName: input.profileName,
      profile: input.profile,
      agent: input.agent,
      initialized: input.initialized,
      worktreePath: input.worktreePath,
      prompt: input.prompt,
      launchMode: input.launchMode,
    }));
  }

  private buildSessionLayout(input: {
    branch: string;
    profileName: string;
    profile: ProfileConfig;
    agent: AgentDefinition;
    initialized: InitializeManagedWorktreeResult;
    worktreePath: string;
    prompt?: string;
    launchMode: AgentLaunchMode;
    containerName?: string;
  }) {
    const systemPrompt = input.launchMode === "fresh" && input.profile.systemPrompt
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
                runtimeEnvPath: input.initialized.paths.runtimeEnvPath,
                repoRoot: this.deps.projectRoot,
                worktreePath: input.worktreePath,
                branch: input.branch,
                profileName: input.profileName,
                yolo: input.profile.yolo === true,
                systemPrompt,
                prompt: input.launchMode === "fresh" ? input.prompt : undefined,
                launchMode: input.launchMode,
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
                repoRoot: this.deps.projectRoot,
                worktreePath: input.worktreePath,
                branch: input.branch,
                profileName: input.profileName,
                yolo: input.profile.yolo === true,
                systemPrompt,
                prompt: input.launchMode === "fresh" ? input.prompt : undefined,
                launchMode: input.launchMode,
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
    deleteBranch: boolean,
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
          deleteBranch,
          deleteBranchForce: deleteBranch,
        },
        this.deps.git,
      );
    } catch (error) {
      cleanupErrors.push(`worktree cleanup failed: ${toErrorMessage(error)}`);
    }

    return cleanupErrors.length > 0 ? cleanupErrors.join("; ") : null;
  }

  private ensureNoUncommittedChanges(entry: GitWorktreeEntry): void {
    const status = this.deps.git.readWorktreeStatus(entry.path);
    if (status.dirty) {
      throw new LifecycleError(`Worktree has uncommitted changes: ${entry.branch ?? entry.path}`, 409);
    }
  }

  private controlUrl(runtime: RuntimeKind): string {
    return `${buildRuntimeControlBaseUrl(this.deps.controlBaseUrl, runtime)}/api/runtime/events`;
  }

  private async removeResolvedWorktree(
    resolved: ResolvedLifecycleWorktree,
  ): Promise<void> {
    await this.runLifecycleHook({
      name: "preRemove",
      command: this.deps.config.lifecycleHooks.preRemove,
      meta: resolved.meta,
      worktreePath: resolved.entry.path,
    });

    const branch = resolved.entry.branch ?? resolved.entry.path;
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
    await this.updateWorktreeArchivedState(resolved.entry.path, false);

    await this.deps.reconciliation.reconcile(this.deps.projectRoot, { force: true });
  }

  private async runLifecycleHook(input: {
    name: RunLifecycleHookInput["name"];
    command: string | undefined;
    meta: WorktreeMeta | null;
    worktreePath: string;
  }): Promise<void> {
    log.debug(`[lifecycle-hook] name=${input.name} command=${input.command ?? "UNDEFINED"} meta=${input.meta ? "present" : "NULL"} cwd=${input.worktreePath}`);
    if (!input.command || !input.meta) {
      log.debug(`[lifecycle-hook] SKIPPING ${input.name}: command=${!!input.command} meta=${!!input.meta}`);
      return;
    }

    log.debug(`[lifecycle-hook] RUNNING ${input.name}: ${input.command} in ${input.worktreePath}`);
    const dotenvValues = await loadDotenvLocal(input.worktreePath);
    await this.deps.hooks.run({
      name: input.name,
      command: input.command,
      cwd: input.worktreePath,
      env: buildRuntimeEnvMap(input.meta, {
        WEBMUX_WORKTREE_PATH: input.worktreePath,
      }, dotenvValues),
    });
    log.debug(`[lifecycle-hook] COMPLETED ${input.name}`);
  }

  private async reportCreateProgress(progress: CreateWorktreeProgress): Promise<void> {
    await this.deps.onCreateProgress?.(progress);
  }

  private async finishCreateProgress(branch: string): Promise<void> {
    await this.deps.onCreateFinished?.(branch);
  }

  private async rollbackCreatedWorktrees(branches: string[]): Promise<string | null> {
    const cleanupErrors: string[] = [];

    for (const branch of [...branches].reverse()) {
      try {
        await this.removeWorktree(branch);
      } catch (error) {
        cleanupErrors.push(`rollback failed for ${branch}: ${toErrorMessage(error)}`);
      }
    }

    return cleanupErrors.length > 0 ? cleanupErrors.join("; ") : null;
  }

  private async createResolvedWorktree(input: ResolvedCreateLifecycleWorktreeInput): Promise<{
    branch: string;
    worktreeId: string;
  }> {
    const requestedBaseBranch = input.baseBranch?.trim();
    if (requestedBaseBranch && !isValidBranchName(requestedBaseBranch)) {
      throw new LifecycleError("Invalid base branch name", 400);
    }
    if (requestedBaseBranch && input.mode === "existing") {
      throw new LifecycleError("Base branch is only supported for new worktrees", 400);
    }
    if (requestedBaseBranch && requestedBaseBranch === input.branch) {
      throw new LifecycleError("Base branch must differ from branch name", 400);
    }

    const baseBranch = input.mode === "new" ? (requestedBaseBranch || this.deps.config.workspace.mainBranch) : undefined;
    const branchAvailability = this.resolveBranchAvailability(input.branch, input.mode);
    const { profileName, profile } = this.resolveProfile(input.profile);
    const agent = this.resolveAgentDefinition(input.agent);
    const worktreePath = this.resolveWorktreePath(input.branch);
    const createProgressBase = {
      branch: input.branch,
      ...(baseBranch ? { baseBranch } : {}),
      path: worktreePath,
      profile: profileName,
      agent: input.agent,
    } satisfies Omit<CreateWorktreeProgress, "phase">;
    const deleteBranchOnRollback = input.mode === "new" || branchAvailability.deleteBranchOnRollback;
    let initialized: InitializeManagedWorktreeResult | null = null;

    try {
      await this.reportCreateProgress({
        ...createProgressBase,
        phase: "creating_worktree",
      });

      await mkdir(dirname(worktreePath), { recursive: true });

      initialized = await createManagedWorktree(
        {
          repoRoot: this.deps.projectRoot,
          worktreePath,
          branch: input.branch,
          mode: input.mode,
          ...(baseBranch ? { baseBranch } : {}),
          ...(branchAvailability.startPoint ? { startPoint: branchAvailability.startPoint } : {}),
          profile: profileName,
          agent: agent.id,
          runtime: profile.runtime,
          startupEnvValues: await this.buildStartupEnvValues(input.envOverrides),
          allocatedPorts: await this.allocatePorts(),
          runtimeEnvExtras: { WEBMUX_WORKTREE_PATH: worktreePath },
          controlUrl: this.controlUrl(profile.runtime),
          controlToken: await this.deps.getControlToken(),
          deleteBranchOnRollback,
        },
        {
          git: this.deps.git,
        },
      );

      await this.reportCreateProgress({
        ...createProgressBase,
        phase: "running_post_create_hook",
      });
      await this.runLifecycleHook({
        name: "postCreate",
        command: this.deps.config.lifecycleHooks.postCreate,
        meta: initialized.meta,
        worktreePath,
      });

      initialized = await this.refreshManagedArtifactsFromMeta({
        gitDir: initialized.paths.gitDir,
        meta: initialized.meta,
        worktreePath,
      });
      await this.reportCreateProgress({
        ...createProgressBase,
        phase: "preparing_runtime",
      });
      await ensureAgentRuntimeArtifacts({
        gitDir: initialized.paths.gitDir,
        worktreePath,
      });
      await this.reportCreateProgress({
        ...createProgressBase,
        phase: "starting_session",
      });
      await this.materializeRuntimeSession({
        branch: input.branch,
        profileName,
        profile,
        agent,
        initialized,
        worktreePath,
        prompt: input.prompt,
        launchMode: "fresh",
      });

      await this.reportCreateProgress({
        ...createProgressBase,
        phase: "reconciling",
      });
      await this.deps.reconciliation.reconcile(this.deps.projectRoot, { force: true });

      return {
        branch: input.branch,
        worktreeId: initialized.meta.worktreeId,
      };
    } catch (error) {
      if (initialized) {
        const cleanupError = await this.cleanupFailedCreate(
          input.branch,
          worktreePath,
          profile.runtime,
          deleteBranchOnRollback,
        );
        if (cleanupError) {
          throw this.wrapOperationError(new Error(`${toErrorMessage(error)}; ${cleanupError}`));
        }
      }
      throw this.wrapOperationError(error);
    } finally {
      await this.finishCreateProgress(input.branch);
    }
  }

  private wrapOperationError(error: unknown): LifecycleError {
    if (error instanceof LifecycleError) {
      return error;
    }

    return new LifecycleError(toErrorMessage(error), 422);
  }
}
