import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
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
  writeWorktreeMeta,
} from "../adapters/fs";
import { expandTemplate, getDefaultProfileName, isDockerProfile, type DockerProfileConfig } from "../adapters/config";
import { type DockerGateway } from "../adapters/docker";
import { buildProjectSessionName, buildWorktreeParkingWindowName, buildWorktreeWindowName, type TmuxGateway } from "../adapters/tmux";
import { captureNewSessionId, type SessionDiscoveryGateway } from "../adapters/session-discovery";
import type { AgentId, ProfileConfig, ProjectConfig, RuntimeKind } from "../domain/config";
import { ROOT_TAB_ID, type OneshotMeta, type WorktreeCreationPhase, type WorktreeMeta, type WorktreeSource, type WorktreeTab } from "../domain/model";
import {
  activeTabId as readActiveTabId,
  appendTab,
  buildForkTab,
  findTab,
  listTabs,
  nextForkSeq,
  removeTab,
  rootTab,
  setActiveTab,
  updateTab,
  withTabs,
} from "./tab-logic";
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
const MAX_WORKTREE_LABEL_LENGTH = 80;

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stringifyStartupEnvValue(value: string | boolean): string {
  return typeof value === "boolean" ? String(value) : value;
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizeWorktreeLabel(label: string | null): string | null {
  const trimmed = label?.trim() ?? "";
  if (!trimmed) return null;
  if (trimmed.length > MAX_WORKTREE_LABEL_LENGTH) {
    throw new LifecycleError(`Worktree label must be ${MAX_WORKTREE_LABEL_LENGTH} characters or fewer`, 400);
  }
  return trimmed;
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

function resolveCodexResumeConversationId(
  meta: WorktreeMeta,
  agent: AgentDefinition,
  launchMode: AgentLaunchMode,
): string | undefined {
  if (launchMode !== "resume") return undefined;
  if (meta.agentTerminalStale !== true) return undefined;
  if (agent.kind !== "builtin" || agent.implementation.agent !== "codex") return undefined;
  if (meta.conversation?.provider !== "codexAppServer") return undefined;
  return meta.conversation.threadId;
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
  agentIds: AgentId[],
): CreateWorktreeTarget[] {
  if (agentIds.length <= 1) {
    const agent = agentIds[0];
    return agent ? [{ branch, agent }] : [];
  }

  return agentIds.map((agent) => ({
    branch: prefixAgentBranch(agent, branch),
    agent,
  }));
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
  source: WorktreeSource;
}

export interface LifecycleServiceDependencies {
  projectRoot: string;
  controlBaseUrl: string;
  getControlToken: () => Promise<string>;
  config: ProjectConfig;
  archiveState: ArchiveStateService;
  git: GitGateway;
  tmux: TmuxGateway;
  sessionDiscovery: SessionDiscoveryGateway;
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
  source?: WorktreeSource;
  oneshot?: OneshotMeta;
}

export interface CreateLifecycleWorktreesInput extends Omit<CreateLifecycleWorktreeInput, "agent"> {
  agents?: AgentId[];
  agent?: AgentId;
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
    const agentIds = this.resolveSelectedAgents(input);
    if (agentIds.length > 1 && mode === "existing") {
      throw new LifecycleError("Creating multiple agents is only supported for new worktrees", 400);
    }

    const branch = await this.resolveBranch(input.branch, input.prompt, mode);
    const targets = buildCreateWorktreeTargets(branch, agentIds);
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

  async openWorktree(
    branch: string,
    options: { prompt?: string; oneshot?: OneshotMeta } = {},
  ): Promise<{
    branch: string;
    worktreeId: string;
  }> {
    try {
      const resolved = await this.resolveExistingWorktree(branch);
      let initialized = resolved.meta
        ? await this.refreshManagedArtifacts(resolved)
        : await this.initializeUnmanagedWorktree(resolved);
      if (options.oneshot) {
        const nextMeta: WorktreeMeta = { ...initialized.meta, oneshot: options.oneshot };
        await writeWorktreeMeta(initialized.paths.gitDir, nextMeta);
        initialized = { ...initialized, meta: nextMeta };
      }
      const { profileName, profile } = this.resolveProfile(initialized.meta.profile);
      const agent = this.resolveAgentDefinition(initialized.meta.agent);
      const launchMode: AgentLaunchMode = resolved.meta && agent.capabilities.resume ? "resume" : "fresh";
      const resumeConversationId = resolveCodexResumeConversationId(initialized.meta, agent, launchMode);
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
        followUpPrompt: options.prompt,
        resumeConversationId,
      });

      if (initialized.meta.agentTerminalStale === true) {
        await writeWorktreeMeta(resolved.gitDir, {
          ...initialized.meta,
          agentTerminalStale: false,
        });
      }
      await this.restoreWorktreeTabs({
        branch,
        gitDir: resolved.gitDir,
        worktreePath: resolved.entry.path,
        profile,
        profileName,
        agent,
        runtimeEnvPath: initialized.paths.runtimeEnvPath,
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

  async refreshAgentTerminal(branch: string): Promise<{
    branch: string;
    worktreeId: string;
  }> {
    try {
      const resolved = await this.resolveExistingWorktree(branch);
      if (!resolved.meta) {
        throw new LifecycleError(`Worktree ${branch} has no managed metadata to refresh`, 409);
      }

      const initialized = await this.refreshManagedArtifacts(resolved);
      const { profileName, profile } = this.resolveProfile(initialized.meta.profile);
      const agent = this.resolveAgentDefinition(initialized.meta.agent);
      if (agent.kind !== "builtin" || (agent.implementation.agent !== "codex" && agent.implementation.agent !== "claude")) {
        throw new LifecycleError("Refreshing the agent terminal is only available for built-in agent worktrees", 409);
      }

      const conversation = initialized.meta.conversation;
      if (!conversation) {
        throw new LifecycleError(`No ${agent.label} conversation is available to refresh`, 409);
      }
      let resumeConversationId: string;
      if (agent.implementation.agent === "codex") {
        if (conversation.provider !== "codexAppServer") {
          throw new LifecycleError(`No ${agent.label} conversation is available to refresh`, 409);
        }
        resumeConversationId = conversation.threadId;
      } else {
        if (conversation.provider !== "claudeCode") {
          throw new LifecycleError(`No ${agent.label} conversation is available to refresh`, 409);
        }
        resumeConversationId = conversation.sessionId;
      }

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
        launchMode: "resume",
        resumeConversationId,
      });

      await writeWorktreeMeta(resolved.gitDir, {
        ...initialized.meta,
        agentTerminalStale: false,
      });
      // Rebuilding the agent pane recreated the worktree window, so any parked fork
      // panes (and the root.paneId stored in meta) are now stale. Rebuild parked tabs
      // and restore the active tab on-screen, same as the open path.
      await this.restoreWorktreeTabs({
        branch,
        gitDir: resolved.gitDir,
        worktreePath: resolved.entry.path,
        profile,
        profileName,
        agent,
        runtimeEnvPath: initialized.paths.runtimeEnvPath,
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

  async createWorktreeTab(branch: string): Promise<{ tab: WorktreeTab }> {
    try {
      const ctx = await this.prepareTabContext(branch);
      const rootSessionId = await this.ensureRootSessionId(ctx);
      if (!rootSessionId) {
        throw new LifecycleError(
          "The root session hasn't started yet — interact with it once before forking a tab",
          409,
        );
      }
      // ensureRootSessionId may have persisted root.sessionId; re-read for a fresh base.
      const meta = await this.readMetaOrThrow(ctx.resolved.gitDir);
      const seq = nextForkSeq(meta);
      // Claude can pin the forked child id (deterministic); Codex self-assigns, so we capture it.
      const pinSessionId = ctx.agentKind === "claude" ? randomUUID() : undefined;
      const agentCommand = buildAgentPaneCommand({
        agent: ctx.agent,
        runtimeEnvPath: ctx.initialized.paths.runtimeEnvPath,
        repoRoot: this.deps.projectRoot,
        worktreePath: ctx.worktreePath,
        branch,
        profileName: ctx.profileName,
        yolo: ctx.profile.yolo === true,
        launchMode: "fork",
        forkFromSessionId: rootSessionId,
        pinSessionId,
      });

      const visibleSlot = `${ctx.sessionName}:${ctx.windowName}.0`;
      // Record the currently-visible (active) tab's pane id before it gets parked by the swap.
      const outgoingActiveId = readActiveTabId(meta);
      const outgoingPaneId = this.deps.tmux.getPaneId(visibleSlot);

      const before = await this.deps.sessionDiscovery.listSessionIds(ctx.agentKind, ctx.worktreePath);
      const paneId = this.deps.tmux.createParkedPane({
        sessionName: ctx.sessionName,
        parkingWindow: ctx.parkingWindow,
        cwd: ctx.worktreePath,
        command: buildManagedShellCommand(ctx.initialized.paths.runtimeEnvPath),
      });
      this.deps.tmux.runCommand(paneId, agentCommand);
      const sessionId = pinSessionId
        ?? await captureNewSessionId(this.deps.sessionDiscovery, ctx.agentKind, ctx.worktreePath, before);

      const tab = buildForkTab({ seq, sessionId, paneId, createdAt: new Date().toISOString() });
      let nextMeta = appendTab(meta, tab); // makes the fork active
      nextMeta = updateTab(nextMeta, outgoingActiveId, { paneId: outgoingPaneId });
      await writeWorktreeMeta(ctx.resolved.gitDir, nextMeta);
      // A new fork becomes the active tab — bring it into the visible agent slot.
      this.deps.tmux.swapPanes(paneId, visibleSlot);
      await this.deps.reconciliation.reconcile(this.deps.projectRoot, { force: true });
      return { tab };
    } catch (error) {
      throw this.wrapOperationError(error);
    }
  }

  async selectWorktreeTab(branch: string, tabId: string): Promise<void> {
    try {
      const ctx = await this.prepareTabContext(branch);
      const target = findTab(ctx.meta, tabId);
      if (!target) throw new LifecycleError(`Tab not found: ${tabId}`, 404);
      const outgoingActiveId = readActiveTabId(ctx.meta);
      if (outgoingActiveId === tabId) return;
      if (!target.paneId) throw new LifecycleError(`Tab ${tabId} has no live pane to show`, 409);
      const visibleSlot = `${ctx.sessionName}:${ctx.windowName}.0`;
      const outgoingPaneId = this.deps.tmux.getPaneId(visibleSlot);
      this.deps.tmux.swapPanes(target.paneId, visibleSlot);
      let nextMeta = updateTab(ctx.meta, outgoingActiveId, { paneId: outgoingPaneId });
      nextMeta = setActiveTab(nextMeta, tabId);
      await writeWorktreeMeta(ctx.resolved.gitDir, nextMeta);
      await this.deps.reconciliation.reconcile(this.deps.projectRoot, { force: true });
    } catch (error) {
      throw this.wrapOperationError(error);
    }
  }

  async deleteWorktreeTab(branch: string, tabId: string): Promise<void> {
    try {
      const ctx = await this.prepareTabContext(branch);
      const target = findTab(ctx.meta, tabId);
      if (!target) throw new LifecycleError(`Tab not found: ${tabId}`, 404);
      if (target.kind === "root") throw new LifecycleError("The root tab cannot be deleted", 400);

      const root = rootTab(ctx.meta);
      // If the deleted tab is on-screen, bring the root back into the visible slot first.
      // No need to recapture/persist root.paneId (unlike select/create): tmux swap-pane
      // moves pane *content* between slots while pane ids stay attached to their content,
      // so root.paneId remains valid after the swap.
      if (readActiveTabId(ctx.meta) === tabId && root?.paneId) {
        this.deps.tmux.swapPanes(root.paneId, `${ctx.sessionName}:${ctx.windowName}.0`);
      }
      if (target.paneId) this.deps.tmux.killPane(target.paneId);
      await writeWorktreeMeta(ctx.resolved.gitDir, removeTab(ctx.meta, tabId));
      await this.deps.reconciliation.reconcile(this.deps.projectRoot, { force: true });
    } catch (error) {
      throw this.wrapOperationError(error);
    }
  }

  private async readMetaOrThrow(gitDir: string): Promise<WorktreeMeta> {
    const meta = await readWorktreeMeta(gitDir);
    if (!meta) throw new LifecycleError("Worktree metadata is missing", 409);
    return meta;
  }

  private async prepareTabContext(branch: string): Promise<{
    resolved: ResolvedLifecycleWorktree;
    initialized: InitializeManagedWorktreeResult;
    meta: WorktreeMeta;
    worktreePath: string;
    agent: AgentDefinition;
    agentKind: "claude" | "codex";
    profile: ProfileConfig;
    profileName: string;
    sessionName: string;
    windowName: string;
    parkingWindow: string;
  }> {
    const resolved = await this.resolveExistingWorktree(branch);
    if (!resolved.meta) throw new LifecycleError(`Worktree ${branch} has no managed metadata`, 409);

    const sessionName = buildProjectSessionName(this.deps.projectRoot);
    const windowName = buildWorktreeWindowName(branch);
    if (!this.deps.tmux.hasWindow(sessionName, windowName)) {
      throw new LifecycleError(`Worktree ${branch} is not open`, 409);
    }

    const { profileName, profile } = this.resolveProfile(resolved.meta.profile);
    if (profile.runtime === "docker") {
      throw new LifecycleError("Tabs are not supported for Docker worktrees", 409);
    }
    const agent = this.resolveAgentDefinition(resolved.meta.agent);
    if (agent.kind !== "builtin") {
      throw new LifecycleError("Tabs are only available for the built-in Claude and Codex agents", 409);
    }

    const initialized = await this.refreshManagedArtifacts(resolved);
    return {
      resolved,
      initialized,
      meta: initialized.meta,
      worktreePath: resolved.entry.path,
      agent,
      agentKind: agent.implementation.agent,
      profile,
      profileName,
      sessionName,
      windowName,
      parkingWindow: buildWorktreeParkingWindowName(branch),
    };
  }

  /** Resolve the root tab's session id, discovering and persisting it on first use.
   *  Safe because at first fork the root is the only (or newest) session for the cwd. */
  private async ensureRootSessionId(ctx: {
    meta: WorktreeMeta;
    agentKind: "claude" | "codex";
    worktreePath: string;
    resolved: ResolvedLifecycleWorktree;
  }): Promise<string | null> {
    const root = rootTab(ctx.meta);
    if (root?.sessionId) return root.sessionId;
    const discovered = (await this.deps.sessionDiscovery.listSessionIds(ctx.agentKind, ctx.worktreePath))[0] ?? null;
    if (discovered && root) {
      await writeWorktreeMeta(ctx.resolved.gitDir, updateTab(ctx.meta, root.tabId, { sessionId: discovered }));
    }
    return discovered;
  }

  /** Rebuild parked panes for persisted fork tabs after a worktree's window is recreated,
   *  recapture the (ephemeral) pane ids, and restore the previously active tab on-screen. */
  private async restoreWorktreeTabs(input: {
    branch: string;
    gitDir: string;
    worktreePath: string;
    profile: ProfileConfig;
    profileName: string;
    agent: AgentDefinition;
    runtimeEnvPath: string;
  }): Promise<void> {
    if (input.profile.runtime === "docker") return;
    if (input.agent.kind !== "builtin") return;
    const meta = await readWorktreeMeta(input.gitDir);
    const root = meta ? rootTab(meta) : undefined;
    if (!meta || !root) return;
    // Nothing to rebuild for the common (root-only) case — leave the open path untouched.
    if (!listTabs(meta).some((tab) => tab.kind === "fork")) return;

    const sessionName = buildProjectSessionName(this.deps.projectRoot);
    const windowName = buildWorktreeWindowName(input.branch);
    const parkingWindow = buildWorktreeParkingWindowName(input.branch);
    // A parking window may still exist (e.g. the agent terminal was refreshed without a
    // full close/reopen): tear it down so we rebuild parked panes from a clean slate
    // instead of duplicating them. killWindow tolerates an absent window.
    this.deps.tmux.killWindow(sessionName, parkingWindow);
    const visibleSlot = `${sessionName}:${windowName}.0`;
    // Capture the visible slot's pane id once: it is the root's on-screen pane and,
    // if a fork is restored on top, the swap target. Two reads could diverge.
    const visibleSlotPaneId = this.deps.tmux.getPaneId(visibleSlot);

    const restored: WorktreeTab[] = [{ ...root, paneId: visibleSlotPaneId }];
    for (const fork of listTabs(meta).filter((tab) => tab.kind === "fork")) {
      if (!fork.sessionId) continue; // cannot resume an unknown session — drop it
      const command = buildAgentPaneCommand({
        agent: input.agent,
        runtimeEnvPath: input.runtimeEnvPath,
        repoRoot: this.deps.projectRoot,
        worktreePath: input.worktreePath,
        branch: input.branch,
        profileName: input.profileName,
        yolo: input.profile.yolo === true,
        launchMode: "resume",
        resumeConversationId: fork.sessionId,
      });
      const paneId = this.deps.tmux.createParkedPane({
        sessionName,
        parkingWindow,
        cwd: input.worktreePath,
        command: buildManagedShellCommand(input.runtimeEnvPath),
      });
      this.deps.tmux.runCommand(paneId, command);
      restored.push({ ...fork, paneId });
    }

    let nextMeta = withTabs(meta, restored);
    const wantActive = readActiveTabId(meta);
    const activeTab = restored.find((tab) => tab.tabId === wantActive && tab.kind === "fork" && tab.paneId);
    if (activeTab?.paneId) {
      this.deps.tmux.swapPanes(activeTab.paneId, visibleSlotPaneId);
      nextMeta = setActiveTab(nextMeta, activeTab.tabId);
    } else {
      nextMeta = setActiveTab(nextMeta, ROOT_TAB_ID);
    }
    await writeWorktreeMeta(input.gitDir, nextMeta);
  }

  /** Clears the oneshot watch state from a worktree's persisted meta, if present.
   *  Idempotent: returns true when armed state was cleared, false otherwise.
   *  The server-side oneshot watcher calls this on any browser-originated interaction. */
  async disarmOneshot(branch: string): Promise<boolean> {
    let resolved: ResolvedLifecycleWorktree;
    try {
      resolved = await this.resolveExistingWorktree(branch);
    } catch {
      return false;
    }
    if (!resolved.meta?.oneshot) return false;
    const nextMeta: WorktreeMeta = { ...resolved.meta };
    delete nextMeta.oneshot;
    await writeWorktreeMeta(resolved.gitDir, nextMeta);
    return true;
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

  async setWorktreeLabel(branch: string, label: string | null): Promise<{ label: string | null }> {
    try {
      const normalizedLabel = normalizeWorktreeLabel(label);
      const resolved = await this.resolveExistingWorktree(branch);
      if (!resolved.meta) {
        throw new LifecycleError(`Worktree ${branch} has no managed metadata to label`, 409);
      }
      const nextMeta = this.withUpdatedLabel(resolved.meta, normalizedLabel);
      await writeWorktreeMeta(resolved.gitDir, nextMeta);
      await this.deps.reconciliation.reconcile(this.deps.projectRoot, { force: true });
      return { label: normalizedLabel };
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

  private resolveSelectedAgents(input: CreateLifecycleWorktreesInput): AgentId[] {
    const selectedAgents = input.agents && input.agents.length > 0
      ? input.agents
      : [input.agent ?? this.deps.config.workspace.defaultAgent];

    const dedupedAgentIds = [...new Set(selectedAgents.map((agent) => agent.trim()).filter((agent) => agent.length > 0))];
    if (dedupedAgentIds.length === 0) {
      throw new LifecycleError("At least one agent must be selected", 400);
    }

    return dedupedAgentIds.map((agentId) => this.resolveAgentDefinition(agentId).id);
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
    // Raw listWorktrees on purpose: a stale registration still holds its branch
    // in git's view, so it must continue to block branch reuse. Switching this
    // to listLiveWorktrees would falsely report the branch as free.
    return new Set(
      this.deps.git.listWorktrees(resolve(this.deps.projectRoot))
        .filter((entry): entry is GitWorktreeEntry & { branch: string } => !entry.bare && entry.branch !== null)
        .map((entry) => entry.branch),
    );
  }

  private listProjectWorktrees(): GitWorktreeEntry[] {
    const projectRoot = resolve(this.deps.projectRoot);
    return this.deps.git.listLiveWorktrees(projectRoot).filter((entry) =>
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

  private withUpdatedLabel(meta: WorktreeMeta, label: string | null): WorktreeMeta {
    const nextMeta: WorktreeMeta = { ...meta };
    if (label) {
      nextMeta.label = label;
    } else {
      delete nextMeta.label;
    }
    return nextMeta;
  }

  /** Tear down a worktree's tmux windows: the main agent window and the hidden
   *  parking window that holds its forked tab panes. killWindow tolerates a missing
   *  window, so this is safe for root-only worktrees that never created a parking window. */
  private killWorktreeWindows(branch: string): void {
    const sessionName = buildProjectSessionName(this.deps.projectRoot);
    this.deps.tmux.killWindow(sessionName, buildWorktreeWindowName(branch));
    this.deps.tmux.killWindow(sessionName, buildWorktreeParkingWindowName(branch));
  }

  private async closeBranchWindow(branch: string): Promise<void> {
    this.killWorktreeWindows(branch);
    await this.deps.reconciliation.reconcile(this.deps.projectRoot, { force: true });
  }

  // Prompts are split into two fields at the type level to prevent the bug
  // PR #116 fixed (creation prompt accidentally re-firing on a worktree
  // re-open). `creationPrompt` is only honored on `fresh` launches;
  // `followUpPrompt` is only honored on `resume`. The build layer picks the
  // right one based on `launchMode`.
  private async materializeRuntimeSession(input: {
    branch: string;
    profileName: string;
    profile: ProfileConfig;
    agent: AgentDefinition;
    initialized: InitializeManagedWorktreeResult;
    worktreePath: string;
    creationPrompt?: string;
    followUpPrompt?: string;
    launchMode: AgentLaunchMode;
    source?: WorktreeSource;
    resumeConversationId?: string;
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
        creationPrompt: input.creationPrompt,
        followUpPrompt: input.followUpPrompt,
        launchMode: input.launchMode,
        source: input.source,
        resumeConversationId: input.resumeConversationId,
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
      creationPrompt: input.creationPrompt,
      followUpPrompt: input.followUpPrompt,
      launchMode: input.launchMode,
      source: input.source,
      resumeConversationId: input.resumeConversationId,
    }));
  }

  private buildSessionLayout(input: {
    branch: string;
    profileName: string;
    profile: ProfileConfig;
    agent: AgentDefinition;
    initialized: InitializeManagedWorktreeResult;
    worktreePath: string;
    creationPrompt?: string;
    followUpPrompt?: string;
    launchMode: AgentLaunchMode;
    source?: WorktreeSource;
    resumeConversationId?: string;
    containerName?: string;
  }) {
    const baseSystemPrompt = input.launchMode === "fresh" && input.profile.systemPrompt
      ? expandTemplate(input.profile.systemPrompt, input.initialized.runtimeEnv)
      : undefined;
    const oneshotPrompt = input.launchMode === "fresh" && input.source === "oneshot"
      ? this.deps.config.oneshot.systemPrompt
      : undefined;
    const systemPrompt = baseSystemPrompt && oneshotPrompt
      ? `${baseSystemPrompt}\n\n${oneshotPrompt}`
      : (oneshotPrompt ?? baseSystemPrompt);
    // Pick the prompt source for the launch mode. Any value supplied for the
    // wrong field is silently ignored — this is the defense PR #116 added.
    const prompt = input.launchMode === "resume" ? input.followUpPrompt : input.creationPrompt;
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
                prompt,
                launchMode: input.launchMode,
                resumeConversationId: input.resumeConversationId,
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
                prompt,
                launchMode: input.launchMode,
                resumeConversationId: input.resumeConversationId,
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
      this.killWorktreeWindows(branch);
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

    this.killWorktreeWindows(branch);
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
    const source: WorktreeSource = input.source ?? "ui";
    const createProgressBase = {
      branch: input.branch,
      ...(baseBranch ? { baseBranch } : {}),
      path: worktreePath,
      profile: profileName,
      agent: input.agent,
      source,
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
          source,
          ...(input.oneshot ? { oneshot: input.oneshot } : {}),
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
        creationPrompt: input.prompt,
        launchMode: "fresh",
        source,
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
