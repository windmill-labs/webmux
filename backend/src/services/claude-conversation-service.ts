import { readWorktreeMeta, writeWorktreeMeta } from "../adapters/fs";
import type {
  ClaudeCliConversationMessage,
  ClaudeCliGateway,
  ClaudeCliSession,
} from "../adapters/claude-cli";
import type {
  AgentsUiConversationMessage,
  AgentsUiConversationState,
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
  claude: Pick<ClaudeCliGateway, "listSessions" | "readSession">;
  git: {
    resolveWorktreeGitDir(cwd: string): string;
  };
  now?: () => Date;
  readMeta?: (gitDir: string) => Promise<WorktreeMeta | null>;
  writeMeta?: (gitDir: string, meta: WorktreeMeta) => Promise<void>;
}

interface ResolvedClaudeConversation {
  conversationMeta: ClaudeWorktreeConversationMeta | null;
  session: ClaudeCliSession | null;
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

function buildConversationState(
  worktree: WorktreeSnapshot,
  session: ClaudeCliSession | null,
): AgentsUiConversationState {
  return {
    provider: "claudeCode",
    conversationId: session?.sessionId ?? buildPendingConversationId(worktree),
    cwd: worktree.path,
    running: false,
    activeTurnId: null,
    messages: normalizeSessionMessages(session?.messages ?? []),
  };
}

function toWorktreeConversationResponse(
  worktree: WorktreeSnapshot,
  conversationMeta: ClaudeWorktreeConversationMeta | null,
  session: ClaudeCliSession | null,
): AgentsUiWorktreeConversationResponse {
  return {
    worktree: buildAgentsUiWorktreeSummary(worktree, conversationMeta),
    conversation: buildConversationState(worktree, session),
  };
}

export class ClaudeConversationService {
  private readonly now: () => Date;
  private readonly readMeta;
  private readonly writeMeta;

  constructor(private readonly deps: ClaudeConversationServiceDependencies) {
    this.now = deps.now ?? (() => new Date());
    this.readMeta = deps.readMeta ?? readWorktreeMeta;
    this.writeMeta = deps.writeMeta ?? writeWorktreeMeta;
  }

  async attachWorktreeConversation(
    worktree: WorktreeSnapshot,
  ): Promise<WorktreeConversationResult<AgentsUiWorktreeConversationResponse>> {
    return await this.withResolvedConversation(worktree, async (resolved) =>
      ok(toWorktreeConversationResponse(worktree, resolved.conversationMeta, resolved.session))
    );
  }

  async readWorktreeConversation(
    worktree: WorktreeSnapshot,
  ): Promise<WorktreeConversationResult<AgentsUiWorktreeConversationResponse>> {
    return await this.withResolvedConversation(worktree, async (resolved) =>
      ok(toWorktreeConversationResponse(worktree, resolved.conversationMeta, resolved.session))
    );
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
