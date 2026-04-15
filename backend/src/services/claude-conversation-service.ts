import { readWorktreeMeta, writeWorktreeMeta } from "../adapters/fs";
import type {
  ClaudeCliConversationMessage,
  ClaudeCliGateway,
  ClaudeCliSession,
} from "../adapters/claude-cli";
import type {
  AgentsUiConversationEvent,
  AgentsUiConversationMessage,
  AgentsUiConversationState,
  AgentsUiInterruptResponse,
  AgentsUiSendMessageResponse,
  AgentsUiWorktreeConversationResponse,
} from "../domain/agents-ui";
import type {
  ClaudeWorktreeConversationMeta,
  WorktreeConversationMeta,
  WorktreeMeta,
  WorktreeSnapshot,
} from "../domain/model";
import { log } from "../lib/log";
import { buildAgentsUiWorktreeSummary } from "./agents-ui-service";
import { err, ok, type WorktreeConversationResult } from "./worktree-conversation-result";

export interface ClaudeConversationServiceDependencies {
  claude: ClaudeCliGateway;
  git: {
    resolveWorktreeGitDir(cwd: string): string;
  };
  now?: () => Date;
  readMeta?: (gitDir: string) => Promise<WorktreeMeta | null>;
  writeMeta?: (gitDir: string, meta: WorktreeMeta) => Promise<void>;
}

interface ResolvedClaudeConversation {
  conversationMeta: ClaudeWorktreeConversationMeta | null;
  gitDir: string;
  meta: WorktreeMeta;
  session: ClaudeCliSession | null;
}

interface ActiveClaudeRun {
  assistantText: string;
  branch: string;
  conversationId: string | null;
  cwd: string;
  gitDir: string;
  interrupt: () => void;
  interrupted: boolean;
  itemId: string;
  meta: WorktreeMeta;
  startedAt: string;
  turnId: string;
  userText: string;
}

function isClaudeWorktree(worktree: WorktreeSnapshot): boolean {
  return worktree.agentName === "claude";
}

function isClaudeConversationMeta(meta: WorktreeConversationMeta | null | undefined): meta is ClaudeWorktreeConversationMeta {
  return meta?.provider === "claudeCode";
}

function buildPendingConversationId(worktree: WorktreeSnapshot): string {
  return `claude-pending:${worktree.path}`;
}

function buildClaudeConversationMeta(sessionId: string, cwd: string, now: Date): ClaudeWorktreeConversationMeta {
  return {
    provider: "claudeCode",
    conversationId: sessionId,
    sessionId,
    cwd,
    lastSeenAt: now.toISOString(),
  };
}

function sameConversationMeta(left: WorktreeConversationMeta | null | undefined, right: ClaudeWorktreeConversationMeta): boolean {
  return left?.provider === right.provider
    && left.conversationId === right.conversationId
    && left.cwd === right.cwd;
}

function normalizeSessionMessages(messages: ClaudeCliConversationMessage[]): AgentsUiConversationMessage[] {
  return messages.map((message) => ({
    ...message,
    status: "completed",
  }));
}

function hasRecordedRunPrompt(
  messages: AgentsUiConversationMessage[],
  run: ActiveClaudeRun,
): boolean {
  return messages.some((message) =>
    message.role === "user"
      && message.text === run.userText
      && message.createdAt !== null
      && message.createdAt >= run.startedAt
  );
}

function buildConversationState(
  worktree: WorktreeSnapshot,
  session: ClaudeCliSession | null,
  activeRun: ActiveClaudeRun | null,
): AgentsUiConversationState {
  const baseMessages = normalizeSessionMessages(session?.messages ?? []);
  const nextMessages = [...baseMessages];

  if (activeRun && !hasRecordedRunPrompt(baseMessages, activeRun)) {
    nextMessages.push({
      id: `pending-user:${activeRun.turnId}`,
      turnId: activeRun.turnId,
      role: "user",
      text: activeRun.userText,
      status: "completed",
      createdAt: activeRun.startedAt,
    });
  }

  if (activeRun && activeRun.assistantText.length > 0) {
    nextMessages.push({
      id: activeRun.itemId,
      turnId: activeRun.turnId,
      role: "assistant",
      text: activeRun.assistantText,
      status: "inProgress",
      createdAt: null,
    });
  }

  return {
    provider: "claudeCode",
    conversationId: session?.sessionId ?? activeRun?.conversationId ?? buildPendingConversationId(worktree),
    cwd: worktree.path,
    running: activeRun !== null,
    activeTurnId: activeRun?.turnId ?? null,
    messages: nextMessages,
  };
}

