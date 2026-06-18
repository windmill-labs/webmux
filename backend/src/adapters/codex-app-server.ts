import { z } from "zod";
import { log } from "../lib/log";
import { isRecord } from "../lib/type-guards";

export type CodexAppServerApprovalPolicy = "untrusted" | "on-failure" | "on-request" | "never";
export type CodexAppServerPersonality = "none" | "friendly" | "pragmatic";
export type CodexAppServerSandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export type CodexAppServerThreadSortKey = "created_at" | "updated_at";

export interface CodexAppServerThreadStatus {
  type: string;
  activeFlags?: string[];
}

export interface CodexAppServerContentItem {
  type: string;
  text?: string;
}

export interface CodexAppServerUserMessageItem {
  type: "userMessage";
  id: string;
  content: CodexAppServerContentItem[];
}

export interface CodexAppServerAgentMessageItem {
  type: "agentMessage";
  id: string;
  text?: string;
  message?: string;
  phase?: string | null;
  memoryCitation?: unknown;
}

export interface CodexAppServerCommandAction {
  type: string;
  command?: string;
  path?: string | null;
}

export type CodexAppServerCommandExecutionStatus = "inProgress" | "completed" | "failed" | "declined";

export interface CodexAppServerCommandExecutionItem {
  type: "commandExecution";
  id: string;
  command: string;
  cwd: string | null;
  status: CodexAppServerCommandExecutionStatus;
  commandActions: CodexAppServerCommandAction[];
  aggregatedOutput: string | null;
  exitCode: number | null;
  durationMs: number | null;
}

export type CodexAppServerPatchChangeKind =
  | { type: "add" }
  | { type: "delete" }
  | { type: "update"; move_path: string | null };

export type CodexAppServerPatchApplyStatus = "inProgress" | "completed" | "failed" | "declined";

export interface CodexAppServerFileUpdateChange {
  path: string;
  kind: CodexAppServerPatchChangeKind;
  diff: string;
}

export interface CodexAppServerFileChangeItem {
  type: "fileChange";
  id: string;
  changes: CodexAppServerFileUpdateChange[];
  status: CodexAppServerPatchApplyStatus;
}

export type CodexAppServerMcpToolCallStatus = "inProgress" | "completed" | "failed";

export interface CodexAppServerMcpToolCallResult {
  content: unknown[];
  structuredContent: unknown;
  _meta: unknown;
}

export interface CodexAppServerMcpToolCallError {
  message: string;
}

export interface CodexAppServerMcpToolCallItem {
  type: "mcpToolCall";
  id: string;
  server: string;
  tool: string;
  status: CodexAppServerMcpToolCallStatus;
  arguments: unknown;
  mcpAppResourceUri?: string;
  pluginId: string | null;
  result: CodexAppServerMcpToolCallResult | null;
  error: CodexAppServerMcpToolCallError | null;
  durationMs: number | null;
}

export type CodexAppServerDynamicToolCallStatus = "inProgress" | "completed" | "failed";

export type CodexAppServerDynamicToolCallContentItem =
  | { type: "inputText"; text: string }
  | { type: "inputImage"; imageUrl: string };

export interface CodexAppServerDynamicToolCallItem {
  type: "dynamicToolCall";
  id: string;
  namespace: string | null;
  tool: string;
  arguments: unknown;
  status: CodexAppServerDynamicToolCallStatus;
  contentItems: CodexAppServerDynamicToolCallContentItem[] | null;
  success: boolean | null;
  durationMs: number | null;
}

export type CodexAppServerWebSearchAction =
  | { type: "search"; query: string | null; queries: string[] | null }
  | { type: "openPage"; url: string | null }
  | { type: "findInPage"; url: string | null; pattern: string | null }
  | { type: "other" };

export interface CodexAppServerWebSearchItem {
  type: "webSearch";
  id: string;
  query: string;
  action: CodexAppServerWebSearchAction | null;
}

