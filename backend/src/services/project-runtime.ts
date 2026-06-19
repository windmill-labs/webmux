import type { AgentStatusChangedEvent, RuntimeEvent, RuntimeErrorEvent } from "../domain/events";
import type {
  AgentId,
  RuntimeKind,
} from "../domain/config";
import type {
  ManagedWorktreeRuntimeState,
  OneshotMeta,
  PrEntry,
  ServiceRuntimeState,
  WorktreeSource,
  WorktreeTab,
} from "../domain/model";
import { buildWorktreeWindowName } from "../adapters/tmux";

function isoNow(now?: () => Date): string {
  return (now ?? (() => new Date()))().toISOString();
}

function makeDefaultState(input: {
  worktreeId: string;
  branch: string;
  label?: string | null;
  baseBranch?: string | null;
  path: string;
  profile?: string | null;
  agentName?: AgentId | null;
  agentTerminalStale?: boolean;
  runtime?: RuntimeKind;
  source?: WorktreeSource;
  oneshot?: OneshotMeta | null;
  tabs?: WorktreeTab[];
  activeTabId?: string | null;
}): ManagedWorktreeRuntimeState {
  return {
    worktreeId: input.worktreeId,
    branch: input.branch,
    label: input.label ?? null,
    baseBranch: input.baseBranch ?? null,
    path: input.path,
    profile: input.profile ?? null,
    agentName: input.agentName ?? null,
    source: input.source ?? "ui",
    oneshot: input.oneshot ?? null,
    tabs: input.tabs ?? [],
    activeTabId: input.activeTabId ?? null,
    agentTerminalStale: input.agentTerminalStale === true,
    git: {
      exists: true,
      branch: input.branch,
      dirty: false,
      aheadCount: 0,
      currentCommit: null,
    },
    session: {
      exists: false,
      sessionName: null,
      windowName: buildWorktreeWindowName(input.branch),
      paneCount: 0,
    },
    agent: {
      runtime: input.runtime ?? "host",
      lifecycle: "closed",
      lastStartedAt: null,
      lastEventAt: null,
      lastError: null,
    },
    services: [],
    prs: [],
  };
}

function clonePrEntry(pr: PrEntry): PrEntry {
  return {
    ...pr,
    ciChecks: pr.ciChecks.map((check) => ({ ...check })),
    comments: pr.comments.map((comment) => ({ ...comment })),
  };
}

export class ProjectRuntime {
  private readonly worktrees = new Map<string, ManagedWorktreeRuntimeState>();
  private readonly worktreeIdsByBranch = new Map<string, string>();

  upsertWorktree(input: {
    worktreeId: string;
    branch: string;
    label?: string | null;
    baseBranch?: string | null;
    path: string;
    profile?: string | null;
    agentName?: AgentId | null;
    agentTerminalStale?: boolean;
    runtime?: RuntimeKind;
    source?: WorktreeSource;
    oneshot?: OneshotMeta | null;
    tabs?: WorktreeTab[];
    activeTabId?: string | null;
  }): ManagedWorktreeRuntimeState {
    const existing = this.worktrees.get(input.worktreeId);
    if (existing) {
      this.reindexBranch(existing.branch, input.branch, input.worktreeId);
      existing.path = input.path;
      existing.branch = input.branch;
      if (input.label !== undefined) existing.label = input.label;
      if (input.baseBranch !== undefined) existing.baseBranch = input.baseBranch;
      existing.profile = input.profile ?? existing.profile;
      existing.agentName = input.agentName ?? existing.agentName;
      if (input.agentTerminalStale !== undefined) existing.agentTerminalStale = input.agentTerminalStale;
      if (input.runtime) existing.agent.runtime = input.runtime;
      if (input.source !== undefined) existing.source = input.source;
      if (input.oneshot !== undefined) existing.oneshot = input.oneshot;
      if (input.tabs !== undefined) existing.tabs = input.tabs;
      if (input.activeTabId !== undefined) existing.activeTabId = input.activeTabId;
      existing.git.exists = true;
      existing.git.branch = input.branch;
      existing.session.windowName = buildWorktreeWindowName(input.branch);
      return existing;
    }

    const created = makeDefaultState(input);
    this.worktrees.set(input.worktreeId, created);
    this.worktreeIdsByBranch.set(input.branch, input.worktreeId);
    return created;
  }

  /** Update the per-worktree oneshot meta in the runtime state. Called from the
   *  watcher (after disarm) and from lifecycle paths that arm a new oneshot run,
   *  so the next snapshot picks up the change without waiting for reconciliation. */
  setOneshot(worktreeId: string, oneshot: OneshotMeta | null): ManagedWorktreeRuntimeState {
    const state = this.requireWorktree(worktreeId);
    state.oneshot = oneshot;
    return state;
  }