function toWorktreeConversationResponse(
  worktree: WorktreeSnapshot,
  conversationMeta: ClaudeWorktreeConversationMeta | null,
  session: ClaudeCliSession | null,
  activeRun: ActiveClaudeRun | null,
): AgentsUiWorktreeConversationResponse {
  return {
    worktree: buildAgentsUiWorktreeSummary(worktree, conversationMeta),
    conversation: buildConversationState(worktree, session, activeRun),
  };
}

export class ClaudeConversationService {
  private readonly activeRuns = new Map<string, ActiveClaudeRun>();
  private readonly listeners = new Map<string, Set<(event: AgentsUiConversationEvent) => void>>();
  private readonly now: () => Date;
  private readonly readMeta;
  private readonly writeMeta;

  constructor(private readonly deps: ClaudeConversationServiceDependencies) {
    this.now = deps.now ?? (() => new Date());
    this.readMeta = deps.readMeta ?? readWorktreeMeta;
    this.writeMeta = deps.writeMeta ?? writeWorktreeMeta;
  }

  subscribe(branch: string, listener: (event: AgentsUiConversationEvent) => void): () => void {
    const listeners = this.listeners.get(branch) ?? new Set<(event: AgentsUiConversationEvent) => void>();
    listeners.add(listener);
    this.listeners.set(branch, listeners);
    return () => {
      const current = this.listeners.get(branch);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) {
        this.listeners.delete(branch);
      }
    };
  }

  async attachWorktreeConversation(
    worktree: WorktreeSnapshot,
  ): Promise<WorktreeConversationResult<AgentsUiWorktreeConversationResponse>> {
    return await this.withResolvedConversation(worktree, async (resolved) =>
      ok(toWorktreeConversationResponse(
        worktree,
        resolved.conversationMeta,
        resolved.session,
        this.activeRuns.get(worktree.branch) ?? null,
      ))
    );
  }

  async readWorktreeConversation(
    worktree: WorktreeSnapshot,
  ): Promise<WorktreeConversationResult<AgentsUiWorktreeConversationResponse>> {
    return await this.withResolvedConversation(worktree, async (resolved) =>
      ok(toWorktreeConversationResponse(
        worktree,
        resolved.conversationMeta,
        resolved.session,
        this.activeRuns.get(worktree.branch) ?? null,
      ))
    );
  }

  async sendWorktreeMessage(
    worktree: WorktreeSnapshot,
    text: string,
  ): Promise<WorktreeConversationResult<AgentsUiSendMessageResponse>> {
    const message = text.trim();
    if (message.length === 0) {
      return err(400, "Message text is required");
    }

    if (this.activeRuns.has(worktree.branch)) {
      return err(409, "A turn is already running for this worktree");
    }

    return await this.withResolvedConversation(worktree, async (resolved) => {
      const turnId = crypto.randomUUID();
      const activeRun: ActiveClaudeRun = {
        assistantText: "",
        branch: worktree.branch,
        conversationId: resolved.conversationMeta?.sessionId ?? null,
        cwd: worktree.path,
        gitDir: resolved.gitDir,
        interrupt: () => {},
        interrupted: false,
        itemId: `assistant:${turnId}`,
        meta: resolved.meta,
        startedAt: this.now().toISOString(),
        turnId,
        userText: message,
      };
      this.activeRuns.set(worktree.branch, activeRun);

      const runHandle = this.deps.claude.sendMessage({
        cwd: worktree.path,
        prompt: message,
        resumeSessionId: resolved.conversationMeta?.sessionId ?? undefined,
      }, {
        onAssistantDelta: (delta) => {
          const current = this.activeRuns.get(worktree.branch);
          if (!current) return;
          current.assistantText += delta;
          if (!current.conversationId) return;
          this.emit(worktree.branch, {
            type: "messageDelta",
            conversationId: current.conversationId,
            turnId: current.turnId,
            itemId: current.itemId,
            delta,
          });
        },
        onComplete: (sessionId) => {
          void this.persistConversationMeta(activeRun.gitDir, activeRun.meta, worktree.path, sessionId);
        },
        onError: (error) => {
          if (activeRun.interrupted) return;
          this.emit(worktree.branch, {
            type: "error",
            message: error,
          });
        },
        onSessionId: (sessionId) => {
          activeRun.conversationId = sessionId;
          void this.persistConversationMeta(activeRun.gitDir, activeRun.meta, worktree.path, sessionId);
        },
      });
      activeRun.interrupt = runHandle.interrupt;

      void runHandle.completion.finally(() => {
        void this.handleRunCompleted(worktree);
      });

      let sessionId: string;
      try {
        sessionId = await runHandle.sessionId;
      } catch (error) {
        this.activeRuns.delete(worktree.branch);
        const message = error instanceof Error ? error.message : String(error);
        return err(502, message);
      }

      activeRun.conversationId = sessionId;
      return ok({
        conversationId: sessionId,
        turnId,
        running: true,
      });
    });
  }

  async interruptWorktreeConversation(
    worktree: WorktreeSnapshot,
  ): Promise<WorktreeConversationResult<AgentsUiInterruptResponse>> {
    if (!isClaudeWorktree(worktree)) {
      return err(409, "Worktree chat is only available for Claude worktrees");
    }

    const activeRun = this.activeRuns.get(worktree.branch);
    if (!activeRun) {
      return err(409, "No active turn is running for this worktree");
    }

    activeRun.interrupted = true;
    activeRun.interrupt();
    const currentConversationId = activeRun.conversationId ?? buildPendingConversationId(worktree);
    return ok({
      conversationId: currentConversationId,
      turnId: activeRun.turnId,
      interrupted: true,
    });
  }

  private async withResolvedConversation<T>(
    worktree: WorktreeSnapshot,
    fn: (resolved: ResolvedClaudeConversation) => Promise<WorktreeConversationResult<T>>,
  ): Promise<WorktreeConversationResult<T>> {
    if (!isClaudeWorktree(worktree)) {
      return err(409, "Worktree chat is only available for Claude worktrees");
    }

    try {
      const resolved = await this.resolveConversation(worktree);
      if (!resolved.ok) return resolved;
      return await fn(resolved.data);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return err(502, message);
    }
  }

  private async resolveConversation(
    worktree: WorktreeSnapshot,
  ): Promise<WorktreeConversationResult<ResolvedClaudeConversation>> {
    const gitDir = this.deps.git.resolveWorktreeGitDir(worktree.path);
    const meta = await this.readMeta(gitDir);
    if (!meta) {
      return err(409, "Worktree metadata is missing");
    }

    const session = await this.resolveSession(meta, worktree.path);
    const conversationMeta = session
      ? await this.persistConversationMeta(gitDir, meta, worktree.path, session.sessionId)
      : null;

    return ok({
      conversationMeta,
      gitDir,
      meta: conversationMeta ? { ...meta, conversation: conversationMeta } : meta,
      session,
    });
  }

  private async resolveSession(meta: WorktreeMeta, cwd: string): Promise<ClaudeCliSession | null> {
    const savedSessionId = isClaudeConversationMeta(meta.conversation)
      ? meta.conversation.sessionId
      : null;
    if (savedSessionId) {
      const savedSession = await this.deps.claude.readSession(savedSessionId, cwd);
      if (savedSession) return savedSession;
      log.warn(`[agents] saved Claude session missing, rediscovering cwd=${cwd} sessionId=${savedSessionId}`);
    }

    const discovered = (await this.deps.claude.listSessions(cwd))[0] ?? null;
    if (!discovered) return null;
    return await this.deps.claude.readSession(discovered.sessionId, cwd);
  }

  private emit(branch: string, event: AgentsUiConversationEvent): void {
    const listeners = this.listeners.get(branch);
    if (!listeners) return;
    for (const listener of listeners) {
      listener(event);
    }
  }

  private async handleRunCompleted(worktree: WorktreeSnapshot): Promise<void> {
    const activeRun = this.activeRuns.get(worktree.branch);
    this.activeRuns.delete(worktree.branch);

    const snapshot = await this.readWorktreeConversation(worktree);
    if (snapshot.ok) {
      this.emit(worktree.branch, {
        type: "snapshot",
        data: snapshot.data,
      });
      return;
    }

    if (!activeRun?.interrupted) {
      this.emit(worktree.branch, {
        type: "error",
        message: snapshot.error,
      });
    }
  }

  private async persistConversationMeta(
    gitDir: string,
    meta: WorktreeMeta,
    cwd: string,
    sessionId: string,
  ): Promise<ClaudeWorktreeConversationMeta> {
    const nextConversation = buildClaudeConversationMeta(sessionId, cwd, this.now());
    if (!sameConversationMeta(meta.conversation, nextConversation)) {
      await this.writeMeta(gitDir, {
        ...meta,
        conversation: nextConversation,
      });
    }
    return nextConversation;
  }
}