export type CodexAppServerIgnoredItemType =
  | "hookPrompt"
  | "plan"
  | "reasoning"
  | "collabAgentToolCall"
  | "imageView"
  | "imageGeneration"
  | "enteredReviewMode"
  | "exitedReviewMode"
  | "contextCompaction";

export interface CodexAppServerIgnoredItem {
  type: CodexAppServerIgnoredItemType;
  id: string;
}

export interface CodexAppServerGenericItem {
  type: string;
  id: string;
}

export type CodexAppServerTurnStatus = string;

export type CodexAppServerThreadItem =
  | CodexAppServerUserMessageItem
  | CodexAppServerAgentMessageItem
  | CodexAppServerCommandExecutionItem
  | CodexAppServerFileChangeItem
  | CodexAppServerMcpToolCallItem
  | CodexAppServerDynamicToolCallItem
  | CodexAppServerWebSearchItem
  | CodexAppServerIgnoredItem
  | CodexAppServerGenericItem;

export interface CodexAppServerTurn {
  id: string;
  items: CodexAppServerThreadItem[];
  status: CodexAppServerTurnStatus;
  error: unknown;
  startedAt: number | null;
  completedAt: number | null;
  durationMs: number | null;
}

export interface CodexAppServerThread {
  id: string;
  forkedFromId: string | null;
  preview: string;
  ephemeral: boolean;
  modelProvider: string;
  createdAt: number;
  updatedAt: number;
  status: CodexAppServerThreadStatus;
  path: string | null;
  cwd: string;
  cliVersion: string;
  source: string;
  agentNickname: string | null;
  agentRole: string | null;
  gitInfo: unknown;
  name: string | null;
  turns: CodexAppServerTurn[];
}

export interface CodexAppServerThreadListParams {
  archived?: boolean | null;
  cursor?: string | null;
  cwd?: string | null;
  limit?: number | null;
  searchTerm?: string | null;
  sortKey?: CodexAppServerThreadSortKey | null;
  sourceKinds?: string[] | null;
}

export interface CodexAppServerThreadListResponse {
  data: CodexAppServerThread[];
  nextCursor: string | null;
}

export interface CodexAppServerThreadReadResponse {
  thread: CodexAppServerThread;
}

export interface CodexAppServerThreadContext {
  thread: CodexAppServerThread;
  model: string;
  modelProvider: string;
  serviceTier: string | null;
  cwd: string;
  approvalPolicy: CodexAppServerApprovalPolicy;
  approvalsReviewer: string;
  sandbox: {
    type: string;
  };
  reasoningEffort: string | null;
}

export interface CodexAppServerThreadStartParams {
  approvalPolicy?: CodexAppServerApprovalPolicy;
  cwd: string;
  ephemeral?: boolean | null;
  model?: string | null;
  modelProvider?: string | null;
  personality?: CodexAppServerPersonality | null;
  sandbox?: CodexAppServerSandboxMode | null;
}

export interface CodexAppServerThreadResumeParams {
  approvalPolicy?: CodexAppServerApprovalPolicy;
  cwd?: string | null;
  personality?: CodexAppServerPersonality | null;
  sandbox?: CodexAppServerSandboxMode | null;
  threadId: string;
}

export interface CodexAppServerUserInput {
  type: "text";
  text: string;
}

export interface CodexAppServerTurnStartParams {
  approvalPolicy?: CodexAppServerApprovalPolicy;
  cwd?: string | null;
  input: CodexAppServerUserInput[];
  threadId: string;
}

export interface CodexAppServerTurnStartResponse {
  turn: CodexAppServerTurn;
}

export interface CodexAppServerTurnInterruptParams {
  threadId: string;
  turnId: string;
}

export interface CodexAppServerNotification {
  method: string;
  params?: unknown;
}

