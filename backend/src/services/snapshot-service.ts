import type { PrEntry, ProjectSnapshot, WorktreeSnapshot } from "../domain/model";
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

function mapWorktreeSnapshot(
  state: ReturnType<ProjectRuntime["listWorktrees"]>[number],
  now: () => Date,
  findLinearIssue?: (branch: string) => WorktreeSnapshot["linearIssue"],
): WorktreeSnapshot {
  return {
    branch: state.branch,
    path: state.path,
    dir: state.path,
    profile: state.profile,
    agentName: state.agentName,
    mux: state.session.exists,
    dirty: state.git.dirty || state.git.aheadCount > 0,
    paneCount: state.session.paneCount,
    status: state.agent.lifecycle,
    elapsed: formatElapsedSince(state.agent.lastStartedAt, now),
    services: state.services.map((service) => ({ ...service })),
    prs: state.prs.map((pr) => clonePrEntry(pr)),
    linearIssue: findLinearIssue ? findLinearIssue(state.branch) : null,
  };
}

export function buildProjectSnapshot(input: {
  projectName: string;
  mainBranch: string;
  runtime: ProjectRuntime;
  notifications: RuntimeNotification[];
  findLinearIssue?: (branch: string) => WorktreeSnapshot["linearIssue"];
  now?: () => Date;
}): ProjectSnapshot {
  const now = input.now ?? (() => new Date());

  return {
    project: {
      name: input.projectName,
      mainBranch: input.mainBranch,
    },
    worktrees: input.runtime.listWorktrees().map((state) =>
      mapWorktreeSnapshot(state, now, input.findLinearIssue),
    ),
    notifications: input.notifications.map((notification) => ({ ...notification })),
  };
}
