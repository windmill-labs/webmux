import type { RuntimeEvent, RuntimeErrorEvent, TitleChangedEvent } from "../domain/events";
import type {
  AgentKind,
  RuntimeKind,
} from "../domain/config";
import type {
  ManagedWorktreeRuntimeState,
  ServiceRuntimeState,
} from "../domain/model";
import { buildWorktreeWindowName } from "../adapters/tmux";

function isoNow(now?: () => Date): string {
  return (now ?? (() => new Date()))().toISOString();
}

function makeDefaultState(input: {
  branch: string;
  path: string;
  profile?: string | null;
  agentName?: AgentKind | null;
  runtime?: RuntimeKind;
}): ManagedWorktreeRuntimeState {
  return {
    branch: input.branch,
    path: input.path,
    profile: input.profile ?? null,
    agentName: input.agentName ?? null,
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
      title: "",
      lastStartedAt: null,
      lastEventAt: null,
      lastError: null,
    },
    services: [],
  };
}

export class ProjectRuntime {
  private readonly worktrees = new Map<string, ManagedWorktreeRuntimeState>();

  upsertWorktree(input: {
    branch: string;
    path: string;
    profile?: string | null;
    agentName?: AgentKind | null;
    runtime?: RuntimeKind;
  }): ManagedWorktreeRuntimeState {
    const existing = this.worktrees.get(input.branch);
    if (existing) {
      existing.path = input.path;
      existing.profile = input.profile ?? existing.profile;
      existing.agentName = input.agentName ?? existing.agentName;
      if (input.runtime) existing.agent.runtime = input.runtime;
      existing.git.exists = true;
      return existing;
    }

    const created = makeDefaultState(input);
    this.worktrees.set(input.branch, created);
    return created;
  }

  removeWorktree(branch: string): boolean {
    return this.worktrees.delete(branch);
  }

  getWorktree(branch: string): ManagedWorktreeRuntimeState | null {
    return this.worktrees.get(branch) ?? null;
  }

  listWorktrees(): ManagedWorktreeRuntimeState[] {
    return [...this.worktrees.values()].sort((a, b) => a.branch.localeCompare(b.branch));
  }

  setGitState(
    branch: string,
    patch: Partial<ManagedWorktreeRuntimeState["git"]>,
  ): ManagedWorktreeRuntimeState {
    const state = this.requireWorktree(branch);
    state.git = { ...state.git, ...patch, branch: state.branch };
    return state;
  }

  setSessionState(
    branch: string,
    patch: Partial<ManagedWorktreeRuntimeState["session"]>,
  ): ManagedWorktreeRuntimeState {
    const state = this.requireWorktree(branch);
    state.session = { ...state.session, ...patch, windowName: buildWorktreeWindowName(branch) };
    return state;
  }

  setServices(branch: string, services: ServiceRuntimeState[]): ManagedWorktreeRuntimeState {
    const state = this.requireWorktree(branch);
    state.services = services.map((service) => ({ ...service }));
    return state;
  }

  applyEvent(event: RuntimeEvent, now?: () => Date): ManagedWorktreeRuntimeState {
    const state = this.requireWorktree(event.branch);
    const timestamp = isoNow(now);

    switch (event.type) {
      case "agent_started":
        state.agent.lifecycle = "running";
        state.agent.lastStartedAt = timestamp;
        state.agent.lastEventAt = timestamp;
        state.agent.lastError = null;
        break;
      case "agent_stopped":
        state.agent.lifecycle = "stopped";
        state.agent.lastEventAt = timestamp;
        break;
      case "title_changed":
        this.applyTitleChanged(state, event, timestamp);
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

  private applyTitleChanged(
    state: ManagedWorktreeRuntimeState,
    event: TitleChangedEvent,
    timestamp: string,
  ): void {
    state.agent.title = event.title;
    state.agent.lastEventAt = timestamp;
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

  private requireWorktree(branch: string): ManagedWorktreeRuntimeState {
    const state = this.worktrees.get(branch);
    if (!state) {
      throw new Error(`Unknown worktree branch: ${branch}`);
    }
    return state;
  }
}