export interface CodexAppServerGateway {
  threadList(params: CodexAppServerThreadListParams): Promise<CodexAppServerThreadListResponse>;
  threadRead(threadId: string, includeTurns: boolean): Promise<CodexAppServerThreadReadResponse>;
  threadResume(params: CodexAppServerThreadResumeParams): Promise<CodexAppServerThreadContext>;
  threadStart(params: CodexAppServerThreadStartParams): Promise<CodexAppServerThreadContext>;
  turnStart(params: CodexAppServerTurnStartParams): Promise<CodexAppServerTurnStartResponse>;
  turnInterrupt(params: CodexAppServerTurnInterruptParams): Promise<void>;
}

interface CodexAppServerJsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

interface PendingRequest {
  reject: (reason?: unknown) => void;
  resolve: (value: unknown) => void;
}

type PipedCodexAppServerProcess = Bun.Subprocess<"pipe", "pipe", "pipe">;

const CodexAppServerApprovalPolicySchema = z.enum(["untrusted", "on-failure", "on-request", "never"]);
const UnknownValueSchema = z.custom<unknown>(() => true);
const JsonValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(UnknownValueSchema),
  z.record(UnknownValueSchema),
]);
const CodexAppServerContentItemSchema: z.ZodType<CodexAppServerContentItem, z.ZodTypeDef, unknown> = z.object({
  type: z.string(),
  text: z.string().optional(),
});
const CodexAppServerUserMessageItemSchema: z.ZodType<CodexAppServerUserMessageItem, z.ZodTypeDef, unknown> = z.object({
  type: z.literal("userMessage"),
  id: z.string(),
  content: z.array(CodexAppServerContentItemSchema),
});
const CodexAppServerAgentMessageItemSchema: z.ZodType<CodexAppServerAgentMessageItem, z.ZodTypeDef, unknown> = z.object({
  type: z.literal("agentMessage"),
  id: z.string(),
  text: z.string().optional(),
  message: z.string().optional(),
  phase: z.string().nullable().optional(),
  memoryCitation: UnknownValueSchema.optional(),
});
const CodexAppServerCommandActionSchema: z.ZodType<CodexAppServerCommandAction, z.ZodTypeDef, unknown> = z.object({
  type: z.string(),
  command: z.string().optional(),
  path: z.string().nullable().optional(),
});
const CodexAppServerCommandExecutionItemSchema: z.ZodType<CodexAppServerCommandExecutionItem, z.ZodTypeDef, unknown> = z.object({
  type: z.literal("commandExecution"),
  id: z.string(),
  command: z.string(),
  cwd: z.string().nullable(),
  status: z.enum(["inProgress", "completed", "failed", "declined"]),
  commandActions: z.array(CodexAppServerCommandActionSchema).default([]),
  aggregatedOutput: z.string().nullable(),
  exitCode: z.number().nullable(),
  durationMs: z.number().nullable(),
});
const CodexAppServerPatchChangeKindSchema: z.ZodType<CodexAppServerPatchChangeKind, z.ZodTypeDef, unknown> = z.union([
  z.object({ type: z.literal("add") }),
  z.object({ type: z.literal("delete") }),
  z.object({ type: z.literal("update"), move_path: z.string().nullable() }),
]);
const CodexAppServerFileUpdateChangeSchema: z.ZodType<CodexAppServerFileUpdateChange, z.ZodTypeDef, unknown> = z.object({
  path: z.string(),
  kind: CodexAppServerPatchChangeKindSchema,
  diff: z.string(),
});
const CodexAppServerFileChangeItemSchema: z.ZodType<CodexAppServerFileChangeItem, z.ZodTypeDef, unknown> = z.object({
  type: z.literal("fileChange"),
  id: z.string(),
  changes: z.array(CodexAppServerFileUpdateChangeSchema),
  status: z.enum(["inProgress", "completed", "failed", "declined"]),
});
const CodexAppServerMcpToolCallResultSchema: z.ZodType<CodexAppServerMcpToolCallResult, z.ZodTypeDef, unknown> = z.object({
  content: z.array(JsonValueSchema),
  structuredContent: JsonValueSchema,
  _meta: JsonValueSchema,
});
const CodexAppServerMcpToolCallErrorSchema: z.ZodType<CodexAppServerMcpToolCallError, z.ZodTypeDef, unknown> = z.object({
  message: z.string(),
});
const CodexAppServerMcpToolCallItemSchema: z.ZodType<CodexAppServerMcpToolCallItem, z.ZodTypeDef, unknown> = z.object({
  type: z.literal("mcpToolCall"),
  id: z.string(),
  server: z.string(),
  tool: z.string(),
  status: z.enum(["inProgress", "completed", "failed"]),
  arguments: JsonValueSchema,
  mcpAppResourceUri: z.string().optional(),
  pluginId: z.string().nullable(),
  result: CodexAppServerMcpToolCallResultSchema.nullable(),
  error: CodexAppServerMcpToolCallErrorSchema.nullable(),
  durationMs: z.number().nullable(),
});
const CodexAppServerDynamicToolCallContentItemSchema: z.ZodType<CodexAppServerDynamicToolCallContentItem, z.ZodTypeDef, unknown> = z.union([
  z.object({ type: z.literal("inputText"), text: z.string() }),
  z.object({ type: z.literal("inputImage"), imageUrl: z.string() }),
]);
const CodexAppServerDynamicToolCallItemSchema: z.ZodType<CodexAppServerDynamicToolCallItem, z.ZodTypeDef, unknown> = z.object({
  type: z.literal("dynamicToolCall"),
  id: z.string(),
  namespace: z.string().nullable(),
  tool: z.string(),
  arguments: JsonValueSchema,
  status: z.enum(["inProgress", "completed", "failed"]),
  contentItems: z.array(CodexAppServerDynamicToolCallContentItemSchema).nullable(),
  success: z.boolean().nullable(),
  durationMs: z.number().nullable(),
});
const CodexAppServerWebSearchActionSchema: z.ZodType<CodexAppServerWebSearchAction, z.ZodTypeDef, unknown> = z.union([
  z.object({ type: z.literal("search"), query: z.string().nullable(), queries: z.array(z.string()).nullable() }),
  z.object({ type: z.literal("openPage"), url: z.string().nullable() }),
  z.object({ type: z.literal("findInPage"), url: z.string().nullable(), pattern: z.string().nullable() }),
  z.object({ type: z.literal("other") }),
]);
const CodexAppServerWebSearchItemSchema: z.ZodType<CodexAppServerWebSearchItem, z.ZodTypeDef, unknown> = z.object({
  type: z.literal("webSearch"),
  id: z.string(),
  query: z.string(),
  action: CodexAppServerWebSearchActionSchema.nullable(),
});
const CodexAppServerIgnoredItemSchema: z.ZodType<CodexAppServerIgnoredItem, z.ZodTypeDef, unknown> = z.object({
  type: z.enum([
    "hookPrompt",
    "plan",
    "reasoning",
    "collabAgentToolCall",
    "imageView",
    "imageGeneration",
    "enteredReviewMode",
    "exitedReviewMode",
    "contextCompaction",
  ]),
  id: z.string(),
});
const CodexAppServerGenericItemSchema: z.ZodType<CodexAppServerGenericItem, z.ZodTypeDef, unknown> = z.object({
  type: z.string(),
  id: z.string(),
});
const CodexAppServerThreadItemSchema: z.ZodType<CodexAppServerThreadItem, z.ZodTypeDef, unknown> = z.union([
  CodexAppServerUserMessageItemSchema,
  CodexAppServerAgentMessageItemSchema,
  CodexAppServerCommandExecutionItemSchema,
  CodexAppServerFileChangeItemSchema,
  CodexAppServerMcpToolCallItemSchema,
  CodexAppServerDynamicToolCallItemSchema,
  CodexAppServerWebSearchItemSchema,
  CodexAppServerIgnoredItemSchema,
  CodexAppServerGenericItemSchema,
]);
const CodexAppServerTurnSchema: z.ZodType<CodexAppServerTurn, z.ZodTypeDef, unknown> = z.object({
  id: z.string(),
  items: z.array(CodexAppServerThreadItemSchema),
  status: z.string(),
  error: UnknownValueSchema,
  startedAt: z.number().nullable(),
  completedAt: z.number().nullable(),
  durationMs: z.number().nullable(),
}).transform((value) => ({
  id: value.id,
  items: value.items,
  status: value.status,
  error: value.error,
  startedAt: value.startedAt,
  completedAt: value.completedAt,
  durationMs: value.durationMs,
}));
const CodexAppServerThreadStatusSchema: z.ZodType<CodexAppServerThreadStatus, z.ZodTypeDef, unknown> = z.object({
  type: z.string(),
  activeFlags: z.array(z.string()).optional(),
});
const CodexAppServerThreadSchema: z.ZodType<CodexAppServerThread, z.ZodTypeDef, unknown> = z.object({
  id: z.string(),
  forkedFromId: z.string().nullable(),
  preview: z.string(),
  ephemeral: z.boolean(),
  modelProvider: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  status: CodexAppServerThreadStatusSchema,
  path: z.string().nullable(),
  cwd: z.string(),
  cliVersion: z.string(),
  source: z.string(),
  agentNickname: z.string().nullable(),
  agentRole: z.string().nullable(),
  gitInfo: UnknownValueSchema,
  name: z.string().nullable(),
  turns: z.array(CodexAppServerTurnSchema),
}).transform((value) => ({
  id: value.id,
  forkedFromId: value.forkedFromId,
  preview: value.preview,
  ephemeral: value.ephemeral,
  modelProvider: value.modelProvider,
  createdAt: value.createdAt,
  updatedAt: value.updatedAt,
  status: value.status,
  path: value.path,
  cwd: value.cwd,
  cliVersion: value.cliVersion,
  source: value.source,
  agentNickname: value.agentNickname,
  agentRole: value.agentRole,
  gitInfo: value.gitInfo,
  name: value.name,
  turns: value.turns,
}));
const CodexAppServerThreadListResponseSchema: z.ZodType<CodexAppServerThreadListResponse, z.ZodTypeDef, unknown> = z.object({
  data: z.array(CodexAppServerThreadSchema),
  nextCursor: z.string().nullable(),
});
const CodexAppServerThreadReadResponseSchema: z.ZodType<CodexAppServerThreadReadResponse, z.ZodTypeDef, unknown> = z.object({
  thread: CodexAppServerThreadSchema,
});
const CodexAppServerThreadContextSchema: z.ZodType<CodexAppServerThreadContext, z.ZodTypeDef, unknown> = z.object({
  thread: CodexAppServerThreadSchema,
  model: z.string(),
  modelProvider: z.string(),
  serviceTier: z.string().nullable(),
  cwd: z.string(),
  approvalPolicy: CodexAppServerApprovalPolicySchema,
  approvalsReviewer: z.string(),
  sandbox: z.object({
    type: z.string(),
  }),
  reasoningEffort: z.string().nullable(),
});
const CodexAppServerTurnStartResponseSchema: z.ZodType<CodexAppServerTurnStartResponse, z.ZodTypeDef, unknown> = z.object({
  turn: CodexAppServerTurnSchema,
});
const CodexAppServerInitializeResponseSchema = z.object({
  userAgent: z.string(),
  codexHome: z.string(),
  platformFamily: z.string(),
  platformOs: z.string(),
});

