import { randomUUID } from "node:crypto";
import { BunGitGateway, type GitGateway } from "../adapters/git";
import {
  buildCompatibilityEnvMap,
  buildControlEnvMap,
  buildRuntimeEnvMap,
  ensureWorktreeStorageDirs,
  writeCompatibilityEnvFile,
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
  profile: string;
  agent: AgentKind;
  runtime: RuntimeKind;
  startupEnvValues?: Record<string, string>;
  allocatedPorts?: Record<string, number>;
  runtimeEnvExtras?: Record<string, string>;
  worktreePath?: string;
  emitCompatibilityEnv?: boolean;
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
  compatibilityEnv: Record<string, string> | null;
}

export interface CreateManagedWorktreeOptions {
  repoRoot: string;
  worktreePath: string;
  branch: string;
  baseBranch?: string;
  profile: string;
  agent: AgentKind;
  runtime: RuntimeKind;
  startupEnvValues?: Record<string, string>;
  allocatedPorts?: Record<string, number>;
  runtimeEnvExtras?: Record<string, string>;
  emitCompatibilityEnv?: boolean;
  controlUrl?: string;
  controlToken?: string;
  now?: () => Date;
  worktreeId?: string;
  sessionLayoutPlan?: SessionLayoutPlan;
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

export async function initializeManagedWorktree(
  opts: InitializeManagedWorktreeOptions,
): Promise<InitializeManagedWorktreeResult> {
  if ((opts.controlUrl && !opts.controlToken) || (!opts.controlUrl && opts.controlToken)) {
    throw new Error("controlUrl and controlToken must be provided together");
  }
  if (opts.emitCompatibilityEnv && !opts.worktreePath) {
    throw new Error("worktreePath is required when emitCompatibilityEnv is true");
  }

  const createdAt = (opts.now ?? (() => new Date()))().toISOString();
  const meta: WorktreeMeta = {
    schemaVersion: WORKTREE_META_SCHEMA_VERSION,
    worktreeId: opts.worktreeId ?? randomUUID(),
    branch: opts.branch,
    createdAt,
    profile: opts.profile,
    agent: opts.agent,
    runtime: opts.runtime,
    startupEnvValues: { ...(opts.startupEnvValues ?? {}) },
    allocatedPorts: { ...(opts.allocatedPorts ?? {}) },
  };

  const paths = await ensureWorktreeStorageDirs(opts.gitDir);
  await writeWorktreeMeta(opts.gitDir, meta);

  const runtimeEnv = buildRuntimeEnvMap(meta, opts.runtimeEnvExtras);
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

  let compatibilityEnv: Record<string, string> | null = null;
  if (opts.emitCompatibilityEnv && opts.worktreePath) {
    compatibilityEnv = buildCompatibilityEnvMap(meta);
    await writeCompatibilityEnvFile(opts.worktreePath, compatibilityEnv);
  }

  return {
    meta,
    paths,
    runtimeEnv,
    controlEnv,
    compatibilityEnv,
  };
}

export async function createManagedWorktree(
  opts: CreateManagedWorktreeOptions,
  deps: CreateManagedWorktreeDependencies = {},
): Promise<InitializeManagedWorktreeResult> {
  const git = deps.git ?? new BunGitGateway();
  git.createWorktree({
    repoRoot: opts.repoRoot,
    worktreePath: opts.worktreePath,
    branch: opts.branch,
    baseBranch: opts.baseBranch,
  });

  const gitDir = git.resolveWorktreeGitDir(opts.worktreePath);
  const initialized = await initializeManagedWorktree({
    gitDir,
    worktreePath: opts.worktreePath,
    emitCompatibilityEnv: opts.emitCompatibilityEnv,
    branch: opts.branch,
    profile: opts.profile,
    agent: opts.agent,
    runtime: opts.runtime,
    startupEnvValues: opts.startupEnvValues,
    allocatedPorts: opts.allocatedPorts,
    runtimeEnvExtras: opts.runtimeEnvExtras,
    controlUrl: opts.controlUrl,
    controlToken: opts.controlToken,
    now: opts.now,
    worktreeId: opts.worktreeId,
  });

  if (deps.tmux && opts.sessionLayoutPlan) {
    ensureSessionLayout(deps.tmux, opts.sessionLayoutPlan);
  }

  return initialized;
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
