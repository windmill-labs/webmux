import { readWorktreeMeta, writeWorktreeMeta } from "../adapters/fs";
import type {
  CodexAppServerAgentMessageItem,
  CodexAppServerThread,
  CodexAppServerThreadItem,
  CodexAppServerThreadListResponse,
  CodexAppServerTurn,
  CodexAppServerUserMessageItem,
} from "../adapters/codex-app-server";
import type { GitGateway } from "../adapters/git";
import type {
  AgentsUiConversationMessage,
  AgentsUiConversationState,
  AgentsUiWorktreeConversationResponse,
} from "../domain/agents-ui";
import type {
  CodexWorktreeConversationMeta,
  WorktreeConversationMeta,
  WorktreeMeta,
  WorktreeSnapshot,
} from "../domain/model";
import { log } from "../lib/log";
import { buildAgentsUiWorktreeSummary } from "./agents-ui-service";
import { err, ok, type WorktreeConversationResult } from "./worktree-conversation-result";

export interface WorktreeConversationServiceDependencies {
  appServer: Pick<import("../adapters/codex-app-server").CodexAppServerGateway, "threadList" | "threadRead" | "threadResume" | "threadStart">;
  git: Pick<GitGateway, "resolveWorktreeGitDir">;
  now?: () => Date;
  readMeta?: (gitDir: string) => Promise<WorktreeMeta | null>;
  writeMeta?: (gitDir: string, meta: WorktreeMeta) => Promise<void>;
}

interface ResolvedConversation {
  gitDir: string;
  meta: WorktreeMeta;
  thread: CodexAppServerThread;
  conversationMeta: WorktreeConversationMeta;
}

function isCodexWorktree(worktree: WorktreeSnapshot): boolean {
  return worktree.agentName === "codex";
}

function isCodexConversationMeta(meta: WorktreeConversationMeta | null | undefined): meta is CodexWorktreeConversationMeta {
  return meta?.provider === "codexAppServer";
}

function toIsoTimestamp(epochSeconds: number | null): string | null {
  if (epochSeconds === null) return null;
  return new Date(epochSeconds * 1000).toISOString();
}

function isUserMessageItem(item: CodexAppServerThreadItem): item is CodexAppServerUserMessageItem {
  return item.type === "userMessage";
}

function isAgentMessageItem(item: CodexAppServerThreadItem): item is CodexAppServerAgentMessageItem {
  return item.type === "agentMessage";
}

function extractUserText(item: CodexAppServerUserMessageItem): string {
  return item.content
    .map((contentItem) => contentItem.text ?? "")
    .join("")
    .trim();
}

function isActiveTurnStatus(status: string): boolean {
  return status === "inProgress"
    || status === "active"
    || status === "running"
    || status === "pending"
    || status === "queued";
}

function findActiveTurn(thread: CodexAppServerThread): CodexAppServerTurn | null {
  for (let index = thread.turns.length - 1; index >= 0; index -= 1) {
    const turn = thread.turns[index];
    if (isActiveTurnStatus(turn.status)) return turn;
  }

  return null;
}

function buildConversationMessages(thread: CodexAppServerThread): AgentsUiConversationMessage[] {
  const messages: AgentsUiConversationMessage[] = [];

  for (const turn of thread.turns) {
    for (const item of turn.items) {
      if (isUserMessageItem(item)) {
        const text = extractUserText(item);
        if (text.length === 0) continue;
        messages.push({
          id: item.id,
          turnId: turn.id,
          role: "user",
          text,
          status: "completed",
          createdAt: toIsoTimestamp(turn.startedAt),
        });
        continue;
      }

      if (!isAgentMessageItem(item)) continue;
      if (item.text.length === 0) continue;

      messages.push({
        id: item.id,
        turnId: turn.id,
        role: "assistant",
        text: item.text,
        status: isActiveTurnStatus(turn.status) ? "inProgress" : "completed",
        createdAt: toIsoTimestamp(turn.completedAt ?? turn.startedAt),
      });
    }
  }

  return messages;
}

export function buildConversationState(thread: CodexAppServerThread): AgentsUiConversationState {
  const activeTurn = findActiveTurn(thread);
  return {
    provider: "codexAppServer",
    conversationId: thread.id,
    cwd: thread.cwd,
    running: thread.status.type === "active" || activeTurn !== null,
    activeTurnId: activeTurn?.id ?? null,
    messages: buildConversationMessages(thread),
  };
}

export function selectDiscoveredThread(threads: CodexAppServerThreadListResponse["data"]): CodexAppServerThread | null {
  if (threads.length === 0) return null;

  return [...threads]
    .sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null;
}

function buildConversationMeta(thread: CodexAppServerThread, now: Date): CodexWorktreeConversationMeta {
  return {
    provider: "codexAppServer",
    conversationId: thread.id,
    threadId: thread.id,
    cwd: thread.cwd,
    lastSeenAt: now.toISOString(),
  };
}

function sameConversationMeta(left: WorktreeConversationMeta | null | undefined, right: WorktreeConversationMeta): boolean {
  return left?.provider === right.provider
    && left.conversationId === right.conversationId
    && left.cwd === right.cwd;
}

