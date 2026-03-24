import type { AgentKind } from "../domain/config";
import type { CreatingWorktreeState, WorktreeCreationPhase } from "../domain/model";

export interface WorktreeCreationProgress {
  branch: string;
  baseBranch?: string;
  path: string;
  profile: string;
  agent: AgentKind;
  phase: WorktreeCreationPhase;
}

export class WorktreeCreationTracker {
  private readonly worktrees = new Map<string, CreatingWorktreeState>();

  set(progress: WorktreeCreationProgress): void {
    const next: CreatingWorktreeState = {
      branch: progress.branch,
      ...(progress.baseBranch ? { baseBranch: progress.baseBranch } : {}),
      path: progress.path,
      profile: progress.profile,
      agentName: progress.agent,
      phase: progress.phase,
    };
    this.worktrees.set(progress.branch, next);
  }

  clear(branch: string): boolean {
    return this.worktrees.delete(branch);
  }

  has(branch: string): boolean {
    return this.worktrees.has(branch);
  }

  list(): CreatingWorktreeState[] {
    return [...this.worktrees.values()]
      .sort((left, right) => left.branch.localeCompare(right.branch))
      .map((state) => ({ ...state }));
  }
}
