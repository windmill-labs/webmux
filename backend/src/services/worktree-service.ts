import { randomUUID } from "node:crypto";
import { BunGitGateway, type CreateWorktreeMode, type GitGateway } from "../adapters/git";
import {
  buildControlEnvMap,
  buildRuntimeEnvMap,
  ensureWorktreeStorageDirs,
  loadDotenvLocal,
  writeControlEnv,
  writeRuntimeEnv,
  writeWorktreeMeta,
} from "../adapters/fs";
import type { AgentKind, RuntimeKind } from "../domain/config";
import {
  WORKTREE_META_SCHEMA_VERSION,
  type ControlEnvMap,
  type WorktreeMeta,
  type WorktreeStoragePaths,
} from "../domain/model";
import { ensureSessionLayout, type SessionLayoutPlan } from "./session-service";
import type { TmuxGateway } from "../adapters/tmux";

export interface InitializeManagedWorktreeOptions {
  gitDir: string;
  branch: string;
  baseBranch?: string;
  profile: string;
  agent: AgentKind;
  runtime: RuntimeKind;
  startupEnvValues?: Record<string, string>;
  allocatedPorts?: Record<string, number>;
  runtimeEnvExtras?: Record<string, string>;
  dotenvValues?: Record<string, string>;
  controlUrl?: string;
  controlToken?: string;
  now?: () => Date;
  worktreeId?: string;
}

export interface InitializeManagedWorktreeResult {
  meta: WorktreeMeta;
  paths: WorktreeStoragePaths;
  runtimeEnv: Record<string, string>;
  controlEnv: ControlEnvMap | null;
}

export interface CreateManagedWorktreeOptions {
  repoRoot: string;
  worktreePath: string;
  branch: string;
  mode: CreateWorktreeMode;
  baseBranch?: string;
  startPoint?: string;
  profile: string;
  agent: AgentKind;
  runtime: RuntimeKind;
  startupEnvValues?: Record<string, string>;
  allocatedPorts?: Record<string, number>;
  runtimeEnvExtras?: Record<string, string>;
  controlUrl?: string;
  controlToken?: string;
  now?: () => Date;
  worktreeId?: string;
  deleteBranchOnRollback?: boolean;
  sessionLayoutPlan?: SessionLayoutPlan;
  sessionLayoutPlanBuilder?: (initialized: InitializeManagedWorktreeResult) => SessionLayoutPlan;
}

export interface CreateManagedWorktreeDependencies {
  git?: GitGateway;
  tmux?: TmuxGateway;
}

export interface RemoveManagedWorktreeOptions {
  repoRoot: string;
  worktreePath: string;
  branch?: string;
  force?: boolean;
  deleteBranch?: boolean;
  deleteBranchForce?: boolean;
}