export function readCodexAppServerStdoutLines(input: {
  decoder: TextDecoder;
  buffer: string;
  chunk?: Uint8Array;
}): {
  buffer: string;
  lines: string[];
} {
  let buffer = input.buffer + (
    input.chunk ? input.decoder.decode(input.chunk, { stream: true }) : input.decoder.decode()
  );
  const lines: string[] = [];

  while (true) {
    const newlineIndex = buffer.indexOf("\n");
    if (newlineIndex === -1) break;
    const line = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);
    if (line.length > 0) lines.push(line);
  }

  if (!input.chunk) {
    const finalLine = buffer.trim();
    buffer = "";
    if (finalLine.length > 0) lines.push(finalLine);
  }

  return { buffer, lines };
}

export function parseCodexAppServerThreadItem(raw: unknown): CodexAppServerThreadItem | null {
  const parsed = CodexAppServerThreadItemSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function parseCodexAppServerThreadReadResponse(raw: unknown): CodexAppServerThreadReadResponse | null {
  const parsed = CodexAppServerThreadReadResponseSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export class CodexAppServerRequestError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly data?: unknown,
  ) {
    super(message);
  }
}

export class CodexAppServerClient implements CodexAppServerGateway {
  private readonly encoder = new TextEncoder();
  private readonly listeners = new Set<(notification: CodexAppServerNotification) => void>();
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private proc: PipedCodexAppServerProcess | null = null;
  private readyPromise: Promise<void> | null = null;