function toWorktreeConversationResponse(
  worktree: WorktreeSnapshot,
  conversationMeta: WorktreeConversationMeta,
  thread: CodexAppServerThread,
): AgentsUiWorktreeConversationResponse {
  return {
    worktree: buildAgentsUiWorktreeSummary(worktree, conversationMeta),
    conversation: buildConversationState(thread),
  };
}

export class WorktreeConversationService {
  private readonly now: () => Date;
  private readonly readMeta;
  private readonly writeMeta;

  constructor(private readonly deps: WorktreeConversationServiceDependencies) {
    this.now = deps.now ?? (() => new Date());
    this.readMeta = deps.readMeta ?? readWorktreeMeta;
    this.writeMeta = deps.writeMeta ?? writeWorktreeMeta;
  }

  async attachWorktreeConversation(
    worktree: WorktreeSnapshot,
  ): Promise<WorktreeConversationResult<AgentsUiWorktreeConversationResponse>> {
    return await this.withResolvedConversation(worktree, true, async ({ conversationMeta, thread }) =>
      ok(toWorktreeConversationResponse(worktree, conversationMeta, thread))
    );
  }

  async readWorktreeConversation(
    worktree: WorktreeSnapshot,
  ): Promise<WorktreeConversationResult<AgentsUiWorktreeConversationResponse>> {
    return await this.withResolvedConversation(worktree, false, async ({ conversationMeta, thread }) =>
      ok(toWorktreeConversationResponse(worktree, conversationMeta, thread))
    );
  }

  private async withResolvedConversation<T>(
    worktree: WorktreeSnapshot,
    allowCreate: boolean,
    fn: (resolved: ResolvedConversation) => Promise<WorktreeConversationResult<T>>,
  ): Promise<WorktreeConversationResult<T>> {
    if (!isCodexWorktree(worktree)) {
      return err(409, "Worktree chat is only available for Codex worktrees");
    }

    try {
      const resolved = await this.resolveConversation(worktree, allowCreate);
      if (!resolved.ok) return resolved;
      return await fn(resolved.data);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return err(502, message);
    }
  }

  private async resolveConversation(
    worktree: WorktreeSnapshot,
    allowCreate: boolean,
  ): Promise<WorktreeConversationResult<ResolvedConversation>> {
    const gitDir = this.deps.git.resolveWorktreeGitDir(worktree.path);
    const meta = await this.readMeta(gitDir);
    if (!meta) {
      return err(409, "Worktree metadata is missing");
    }

    const now = this.now();
    const thread = await this.resolveThread(meta, worktree.path, allowCreate);
    if (!thread) {
      return err(404, "No Codex thread could be resolved for this worktree");
    }

    const conversationMeta = buildConversationMeta(thread, now);
    const nextMeta = sameConversationMeta(meta.conversation, conversationMeta)
      ? { ...meta, conversation: { ...conversationMeta, lastSeenAt: meta.conversation?.lastSeenAt ?? conversationMeta.lastSeenAt } }
      : { ...meta, conversation: conversationMeta };

    if (!sameConversationMeta(meta.conversation, conversationMeta)) {
      await this.writeMeta(gitDir, nextMeta);
    }

    return ok({
      gitDir,
      meta: nextMeta,
      thread,
      conversationMeta: nextMeta.conversation ?? conversationMeta,
    });
  }

  private async resolveThread(
    meta: WorktreeMeta,
    cwd: string,
    allowCreate: boolean,
  ): Promise<CodexAppServerThread | null> {
    const discoveredThread = selectDiscoveredThread((await this.deps.appServer.threadList({
      cwd,
      limit: 20,
      sortKey: "updated_at",
    })).data);
    if (discoveredThread) {
      return await this.ensureThreadLoaded(discoveredThread.id, cwd);
    }

    const savedThreadId = isCodexConversationMeta(meta.conversation)
      ? meta.conversation.threadId
      : null;
    if (savedThreadId) {
      const savedThread = await this.tryLoadThread(savedThreadId, cwd);
      if (savedThread) return savedThread;
      log.warn(`[agents] saved codex thread missing, rediscovering cwd=${cwd} threadId=${savedThreadId}`);
    }

    if (!allowCreate) return null;

    const started = await this.deps.appServer.threadStart({
      cwd,
      approvalPolicy: "never",
      personality: "pragmatic",
      sandbox: "danger-full-access",
    });
    return started.thread;
  }

  private async tryLoadThread(threadId: string, cwd: string): Promise<CodexAppServerThread | null> {
    try {
      return await this.ensureThreadLoaded(threadId, cwd);
    } catch {
      return null;
    }
  }

  private async ensureThreadLoaded(threadId: string, cwd: string): Promise<CodexAppServerThread> {
    const initial = await this.deps.appServer.threadRead(threadId, false);
    if (initial.thread.status.type === "notLoaded") {
      await this.deps.appServer.threadResume({
        threadId,
        cwd,
        approvalPolicy: "never",
        personality: "pragmatic",
      });
    }

    return (await this.deps.appServer.threadRead(threadId, true)).thread;
  }
}
