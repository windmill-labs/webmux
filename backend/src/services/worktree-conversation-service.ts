import { readWorktreeMeta, writeWorktreeMeta } from "../adapters/fs";
import type {
  CodexAppServerAgentMessageItem,
  CodexAppServerApprovalPolicy,
  CodexAppServerCommandExecutionItem,
  CodexAppServerPersonality,
  CodexAppServerSandboxMode,
  CodexAppServerThread,
  CodexAppServerThreadItem,
  CodexAppServerThreadListResponse,
  CodexAppServerTurn,
  CodexAppServerUserMessageItem,
} from "../adapters/codex-app-server";
import type { GitGateway } from "../adapters/git";
import type { ProfileConfig } from "../domain/config";
import type {
  AgentsUiConversationMessage,
  AgentsUiConversationState,
  AgentsUiInterruptResponse,
  AgentsUiSendMessageResponse,
  AgentsUiWorktreeConversationResponse,
} from "../domain/agents-ui";
import type {
  CodexWorktreeConversationMeta,
  WorktreeConversationMeta,
  WorktreeMeta,
  WorktreeSnapshot,
} from "../domain/model";
import { log } from "../lib/log";
import { readCodexSessionMessages } from "./codex-session-log-service";
import { buildAgentsUiWorktreeSummary } from "./agents-ui-service";
import { err, ok, type WorktreeConversationResult } from "./worktree-conversation-result";

export interface CodexAppServerLaunchContext {
  approvalPolicy: CodexAppServerApprovalPolicy;
  personality: CodexAppServerPersonality;
  sandbox: CodexAppServerSandboxMode;
}

export interface ResolveCodexAppServerLaunchContextInput {
  worktree: WorktreeSnapshot;
  meta: WorktreeMeta;
}

export interface WorktreeConversationServiceDependencies {
  appServer: Pick<import("../adapters/codex-app-server").CodexAppServerGateway, "threadList" | "threadRead" | "threadResume" | "threadStart" | "turnStart" | "turnInterrupt">;
  git: Pick<GitGateway, "resolveWorktreeGitDir">;
  resolveLaunchContext: (
    input: ResolveCodexAppServerLaunchContextInput,
  ) => Promise<WorktreeConversationResult<CodexAppServerLaunchContext>> | WorktreeConversationResult<CodexAppServerLaunchContext>;
  readSessionMessages?: (thread: CodexAppServerThread) => Promise<AgentsUiConversationMessage[]>;
  now?: () => Date;
  readMeta?: (gitDir: string) => Promise<WorktreeMeta | null>;
  writeMeta?: (gitDir: string, meta: WorktreeMeta) => Promise<void>;
}

interface ResolvedConversation {
  gitDir: string;
  meta: WorktreeMeta;
  thread: CodexAppServerThread;
  conversationMeta: WorktreeConversationMeta;
  launchContext: CodexAppServerLaunchContext;
}