export interface MergeManagedWorktreeOptions {
  repoRoot: string;
  sourceBranch: string;
  targetBranch: string;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function joinErrorMessages(messages: string[]): string {
  return messages.filter((message) => message.length > 0).join("; ");
}

function cleanupSessionLayout(
  tmux: TmuxGateway | undefined,
  plan: SessionLayoutPlan | undefined,
): string | null {
  if (!tmux || !plan) return null;

  try {
    tmux.killWindow(plan.sessionName, plan.windowName);
    return null;
  } catch (error) {
    return `tmux cleanup failed: ${toErrorMessage(error)}`;
  }
}

function rollbackManagedWorktreeCreation(
  opts: Pick<CreateManagedWorktreeOptions, "repoRoot" | "worktreePath" | "branch" | "deleteBranchOnRollback">,
  sessionLayoutPlan: SessionLayoutPlan | undefined,
  git: GitGateway,
  deps: CreateManagedWorktreeDependencies,
): string | null {
  const cleanupErrors: string[] = [];
  const sessionCleanupError = cleanupSessionLayout(deps.tmux, sessionLayoutPlan);
  if (sessionCleanupError) cleanupErrors.push(sessionCleanupError);

  try {
    git.removeWorktree({
      repoRoot: opts.repoRoot,
      worktreePath: opts.worktreePath,
      force: true,
    });
  } catch (error) {
    cleanupErrors.push(`worktree rollback failed: ${toErrorMessage(error)}`);
  }

  if (opts.deleteBranchOnRollback ?? true) {
    try {
      git.deleteBranch(opts.repoRoot, opts.branch, true);
    } catch (error) {
      cleanupErrors.push(`branch rollback failed: ${toErrorMessage(error)}`);
    }
  }

  return cleanupErrors.length > 0 ? joinErrorMessages(cleanupErrors) : null;
}

export async function initializeManagedWorktree(
  opts: InitializeManagedWorktreeOptions,
): Promise<InitializeManagedWorktreeResult> {
  if ((opts.controlUrl && !opts.controlToken) || (!opts.controlUrl && opts.controlToken)) {
    throw new Error("controlUrl and controlToken must be provided together");
  }

  const createdAt = (opts.now ?? (() => new Date()))().toISOString();
  const meta: WorktreeMeta = {
    schemaVersion: WORKTREE_META_SCHEMA_VERSION,
    worktreeId: opts.worktreeId ?? randomUUID(),
    branch: opts.branch,
    ...(opts.baseBranch ? { baseBranch: opts.baseBranch } : {}),
    createdAt,
    profile: opts.profile,
    agent: opts.agent,
    runtime: opts.runtime,
    startupEnvValues: { ...(opts.startupEnvValues ?? {}) },
    allocatedPorts: { ...(opts.allocatedPorts ?? {}) },
  };

  const paths = await ensureWorktreeStorageDirs(opts.gitDir);
  await writeWorktreeMeta(opts.gitDir, meta);

  const runtimeEnv = buildRuntimeEnvMap(meta, opts.runtimeEnvExtras, opts.dotenvValues);
  await writeRuntimeEnv(opts.gitDir, runtimeEnv);

  let controlEnv: ControlEnvMap | null = null;
  if (opts.controlUrl && opts.controlToken) {
    controlEnv = buildControlEnvMap({
      controlUrl: opts.controlUrl,
      controlToken: opts.controlToken,
      worktreeId: meta.worktreeId,
      branch: meta.branch,
    });
    await writeControlEnv(opts.gitDir, controlEnv);
  }

  return {
    meta,
    paths,
    runtimeEnv,
    controlEnv,
  };
}

export async function createManagedWorktree(
  opts: CreateManagedWorktreeOptions,
  deps: CreateManagedWorktreeDependencies = {},
): Promise<InitializeManagedWorktreeResult> {
  const git = deps.git ?? new BunGitGateway();
  let worktreeCreated = false;
  let sessionLayoutPlan = opts.sessionLayoutPlan;

  try {
    git.createWorktree({
      repoRoot: opts.repoRoot,
      worktreePath: opts.worktreePath,
      branch: opts.branch,
      mode: opts.mode,
      baseBranch: opts.baseBranch,
      startPoint: opts.startPoint,
    });
    worktreeCreated = true;

    const gitDir = git.resolveWorktreeGitDir(opts.worktreePath);
    const dotenvValues = await loadDotenvLocal(opts.worktreePath);
    const initialized = await initializeManagedWorktree({
      gitDir,
      branch: opts.branch,
      baseBranch: opts.baseBranch,
      profile: opts.profile,
      agent: opts.agent,
      runtime: opts.runtime,
      startupEnvValues: opts.startupEnvValues,
      allocatedPorts: opts.allocatedPorts,
      runtimeEnvExtras: opts.runtimeEnvExtras,
      dotenvValues,
      controlUrl: opts.controlUrl,
      controlToken: opts.controlToken,
      now: opts.now,
      worktreeId: opts.worktreeId,
    });

    if (deps.tmux) {
      sessionLayoutPlan = sessionLayoutPlan ?? opts.sessionLayoutPlanBuilder?.(initialized);
      if (sessionLayoutPlan) {
        ensureSessionLayout(deps.tmux, sessionLayoutPlan);
      }
    }

    return initialized;
  } catch (error) {
    if (!worktreeCreated) throw error;

    const rollbackError = rollbackManagedWorktreeCreation(opts, sessionLayoutPlan, git, deps);
    if (!rollbackError) throw error;

    throw new Error(`${toErrorMessage(error)}; ${rollbackError}`);
  }
}

export function removeManagedWorktree(
  opts: RemoveManagedWorktreeOptions,
  git: GitGateway = new BunGitGateway(),
): void {
  git.removeWorktree({
    repoRoot: opts.repoRoot,
    worktreePath: opts.worktreePath,
    force: opts.force,
  });

  if (opts.deleteBranch && opts.branch) {
    git.deleteBranch(opts.repoRoot, opts.branch, opts.deleteBranchForce);
  }
}

export function mergeManagedWorktree(
  opts: MergeManagedWorktreeOptions,
  git: GitGateway = new BunGitGateway(),
): void {
  git.mergeBranch({
    repoRoot: opts.repoRoot,
    sourceBranch: opts.sourceBranch,
    targetBranch: opts.targetBranch,
  });
}
