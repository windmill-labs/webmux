import { readWorktreeMeta, writeWorktreeMeta } from "../adapters/fs";
import type {
  CodexAppServerAgentMessageItem,
  CodexAppServerApprovalPolicy,
  CodexAppServerCommandExecutionItem,
  CodexAppServerDynamicToolCallStatus,
  CodexAppServerDynamicToolCallContentItem,
  CodexAppServerDynamicToolCallItem,
  CodexAppServerFileChangeItem,
  CodexAppServerFileUpdateChange,
  CodexAppServerMcpToolCallItem,
  CodexAppServerMcpToolCallStatus,
  CodexAppServerPatchApplyStatus,
  CodexAppServerPersonality,
  CodexAppServerSandboxMode,
  CodexAppServerThread,
  CodexAppServerThreadItem,
  CodexAppServerThreadListResponse,
  CodexAppServerTurn,
  CodexAppServerUserMessageItem,
  CodexAppServerWebSearchItem,
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
import { isRecord } from "../lib/type-guards";
import { buildAgentsUiWorktreeSummary } from "./agents-ui-service";
import { readCodexSessionMessages } from "./codex-session-log-service";
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
  now?: () => Date;
  readSessionMessages?: (thread: CodexAppServerThread) => Promise<AgentsUiConversationMessage[]>;
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

function isFileChangeItem(item: CodexAppServerThreadItem): item is CodexAppServerFileChangeItem {
  return item.type === "fileChange";
}

function isMcpToolCallItem(item: CodexAppServerThreadItem): item is CodexAppServerMcpToolCallItem {
  return item.type === "mcpToolCall";
}

function isDynamicToolCallItem(item: CodexAppServerThreadItem): item is CodexAppServerDynamicToolCallItem {
  return item.type === "dynamicToolCall";
}

function isWebSearchItem(item: CodexAppServerThreadItem): item is CodexAppServerWebSearchItem {
  return item.type === "webSearch";
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
  switch (item.status) {
    case "inProgress":
      return "inProgress";
    case "completed":
      return item.exitCode !== null && item.exitCode !== 0 ? "failed" : "completed";
    case "failed":
    case "declined":
      return "failed";
  }
}

function commandExecutionDisplayText(item: CodexAppServerCommandExecutionItem): string {
  const commands = item.commandActions
    .map((action) => action.command ?? "")
    .filter((command) => command.length > 0);
  return commands.length > 0 ? commands.join(" && ") : item.command;
}

function toolStatus(
  status: CodexAppServerPatchApplyStatus | CodexAppServerMcpToolCallStatus | CodexAppServerDynamicToolCallStatus,
): AgentsUiConversationMessage["status"] {
  switch (status) {
    case "inProgress":
      return "inProgress";
    case "completed":
      return "completed";
    case "failed":
    case "declined":
      return "failed";
  }
}

function jsonDisplayText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? "";
}

function patchChangeLabel(change: CodexAppServerFileUpdateChange): string {
  switch (change.kind.type) {
    case "add":
      return `add ${change.path}`;
    case "delete":
      return `delete ${change.path}`;
    case "update":
      return change.kind.move_path ? `move ${change.kind.move_path} -> ${change.path}` : `update ${change.path}`;
  }
}

function fileChangeDisplayText(item: CodexAppServerFileChangeItem): string {
  return item.changes.map(patchChangeLabel).join("\n");
}

function fileChangeResultText(item: CodexAppServerFileChangeItem): string {
  return item.changes
    .map((change) => change.diff.trimEnd())
    .filter((diff) => diff.length > 0)
    .join("\n\n");
}

function mcpContentText(content: unknown): string {
  if (isRecord(content) && typeof content.text === "string") return content.text;
  return jsonDisplayText(content);
}

function mcpToolResultText(item: CodexAppServerMcpToolCallItem): string {
  if (item.error) return item.error.message;
  if (!item.result) return "";

  const parts = item.result.content.map(mcpContentText);
  if (item.result.structuredContent !== null) {
    parts.push(jsonDisplayText(item.result.structuredContent));
  }
  return parts.join("\n\n").trim();
}

