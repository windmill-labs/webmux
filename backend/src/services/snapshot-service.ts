import type { CreatingWorktreeState, PrEntry, ProjectSnapshot, WorktreeSnapshot } from "../domain/model";
import type { RuntimeNotification } from "./notification-service";
import { ProjectRuntime } from "./project-runtime";

function formatElapsedSince(startedAt: string | null, now: () => Date): string {
  if (!startedAt) return "";
  const startedMs = Date.parse(startedAt);
  if (Number.isNaN(startedMs)) return "";

  const diffMs = Math.max(0, now().getTime() - startedMs);
  const diffMinutes = Math.floor(diffMs / 60_000);

  if (diffMinutes < 1) return "0m";
  if (diffMinutes < 60) return `${diffMinutes}m`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d`;
}

function clonePrEntry(pr: PrEntry): PrEntry {
  return {
    ...pr,
    ciChecks: pr.ciChecks.map((check) => ({ ...check })),
    comments: pr.comments.map((comment) => ({ ...comment })),
  };
}

function mapCreationSnapshot(creating: CreatingWorktreeState | null): WorktreeSnapshot["creation"] {
  return creating
    ? {
        phase: creating.phase,
      }
    : null;
}

function mapWorktreeSnapshot(
  state: ReturnType<ProjectRuntime["listWorktrees"]>[number],
  now: () => Date,
  creating: CreatingWorktreeState | null,
  isArchived: (path: string) => boolean,
  findLinearIssue?: (branch: string) => WorktreeSnapshot["linearIssue"],
  findAgentLabel?: (agentId: string | null) => string | null,
): WorktreeSnapshot {
  return {
    branch: state.branch,
    ...(state.baseBranch ? { baseBranch: state.baseBranch } : {}),
    path: state.path,
    dir: state.path,
    archived: isArchived(state.path),
    profile: state.profile,
    agentName: state.agentName,
    agentLabel: findAgentLabel ? findAgentLabel(state.agentName) : state.agentName,
    mux: state.session.exists,
    dirty: state.git.dirty,
    unpushed: state.git.aheadCount > 0,
    paneCount: state.session.paneCount,
    status: creating ? "creating" : state.agent.lifecycle,
    elapsed: formatElapsedSince(state.agent.lastStartedAt, now),
    services: state.services.map((service) => ({ ...service })),
    prs: state.prs.map((pr) => clonePrEntry(pr)),
    linearIssue: findLinearIssue ? findLinearIssue(state.branch) : null,
    creation: mapCreationSnapshot(creating),
  };
}

function mapCreatingWorktreeSnapshot(
  creating: CreatingWorktreeState,
  isArchived: (path: string) => boolean,
  findLinearIssue?: (branch: string) => WorktreeSnapshot["linearIssue"],
  findAgentLabel?: (agentId: string | null) => string | null,
): WorktreeSnapshot {
  return {
    branch: creating.branch,
    ...(creating.baseBranch ? { baseBranch: creating.baseBranch } : {}),
    path: creating.path,
    dir: creating.path,
    archived: isArchived(creating.path),
    profile: creating.profile,
    agentName: creating.agentName,
    agentLabel: findAgentLabel ? findAgentLabel(creating.agentName) : creating.agentName,
    mux: false,
    dirty: false,
    unpushed: false,
    paneCount: 0,
    status: "creating",
    elapsed: "",
    services: [],
    prs: [],
    linearIssue: findLinearIssue ? findLinearIssue(creating.branch) : null,
    creation: mapCreationSnapshot(creating),
  };
}

interface BuildWorktreeSnapshotsInput {
  runtime: ProjectRuntime;
  creatingWorktrees?: CreatingWorktreeState[];
  isArchived?: (path: string) => boolean;
  findLinearIssue?: (branch: string) => WorktreeSnapshot["linearIssue"];
  findAgentLabel?: (agentId: string | null) => string | null;
  now?: () => Date;
}

export function buildWorktreeSnapshots(input: BuildWorktreeSnapshotsInput): WorktreeSnapshot[] {
  const now = input.now ?? (() => new Date());
  const isArchived = input.isArchived ?? (() => false);
  const creatingWorktrees = input.creatingWorktrees ?? [];
  const creatingByBranch = new Map(creatingWorktrees.map((worktree) => [worktree.branch, worktree]));
  const runtimeWorktrees = input.runtime.listWorktrees();
  const runtimeBranches = new Set(runtimeWorktrees.map((worktree) => worktree.branch));
  const worktrees = runtimeWorktrees.map((state) =>
    mapWorktreeSnapshot(
      state,
      now,
      creatingByBranch.get(state.branch) ?? null,
      isArchived,
      input.findLinearIssue,
      input.findAgentLabel,
    ),
  );

  for (const creating of creatingWorktrees) {
    if (!runtimeBranches.has(creating.branch)) {
      worktrees.push(mapCreatingWorktreeSnapshot(creating, isArchived, input.findLinearIssue, input.findAgentLabel));
    }
  }

  worktrees.sort((left, right) => left.branch.localeCompare(right.branch));

  return worktrees;
}

export function buildProjectSnapshot(input: BuildWorktreeSnapshotsInput & {
  projectName: string;
  mainBranch: string;
  notifications: RuntimeNotification[];
}): ProjectSnapshot {
  return {
    project: {
      name: input.projectName,
      mainBranch: input.mainBranch,
    },
    worktrees: buildWorktreeSnapshots(input),
    notifications: input.notifications.map((notification) => ({ ...notification })),
  };
}
