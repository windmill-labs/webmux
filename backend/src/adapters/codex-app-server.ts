import { log } from "../lib/log";

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
  text: string;
  phase: string;
  memoryCitation: unknown;
}

export interface CodexAppServerGenericItem {
  type: string;
  id: string;
}

export type CodexAppServerThreadItem =
  | CodexAppServerUserMessageItem
  | CodexAppServerAgentMessageItem
  | CodexAppServerGenericItem;

export interface CodexAppServerTurn {
  id: string;
  items: CodexAppServerThreadItem[];
  status: string;
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

interface CodexAppServerInitializeResponse {
  userAgent: string;
  codexHome: string;
  platformFamily: string;
  platformOs: string;
}

interface CodexAppServerJsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

interface CodexAppServerJsonRpcResponse<T> {
  id: number;
  result?: T;
  error?: CodexAppServerJsonRpcError;
}

interface PendingRequest {
  reject: (reason?: unknown) => void;
  resolve: (value: unknown) => void;
}

type PipedCodexAppServerProcess = Bun.Subprocess<"pipe", "pipe", "pipe">;

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
  private readonly decoder = new TextDecoder();
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
    return await this.request<CodexAppServerThreadListResponse>("thread/list", params);
  }

  async threadRead(threadId: string, includeTurns: boolean): Promise<CodexAppServerThreadReadResponse> {
    return await this.request<CodexAppServerThreadReadResponse>("thread/read", { threadId, includeTurns });
  }

  async threadResume(params: CodexAppServerThreadResumeParams): Promise<CodexAppServerThreadContext> {
    return await this.request<CodexAppServerThreadContext>("thread/resume", params);
  }

  async threadStart(params: CodexAppServerThreadStartParams): Promise<CodexAppServerThreadContext> {
    return await this.request<CodexAppServerThreadContext>("thread/start", params);
  }

  async turnStart(params: CodexAppServerTurnStartParams): Promise<CodexAppServerTurnStartResponse> {
    return await this.request<CodexAppServerTurnStartResponse>("turn/start", params);
  }

  async turnInterrupt(params: CodexAppServerTurnInterruptParams): Promise<void> {
    await this.request<Record<string, never>>("turn/interrupt", params);
  }

  private async request<T>(method: string, params?: unknown): Promise<T> {
    await this.ensureReady();
    return await this.requestInternal<T>(method, params);
  }

  private async ensureReady(): Promise<void> {
    if (this.readyPromise) {
      return await this.readyPromise;
    }

    this.readyPromise = (async () => {
      this.startProcess();
      await this.requestInternal<CodexAppServerInitializeResponse>("initialize", {
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
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += this.decoder.decode(value);

          while (true) {
            const newlineIndex = buffer.indexOf("\n");
            if (newlineIndex === -1) break;
            const line = buffer.slice(0, newlineIndex).trim();
            buffer = buffer.slice(newlineIndex + 1);
            if (line.length === 0) continue;
            this.handleStdoutLine(line);
          }
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
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = this.decoder.decode(value).trim();
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

  private async requestInternal<T>(method: string, params?: unknown): Promise<T> {
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

    return result as T;
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

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}