  removeWorktree(worktreeId: string): boolean {
    const state = this.worktrees.get(worktreeId);
    if (!state) return false;
    this.worktreeIdsByBranch.delete(state.branch);
    return this.worktrees.delete(worktreeId);
  }

  getWorktree(worktreeId: string): ManagedWorktreeRuntimeState | null {
    return this.worktrees.get(worktreeId) ?? null;
  }

  getWorktreeByBranch(branch: string): ManagedWorktreeRuntimeState | null {
    const worktreeId = this.worktreeIdsByBranch.get(branch);
    return worktreeId ? this.worktrees.get(worktreeId) ?? null : null;
  }

  listWorktrees(): ManagedWorktreeRuntimeState[] {
    return [...this.worktrees.values()].sort((a, b) => a.branch.localeCompare(b.branch));
  }

  setGitState(
    worktreeId: string,
    patch: Partial<ManagedWorktreeRuntimeState["git"]>,
  ): ManagedWorktreeRuntimeState {
    const state = this.requireWorktree(worktreeId);
    if (patch.branch && patch.branch !== state.branch) {
      this.applyBranchChange(state, patch.branch);
    }
    state.git = { ...state.git, ...patch, branch: state.branch };
    return state;
  }

  setSessionState(
    worktreeId: string,
    patch: Partial<ManagedWorktreeRuntimeState["session"]>,
  ): ManagedWorktreeRuntimeState {
    const state = this.requireWorktree(worktreeId);
    state.session = { ...state.session, ...patch, windowName: buildWorktreeWindowName(state.branch) };
    return state;
  }

  setServices(worktreeId: string, services: ServiceRuntimeState[]): ManagedWorktreeRuntimeState {
    const state = this.requireWorktree(worktreeId);
    state.services = services.map((service) => ({ ...service }));
    return state;
  }

  setPrs(worktreeId: string, prs: PrEntry[]): ManagedWorktreeRuntimeState {
    const state = this.requireWorktree(worktreeId);
    state.prs = prs.map((pr) => clonePrEntry(pr));
    return state;
  }

  setAgentTerminalStale(worktreeId: string, stale: boolean): ManagedWorktreeRuntimeState {
    const state = this.requireWorktree(worktreeId);
    state.agentTerminalStale = stale;
    return state;
  }

  applyEvent(event: RuntimeEvent, now?: () => Date): ManagedWorktreeRuntimeState {
    const state = this.requireWorktree(event.worktreeId);
    if (event.branch !== state.branch) {
      this.applyBranchChange(state, event.branch);
    }
    const timestamp = isoNow(now);

    switch (event.type) {
      case "agent_stopped":
        state.agent.lifecycle = "stopped";
        state.agent.lastEventAt = timestamp;
        break;
      case "agent_status_changed":
        this.applyStatusChanged(state, event, timestamp);
        break;
      case "runtime_error":
        this.applyRuntimeError(state, event, timestamp);
        break;
      case "pr_opened":
        state.agent.lastEventAt = timestamp;
        break;
    }

    return state;
  }

  private applyStatusChanged(
    state: ManagedWorktreeRuntimeState,
    event: AgentStatusChangedEvent,
    timestamp: string,
  ): void {
    state.agent.lifecycle = event.lifecycle;
    state.agent.lastEventAt = timestamp;
    if (state.agent.lastStartedAt === null && event.lifecycle === "running") {
      state.agent.lastStartedAt = timestamp;
    }
    state.agent.lastError = null;
  }

  private applyRuntimeError(
    state: ManagedWorktreeRuntimeState,
    event: RuntimeErrorEvent,
    timestamp: string,
  ): void {
    state.agent.lifecycle = "error";
    state.agent.lastError = event.message;
    state.agent.lastEventAt = timestamp;
  }

  private applyBranchChange(state: ManagedWorktreeRuntimeState, branch: string): void {
    this.reindexBranch(state.branch, branch, state.worktreeId);
    state.branch = branch;
    state.git.branch = branch;
    state.session.windowName = buildWorktreeWindowName(branch);
  }

  private reindexBranch(previousBranch: string, nextBranch: string, worktreeId: string): void {
    if (previousBranch !== nextBranch) {
      this.worktreeIdsByBranch.delete(previousBranch);
    }
    this.worktreeIdsByBranch.set(nextBranch, worktreeId);
  }

  private requireWorktree(worktreeId: string): ManagedWorktreeRuntimeState {
    const state = this.worktrees.get(worktreeId);
    if (!state) {
      throw new Error(`Unknown worktree id: ${worktreeId}`);
    }
    return state;
  }
}