function dynamicToolName(item: CodexAppServerDynamicToolCallItem): string {
  return item.namespace ? `${item.namespace}.${item.tool}` : item.tool;
}

function dynamicToolContentText(content: CodexAppServerDynamicToolCallContentItem): string {
  switch (content.type) {
    case "inputText":
      return content.text;
    case "inputImage":
      return content.imageUrl;
  }
}

function dynamicToolResultText(item: CodexAppServerDynamicToolCallItem): string {
  return (item.contentItems ?? []).map(dynamicToolContentText).join("\n\n").trim();
}

function webSearchDisplayText(item: CodexAppServerWebSearchItem): string {
  const action = item.action;
  if (!action) return item.query;

  switch (action.type) {
    case "search":
      return action.queries?.join("\n") ?? action.query ?? item.query;
    case "openPage":
      return action.url ?? item.query;
    case "findInPage":
      return [action.url, action.pattern].filter((part) => part !== null).join("\n");
    case "other":
      return item.query;
  }
}

function isActiveTurnStatus(status: CodexAppServerTurn["status"]): boolean {
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

function buildCommandExecutionMessages(input: {
  item: CodexAppServerCommandExecutionItem;
  turnId: string;
  createdAt: string | null;
  order: number;
}): AgentsUiConversationMessage[] {
  const { item, turnId, createdAt, order } = input;
  const status = commandExecutionStatus(item);
  const toolUse: AgentsUiConversationMessage = {
    id: item.id,
    turnId,
    order,
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
      order: order + 1,
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

function buildFileChangeMessages(input: {
  item: CodexAppServerFileChangeItem;
  turnId: string;
  createdAt: string | null;
  order: number;
}): AgentsUiConversationMessage[] {
  const { item, turnId, createdAt, order } = input;
  const status = toolStatus(item.status);
  const toolUse: AgentsUiConversationMessage = {
    id: item.id,
    turnId,
    order,
    role: "assistant",
    kind: "toolUse",
    toolName: "file change",
    toolCallId: item.id,
    text: fileChangeDisplayText(item),
    status,
    createdAt,
  };
  const resultText = fileChangeResultText(item);
  if (resultText.length === 0) return [toolUse];

  return [
    toolUse,
    {
      id: `${item.id}:result`,
      turnId,
      order: order + 1,
      role: "user",
      kind: "toolResult",
      toolName: "file change",
      toolCallId: item.id,
      text: resultText,
      status,
      createdAt,
    },
  ];
}

function buildMcpToolCallMessages(input: {
  item: CodexAppServerMcpToolCallItem;
  turnId: string;
  createdAt: string | null;
  order: number;
}): AgentsUiConversationMessage[] {
  const { item, turnId, createdAt, order } = input;
  const status = item.error ? "failed" : toolStatus(item.status);
  const toolName = `${item.server}.${item.tool}`;
  const toolUse: AgentsUiConversationMessage = {
    id: item.id,
    turnId,
    order,
    role: "assistant",
    kind: "toolUse",
    toolName,
    toolCallId: item.id,
    text: jsonDisplayText(item.arguments),
    status,
    createdAt,
    durationMs: item.durationMs,
  };
  const resultText = mcpToolResultText(item);
  if (resultText.length === 0) return [toolUse];

  return [
    toolUse,
    {
      id: `${item.id}:result`,
      turnId,
      order: order + 1,
      role: "user",
      kind: "toolResult",
      toolName,
      toolCallId: item.id,
      text: resultText,
      status,
      createdAt,
      durationMs: item.durationMs,
    },
  ];
}

function buildDynamicToolCallMessages(input: {
  item: CodexAppServerDynamicToolCallItem;
  turnId: string;
  createdAt: string | null;
  order: number;
}): AgentsUiConversationMessage[] {
  const { item, turnId, createdAt, order } = input;
  const status = item.success === false ? "failed" : toolStatus(item.status);
  const toolName = dynamicToolName(item);
  const toolUse: AgentsUiConversationMessage = {
    id: item.id,
    turnId,
    order,
    role: "assistant",
    kind: "toolUse",
    toolName,
    toolCallId: item.id,
    text: jsonDisplayText(item.arguments),
    status,
    createdAt,
    durationMs: item.durationMs,
  };
  const resultText = dynamicToolResultText(item);
  if (resultText.length === 0) return [toolUse];

  return [
    toolUse,
    {
      id: `${item.id}:result`,
      turnId,
      order: order + 1,
      role: "user",
      kind: "toolResult",
      toolName,
      toolCallId: item.id,
      text: resultText,
      status,
      createdAt,
      durationMs: item.durationMs,
    },
  ];
}

function buildWebSearchMessages(input: {
  item: CodexAppServerWebSearchItem;
  turnId: string;
  createdAt: string | null;
  order: number;
}): AgentsUiConversationMessage[] {
  const { item, turnId, createdAt, order } = input;
  return [{
    id: item.id,
    turnId,
    order,
    role: "assistant",
    kind: "toolUse",
    toolName: "web search",
    toolCallId: item.id,
    text: webSearchDisplayText(item),
    status: "completed",
    createdAt,
  }];
}

export function buildCodexItemConversationMessages(input: {
  item: CodexAppServerThreadItem;
  turnId: string;
  turnStatus: CodexAppServerTurn["status"];
  createdAt: string | null;
  order: number;
  includeEmptyText?: boolean;
}): AgentsUiConversationMessage[] {
  const { item, turnId, turnStatus, createdAt, order, includeEmptyText = false } = input;
  if (isUserMessageItem(item)) {
    const text = extractUserText(item);
    if (text.length === 0 && !includeEmptyText) return [];
    return [{
      id: item.id,
      turnId,
      order,
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
    const phase = item.phase ?? undefined;
    const isThinking = phase === "analysis";
    return [{
      id: item.id,
      turnId,
      order,
      role: "assistant",
      kind: isThinking ? "thinking" : "text",
      phase,
      text,
      status: isActiveTurnStatus(turnStatus) ? "inProgress" : "completed",
      createdAt,
    }];
  }

  if (isCommandExecutionItem(item)) return buildCommandExecutionMessages({ item, turnId, createdAt, order });
  if (isFileChangeItem(item)) return buildFileChangeMessages({ item, turnId, createdAt, order });
  if (isMcpToolCallItem(item)) return buildMcpToolCallMessages({ item, turnId, createdAt, order });
  if (isDynamicToolCallItem(item)) return buildDynamicToolCallMessages({ item, turnId, createdAt, order });
  if (isWebSearchItem(item)) return buildWebSearchMessages({ item, turnId, createdAt, order });

  return [];
}

function buildConversationMessages(thread: CodexAppServerThread): AgentsUiConversationMessage[] {
  const messages: AgentsUiConversationMessage[] = [];
  let order = 0;

  for (const turn of thread.turns) {
    for (const item of turn.items) {
      const itemMessages = buildCodexItemConversationMessages({
        item,
        turnId: turn.id,
        turnStatus: turn.status,
        createdAt: toIsoTimestamp(isUserMessageItem(item) ? turn.startedAt : turn.completedAt ?? turn.startedAt),
        order,
      });
      messages.push(...itemMessages);
      order += itemMessages.length;
    }
  }

  return messages;
}

export function buildConversationState(
  thread: CodexAppServerThread,
  sessionMessages: AgentsUiConversationMessage[] = [],
): AgentsUiConversationState {
  const activeTurn = findActiveTurn(thread);
  const messages = sessionMessages.length > 0 ? sessionMessages : buildConversationMessages(thread);
  return {
    provider: "codexAppServer",
    conversationId: thread.id,
    cwd: thread.cwd,
    running: thread.status.type === "active" || activeTurn !== null,
    activeTurnId: activeTurn?.id ?? null,
    messages,
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
  sessionMessages: AgentsUiConversationMessage[],
): AgentsUiWorktreeConversationResponse {
  return {
    worktree: buildAgentsUiWorktreeSummary(worktree, conversationMeta),
    conversation: buildConversationState(thread, sessionMessages),
  };
}

export class WorktreeConversationService {
  private readonly now: () => Date;
  private readonly readSessionMessages: (thread: CodexAppServerThread) => Promise<AgentsUiConversationMessage[]>;
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
        streaming: true,
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
        streaming: true,
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