export function resolveCodexAppServerLaunchContext(input: {
  worktree: WorktreeSnapshot;
  meta: WorktreeMeta;
  profile: ProfileConfig | null | undefined;
}): WorktreeConversationResult<CodexAppServerLaunchContext> {
  if (input.worktree.agentName !== "codex" || input.meta.agent !== "codex") {
    return err(409, "Codex web chat is only available for Codex worktrees");
  }

  if (!input.profile) {
    return err(409, `Profile is missing for Codex web chat: ${input.meta.profile}`);
  }

  if (input.meta.runtime !== "host" || input.profile.runtime !== "host") {
    return err(409, "Codex web chat is only available for host-runtime worktrees. Use the terminal for Docker worktrees.");
  }

  if (input.profile.yolo !== true) {
    return err(409, "Codex web chat requires a yolo profile to preserve the Codex approval policy. Use the terminal for this worktree.");
  }

  return ok({
    approvalPolicy: "never",
    personality: "pragmatic",
    sandbox: "danger-full-access",
  });
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

function isCommandExecutionItem(item: CodexAppServerThreadItem): item is CodexAppServerCommandExecutionItem {
  return item.type === "commandExecution";
}

function extractUserText(item: CodexAppServerUserMessageItem): string {
  return item.content
    .map((contentItem) => contentItem.text ?? "")
    .join("")
    .trim();
}

function extractAgentText(item: CodexAppServerAgentMessageItem): string {
  return item.text ?? item.message ?? "";
}

function commandExecutionStatus(item: CodexAppServerCommandExecutionItem): AgentsUiConversationMessage["status"] {
  if (isActiveTurnStatus(item.status)) return "inProgress";
  if (item.exitCode !== null && item.exitCode !== 0) return "failed";
  if (item.status === "failed" || item.status === "error" || item.status === "cancelled") return "failed";
  return "completed";
}

function commandExecutionDisplayText(item: CodexAppServerCommandExecutionItem): string {
  const commands = item.commandActions
    .map((action) => action.command ?? "")
    .filter((command) => command.length > 0);
  return commands.length > 0 ? commands.join(" && ") : item.command;
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

export function buildCodexItemConversationMessages(input: {
  item: CodexAppServerThreadItem;
  turnId: string;
  turnStatus: string;
  createdAt: string | null;
  includeEmptyText?: boolean;
}): AgentsUiConversationMessage[] {
  const { item, turnId, turnStatus, createdAt, includeEmptyText = false } = input;
  if (isUserMessageItem(item)) {
    const text = extractUserText(item);
    if (text.length === 0 && !includeEmptyText) return [];
    return [{
      id: item.id,
      turnId,
      role: "user",
      kind: "text",
      text,
      status: "completed",
      createdAt,
    }];
  }

  if (isAgentMessageItem(item)) {
    const text = extractAgentText(item);
    if (text.length === 0 && !includeEmptyText) return [];
    const isThinking = item.phase === "analysis";
    return [{
      id: item.id,
      turnId,
      role: "assistant",
      kind: isThinking ? "thinking" : "text",
      phase: item.phase,
      text,
      status: isActiveTurnStatus(turnStatus) ? "inProgress" : "completed",
      createdAt,
    }];
  }

  if (!isCommandExecutionItem(item)) return [];

  const status = commandExecutionStatus(item);
  const toolUse: AgentsUiConversationMessage = {
    id: item.id,
    turnId,
    role: "assistant",
    kind: "toolUse",
    toolName: "shell",
    toolCallId: item.id,
    text: commandExecutionDisplayText(item),
    command: item.command,
    cwd: item.cwd ?? undefined,
    status,
    createdAt,
    exitCode: item.exitCode,
    durationMs: item.durationMs,
  };
  const output = item.aggregatedOutput?.trimEnd() ?? "";
  if (output.length === 0) return [toolUse];

  return [
    toolUse,
    {
      id: `${item.id}:result`,
      turnId,
      role: "user",
      kind: "toolResult",
      toolName: "shell",
      toolCallId: item.id,
      text: output,
      command: item.command,
      cwd: item.cwd ?? undefined,
      status,
      createdAt,
      exitCode: item.exitCode,
      durationMs: item.durationMs,
    },
  ];
}

function compareMessagesByTimestamp(left: AgentsUiConversationMessage, right: AgentsUiConversationMessage): number {
  if (!left.createdAt || !right.createdAt) return 0;
  return Date.parse(left.createdAt) - Date.parse(right.createdAt);
}

function messageKind(message: AgentsUiConversationMessage): NonNullable<AgentsUiConversationMessage["kind"]> {
  return message.kind ?? "text";
}

function normalizeMessageText(text: string): string {
  return text.trim();
}

function sameOptionalValue(left: string | undefined, right: string | undefined): boolean {
  return !left || !right || left === right;
}

function isSameLogicalMessage(left: AgentsUiConversationMessage, right: AgentsUiConversationMessage): boolean {
  if (left.id === right.id) return true;
  if (left.turnId !== right.turnId) return false;
  if (left.role !== right.role) return false;
  if (messageKind(left) !== messageKind(right)) return false;

  const kind = messageKind(left);
  if (kind === "toolUse") {
    return normalizeMessageText(left.text) === normalizeMessageText(right.text)
      && sameOptionalValue(left.cwd, right.cwd);
  }

  if (kind === "toolResult") {
    return normalizeMessageText(left.text) === normalizeMessageText(right.text)
      && sameOptionalValue(left.cwd, right.cwd);
  }

  return false;
}

function mergeMessageStatus(
  left: AgentsUiConversationMessage["status"],
  right: AgentsUiConversationMessage["status"],
): AgentsUiConversationMessage["status"] {
  if (left === "failed" || right === "failed") return "failed";
  if (left === "inProgress" || right === "inProgress") return "inProgress";
  return "completed";
}

function mergeMessageSources(
  base: AgentsUiConversationMessage,
  additional: AgentsUiConversationMessage,
): AgentsUiConversationMessage {
  const text = base.text.length >= additional.text.length ? base.text : additional.text;
  return {
    ...additional,
    ...base,
    text,
    status: mergeMessageStatus(base.status, additional.status),
    createdAt: base.createdAt ?? additional.createdAt,
    command: base.command ?? additional.command,
    cwd: base.cwd ?? additional.cwd,
    exitCode: base.exitCode ?? additional.exitCode,
    durationMs: base.durationMs ?? additional.durationMs,
  };
}

function mergeConversationMessages(
  baseMessages: AgentsUiConversationMessage[],
  additionalMessages: AgentsUiConversationMessage[],
): AgentsUiConversationMessage[] {
  if (additionalMessages.length === 0) return baseMessages;

  const merged = [...baseMessages];
  const matchedIndexes = new Set<number>();
  for (const message of additionalMessages) {
    const existingIndex = merged.findIndex((candidate, index) =>
      !matchedIndexes.has(index) && isSameLogicalMessage(candidate, message)
    );
    if (existingIndex === -1) {
      merged.push(message);
    } else {
      matchedIndexes.add(existingIndex);
      merged[existingIndex] = mergeMessageSources(merged[existingIndex], message);
    }
  }

  return merged
    .map((message, index) => ({ message, index }))
    .sort((left, right) => compareMessagesByTimestamp(left.message, right.message) || left.index - right.index)
    .map(({ message }) => message);
}

function buildConversationMessages(thread: CodexAppServerThread): AgentsUiConversationMessage[] {
  const messages: AgentsUiConversationMessage[] = [];

  for (const turn of thread.turns) {
    for (const item of turn.items) {
      messages.push(...buildCodexItemConversationMessages({
        item,
        turnId: turn.id,
        turnStatus: turn.status,
        createdAt: toIsoTimestamp(isUserMessageItem(item) ? turn.startedAt : turn.completedAt ?? turn.startedAt),
      }));
    }
  }

  return messages;
}

export function buildConversationState(
  thread: CodexAppServerThread,
  additionalMessages: AgentsUiConversationMessage[] = [],
): AgentsUiConversationState {
  const activeTurn = findActiveTurn(thread);
  return {
    provider: "codexAppServer",
    conversationId: thread.id,
    cwd: thread.cwd,
    running: thread.status.type === "active" || activeTurn !== null,
    activeTurnId: activeTurn?.id ?? null,
    messages: mergeConversationMessages(buildConversationMessages(thread), additionalMessages),
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
  additionalMessages: AgentsUiConversationMessage[],
): AgentsUiWorktreeConversationResponse {
  return {
    worktree: buildAgentsUiWorktreeSummary(worktree, conversationMeta),
    conversation: buildConversationState(thread, additionalMessages),
  };
}

export class WorktreeConversationService {
  private readonly now: () => Date;
  private readonly readSessionMessages;
  private readonly readMeta;
  private readonly writeMeta;

  constructor(private readonly deps: WorktreeConversationServiceDependencies) {
    this.now = deps.now ?? (() => new Date());
    this.readSessionMessages = deps.readSessionMessages ?? readCodexSessionMessages;
    this.readMeta = deps.readMeta ?? readWorktreeMeta;
    this.writeMeta = deps.writeMeta ?? writeWorktreeMeta;
  }

  async attachWorktreeConversation(
    worktree: WorktreeSnapshot,
  ): Promise<WorktreeConversationResult<AgentsUiWorktreeConversationResponse>> {
    return await this.withResolvedConversation(worktree, true, async ({ conversationMeta, thread }) => {
      const sessionMessages = await this.readSessionMessages(thread);
      return ok(toWorktreeConversationResponse(worktree, conversationMeta, thread, sessionMessages));
    });
  }

  async readWorktreeConversation(
    worktree: WorktreeSnapshot,
  ): Promise<WorktreeConversationResult<AgentsUiWorktreeConversationResponse>> {
    return await this.withResolvedConversation(worktree, false, async ({ conversationMeta, thread }) => {
      const sessionMessages = await this.readSessionMessages(thread);
      return ok(toWorktreeConversationResponse(worktree, conversationMeta, thread, sessionMessages));
    });
  }

  async sendWorktreeConversationMessage(
    worktree: WorktreeSnapshot,
    text: string,
  ): Promise<WorktreeConversationResult<AgentsUiSendMessageResponse>> {
    return await this.withResolvedConversation(worktree, true, async ({ thread, launchContext }) => {
      const started = await this.deps.appServer.turnStart({
        threadId: thread.id,
        cwd: worktree.path,
        approvalPolicy: launchContext.approvalPolicy,
        input: [{ type: "text", text }],
      });
      return ok({
        conversationId: thread.id,
        turnId: started.turn.id,
        running: true,
      });
    });
  }

  async interruptWorktreeConversation(
    worktree: WorktreeSnapshot,
  ): Promise<WorktreeConversationResult<AgentsUiInterruptResponse>> {
    return await this.withResolvedConversation(worktree, false, async ({ thread }) => {
      const conversation = buildConversationState(thread);
      const turnId = conversation.activeTurnId;
      if (!turnId) {
        return err(409, "No active Codex turn to interrupt");
      }

      await this.deps.appServer.turnInterrupt({
        threadId: thread.id,
        turnId,
      });
      return ok({
        conversationId: thread.id,
        turnId,
        interrupted: true,
      });
    });
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

    const launchContextResult = await this.deps.resolveLaunchContext({ worktree, meta });
    if (!launchContextResult.ok) return launchContextResult;
    const launchContext = launchContextResult.data;

    const now = this.now();
    const thread = await this.resolveThread(meta, worktree.path, allowCreate, launchContext);
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
      launchContext,
    });
  }

  private async resolveThread(
    meta: WorktreeMeta,
    cwd: string,
    allowCreate: boolean,
    launchContext: CodexAppServerLaunchContext,
  ): Promise<CodexAppServerThread | null> {
    const savedThreadId = isCodexConversationMeta(meta.conversation)
      ? meta.conversation.threadId
      : null;
    if (savedThreadId) {
      const savedThread = await this.tryLoadThread(savedThreadId, cwd, launchContext);
      if (savedThread) return savedThread;
      log.warn(`[agents] saved codex thread missing, starting fresh conversation cwd=${cwd} threadId=${savedThreadId}`);
    } else {
      const discoveredThread = selectDiscoveredThread((await this.deps.appServer.threadList({
        cwd,
        limit: 20,
        sortKey: "updated_at",
      })).data);
      if (discoveredThread) {
        return await this.ensureThreadLoaded(discoveredThread.id, cwd, launchContext);
      }
    }

    if (!allowCreate) return null;

    const started = await this.deps.appServer.threadStart({
      cwd,
      approvalPolicy: launchContext.approvalPolicy,
      personality: launchContext.personality,
      sandbox: launchContext.sandbox,
    });
    return started.thread;
  }

  private async tryLoadThread(
    threadId: string,
    cwd: string,
    launchContext: CodexAppServerLaunchContext,
  ): Promise<CodexAppServerThread | null> {
    try {
      return await this.ensureThreadLoaded(threadId, cwd, launchContext);
    } catch {
      return null;
    }
  }

  private async ensureThreadLoaded(
    threadId: string,
    cwd: string,
    launchContext: CodexAppServerLaunchContext,
  ): Promise<CodexAppServerThread> {
    const initial = await this.deps.appServer.threadRead(threadId, false);
    if (initial.thread.status.type === "notLoaded") {
      await this.deps.appServer.threadResume({
        threadId,
        cwd,
        approvalPolicy: launchContext.approvalPolicy,
        personality: launchContext.personality,
        sandbox: launchContext.sandbox,
      });
    }

    return (await this.deps.appServer.threadRead(threadId, true)).thread;
  }
}