  constructor(
    private readonly opts: {
      clientName: string;
      clientVersion: string;
    } = {
      clientName: "webmux-agents",
      clientVersion: "0.0.0",
    },
  ) {}

  onNotification(listener: (notification: CodexAppServerNotification) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async threadList(params: CodexAppServerThreadListParams): Promise<CodexAppServerThreadListResponse> {
    return await this.request("thread/list", CodexAppServerThreadListResponseSchema, params);
  }

  async threadRead(threadId: string, includeTurns: boolean): Promise<CodexAppServerThreadReadResponse> {
    return await this.request("thread/read", CodexAppServerThreadReadResponseSchema, { threadId, includeTurns });
  }

  async threadResume(params: CodexAppServerThreadResumeParams): Promise<CodexAppServerThreadContext> {
    return await this.request("thread/resume", CodexAppServerThreadContextSchema, params);
  }

  async threadStart(params: CodexAppServerThreadStartParams): Promise<CodexAppServerThreadContext> {
    return await this.request("thread/start", CodexAppServerThreadContextSchema, params);
  }

  async turnStart(params: CodexAppServerTurnStartParams): Promise<CodexAppServerTurnStartResponse> {
    return await this.request("turn/start", CodexAppServerTurnStartResponseSchema, params);
  }

  async turnInterrupt(params: CodexAppServerTurnInterruptParams): Promise<void> {
    await this.request("turn/interrupt", z.unknown(), params);
  }

  private async request<T>(method: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, params?: unknown): Promise<T> {
    await this.ensureReady();
    return await this.requestInternal(method, schema, params);
  }

  private async ensureReady(): Promise<void> {
    if (this.readyPromise) {
      return await this.readyPromise;
    }

    this.readyPromise = (async () => {
      this.startProcess();
      await this.requestInternal("initialize", CodexAppServerInitializeResponseSchema, {
        clientInfo: {
          name: this.opts.clientName,
          version: this.opts.clientVersion,
        },
        capabilities: {
          experimentalApi: true,
        },
      });
      this.send({
        method: "initialized",
        params: {},
      });
    })().catch((error) => {
      this.resetProcess();
      throw error;
    });

    return await this.readyPromise;
  }

  private startProcess(): void {
    if (this.proc) return;

    const proc: PipedCodexAppServerProcess = Bun.spawn(["codex", "app-server"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: Bun.env,
    });

    this.proc = proc;
    this.startStdoutLoop(proc);
    this.startStderrLoop(proc);
    proc.exited.then((exitCode) => {
      const message = `codex app-server exited with code ${exitCode}`;
      log.warn(`[agents] ${message}`);
      this.rejectPending(new Error(message));
      this.resetProcess();
    });
  }

  private startStdoutLoop(proc: PipedCodexAppServerProcess): void {
    (async () => {
      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const decoded = readCodexAppServerStdoutLines({
            decoder,
            buffer,
            chunk: value,
          });
          buffer = decoded.buffer;
          for (const line of decoded.lines) {
            this.handleStdoutLine(line);
          }
        }

        const decoded = readCodexAppServerStdoutLines({
          decoder,
          buffer,
        });
        for (const line of decoded.lines) {
          this.handleStdoutLine(line);
        }
      } catch (error) {
        if (this.proc === proc) {
          log.error("[agents] codex app-server stdout reader failed", error);
        }
      }
    })();
  }

  private startStderrLoop(proc: PipedCodexAppServerProcess): void {
    (async () => {
      const reader = proc.stderr.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true }).trim();
          if (chunk.length > 0) {
            log.debug(`[agents] codex app-server stderr: ${chunk}`);
          }
        }
      } catch (error) {
        if (this.proc === proc) {
          log.error("[agents] codex app-server stderr reader failed", error);
        }
      }
    })();
  }

  private handleStdoutLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      log.error(`[agents] failed to parse codex app-server line: ${line}`, error);
      return;
    }

    if (!isRecord(parsed)) {
      log.warn(`[agents] unexpected codex app-server payload: ${line}`);
      return;
    }

    const responseId = this.readResponseId(parsed);
    if (responseId !== null) {
      this.handleResponse(responseId, parsed);
      return;
    }

    const notification = this.readNotification(parsed);
    if (!notification) {
      log.warn(`[agents] unexpected codex app-server message: ${line}`);
      return;
    }

    for (const listener of this.listeners) {
      listener(notification);
    }
  }

  private readNotification(raw: Record<string, unknown>): CodexAppServerNotification | null {
    if (typeof raw.method !== "string") return null;
    return {
      method: raw.method,
      ...(raw.params !== undefined ? { params: raw.params } : {}),
    };
  }

  private readResponseId(raw: Record<string, unknown>): number | null {
    return typeof raw.id === "number" ? raw.id : null;
  }

  private handleResponse(id: number, raw: Record<string, unknown>): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);

    const responseError = this.readResponseError(raw);
    if (responseError) {
      pending.reject(new CodexAppServerRequestError(
        responseError.message,
        responseError.code,
        responseError.data,
      ));
      return;
    }

    pending.resolve(raw.result);
  }

  private async requestInternal<T>(
    method: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    params?: unknown,
  ): Promise<T> {
    if (!this.proc) {
      throw new Error("codex app-server process is not available");
    }

    const id = this.nextId;
    this.nextId += 1;

    const result = await new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.send({
          id,
          method,
          ...(params !== undefined ? { params } : {}),
        });
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });

    const parsed = schema.safeParse(result);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new Error(
        issue
          ? `codex app-server returned invalid ${method} response: ${issue.message}`
          : `codex app-server returned invalid ${method} response`,
      );
    }
    return parsed.data;
  }

  private send(payload: unknown): void {
    const proc = this.proc;
    if (!proc) {
      throw new Error("codex app-server process is not available");
    }

    proc.stdin.write(this.encoder.encode(JSON.stringify(payload) + "\n"));
    proc.stdin.flush();
  }

  private rejectPending(error: Error): void {
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const request of pending) {
      request.reject(error);
    }
  }

  private resetProcess(): void {
    this.proc = null;
    this.readyPromise = null;
  }

  private readResponseError(raw: Record<string, unknown>): CodexAppServerJsonRpcError | null {
    if (!isRecord(raw.error)) return null;
    return typeof raw.error.code === "number" && typeof raw.error.message === "string"
      ? {
          code: raw.error.code,
          message: raw.error.message,
          ...(raw.error.data !== undefined ? { data: raw.error.data } : {}),
        }
      : null;
  }
}
