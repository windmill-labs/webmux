import type { AgentsUiWorktreeSummary } from "../domain/agents-ui";
import type { WorktreeConversationMeta, WorktreeSnapshot } from "../domain/model";

function cloneConversationMeta(meta: WorktreeConversationMeta | null): WorktreeConversationMeta | null {
  return meta ? { ...meta } : null;
}

export function buildAgentsUiWorktreeSummary(
  worktree: WorktreeSnapshot,
  conversation: WorktreeConversationMeta | null,
): AgentsUiWorktreeSummary {
  return {
    branch: worktree.branch,
    ...(worktree.baseBranch ? { baseBranch: worktree.baseBranch } : {}),
    path: worktree.path,
    archived: worktree.archived,
    profile: worktree.profile,
    agentName: worktree.agentName,
    agentLabel: worktree.agentLabel,
    mux: worktree.mux,
    status: worktree.status,
    dirty: worktree.dirty,
    unpushed: worktree.unpushed,
    services: worktree.services.map((service) => ({ ...service })),
    prs: worktree.prs.map((pr) => ({
      ...pr,
      ciChecks: pr.ciChecks.map((check) => ({ ...check })),
      comments: pr.comments.map((comment) => ({ ...comment })),
    })),
    creating: worktree.creation !== null,
    creationPhase: worktree.creation?.phase ?? null,
    conversation: cloneConversationMeta(conversation),
  };
}
