import { describe, expect, it } from "bun:test";
import type {
  CodexAppServerGateway,
  CodexAppServerThread,
  CodexAppServerThreadContext,
  CodexAppServerThreadListParams,
  CodexAppServerThreadListResponse,
  CodexAppServerThreadReadResponse,
  CodexAppServerThreadResumeParams,
  CodexAppServerThreadStartParams,
  CodexAppServerTurn,
  CodexAppServerTurnInterruptParams,
  CodexAppServerTurnStartParams,
  CodexAppServerTurnStartResponse,
} from "../adapters/codex-app-server";
import type { ProfileConfig } from "../domain/config";
import type { WorktreeMeta, WorktreeSnapshot } from "../domain/model";
import {
  WorktreeConversationService,
  buildConversationState,
  resolveCodexAppServerLaunchContext,
  type CodexAppServerLaunchContext,
} from "../services/worktree-conversation-service";
import { ok, type WorktreeConversationResult } from "../services/worktree-conversation-result";

class FakeGitGateway {
  resolveWorktreeGitDir(cwd: string): string {
    return `${cwd}/.git`;
  }
}

class FakeCodexAppServer implements CodexAppServerGateway {
  readonly calls: string[] = [];
  readonly threadResumeParams: CodexAppServerThreadResumeParams[] = [];
  readonly threadStartParams: CodexAppServerThreadStartParams[] = [];
  readonly turnStartParams: CodexAppServerTurnStartParams[] = [];
  listedThreads: CodexAppServerThread[] = [];
  readonly threads = new Map<string, CodexAppServerThread>();
  nextStartedThreadId = "thread-created";
  nextStartedTurnId = "turn-created";

  async threadList(_params: CodexAppServerThreadListParams): Promise<CodexAppServerThreadListResponse> {
    this.calls.push("threadList");
    return {
      data: this.listedThreads.map((thread) => structuredClone(thread)),
      nextCursor: null,
    };
  }

  async threadRead(threadId: string, includeTurns: boolean): Promise<CodexAppServerThreadReadResponse> {
    this.calls.push(`threadRead:${threadId}:${includeTurns}`);
    const thread = this.threads.get(threadId);
    if (!thread) throw new Error(`Thread not found: ${threadId}`);

    return {
      thread: includeTurns
        ? structuredClone(thread)
        : {
            ...structuredClone(thread),
            turns: [],
          },
    };
  }

  async threadResume(params: CodexAppServerThreadResumeParams): Promise<CodexAppServerThreadContext> {
    this.calls.push(`threadResume:${params.threadId}`);
    this.threadResumeParams.push(structuredClone(params));
    const thread = this.requireThread(params.threadId);
    thread.status = { type: "idle" };
    return this.buildContext(thread);
  }

  async threadStart(params: CodexAppServerThreadStartParams): Promise<CodexAppServerThreadContext> {
    this.calls.push(`threadStart:${params.cwd}`);
    this.threadStartParams.push(structuredClone(params));
    const thread = makeThread({
      id: this.nextStartedThreadId,
      cwd: params.cwd,
      updatedAt: 300,
      statusType: "idle",
      turns: [],
      source: "vscode",
    });
    this.threads.set(thread.id, thread);
    this.listedThreads = [thread, ...this.listedThreads];
    return this.buildContext(thread);
  }

  async turnStart(params: CodexAppServerTurnStartParams): Promise<CodexAppServerTurnStartResponse> {
    const text = params.input[0]?.text ?? "";
    this.calls.push(`turnStart:${params.threadId}:${text}`);
    this.turnStartParams.push(structuredClone(params));
    const thread = this.requireThread(params.threadId);
    const turn = makeTurn({
      id: this.nextStartedTurnId,
      status: "inProgress",
      startedAt: 222,
      items: [
        {
          type: "userMessage",
          id: "user-live",
          content: [{ type: "text", text }],
        },
      ],
    });
    thread.status = { type: "active", activeFlags: [] };
    thread.turns = [...thread.turns, turn];
    return {
      turn: structuredClone(turn),
    };
  }

  async turnInterrupt(params: CodexAppServerTurnInterruptParams): Promise<void> {
    this.calls.push(`turnInterrupt:${params.threadId}:${params.turnId}`);
    const thread = this.requireThread(params.threadId);
    thread.status = { type: "idle" };
    thread.turns = thread.turns.map((turn) =>
      turn.id === params.turnId
        ? {
            ...turn,
            status: "interrupted",
          }
        : turn
    );
  }

  private buildContext(thread: CodexAppServerThread): CodexAppServerThreadContext {
    return {
      thread: structuredClone(thread),
      model: "gpt-5.4",
      modelProvider: "openai",
      serviceTier: null,
      cwd: thread.cwd,
      approvalPolicy: "never",
      approvalsReviewer: "user",
      sandbox: { type: "dangerFullAccess" },
      reasoningEffort: "xhigh",
    };
  }

  private requireThread(threadId: string): CodexAppServerThread {
    const thread = this.threads.get(threadId);
    if (!thread) throw new Error(`Thread not found: ${threadId}`);
    return thread;
  }
}

function makeMeta(): WorktreeMeta {
  return {
    schemaVersion: 1,
    worktreeId: "wt-123",
    branch: "codex-feature",
    createdAt: "2026-04-14T10:00:00.000Z",
    profile: "default",
    agent: "codex",
    runtime: "host",
    startupEnvValues: {},
    allocatedPorts: {},
  };
}

function allowCodexLaunchContext(): WorktreeConversationResult<CodexAppServerLaunchContext> {
  return ok({
    approvalPolicy: "never",
    personality: "pragmatic",
    sandbox: "danger-full-access",
  });
}

function makeCodexConversationMeta(threadId: string, cwd: string, lastSeenAt = "2026-04-14T11:00:00.000Z") {
  return {
    provider: "codexAppServer" as const,
    conversationId: threadId,
    threadId,
    cwd,
    lastSeenAt,
  };
}

function makeWorktree(): WorktreeSnapshot {
  return {
    branch: "codex-feature",
    label: null,
    path: "/tmp/worktrees/codex-feature",
    dir: "codex-feature",
    archived: false,
    profile: "default",
    agentName: "codex",
    agentLabel: "Codex",
    agentTerminalStale: false,
    mux: true,
    dirty: false,
    unpushed: false,
    paneCount: 1,
    status: "idle",
    elapsed: "1m",
    services: [],
    prs: [],
    linearIssue: null,
    creation: null,
    source: "ui",
    oneshot: null,
    tabs: [],
    activeTabId: null,
  };
}

function makeProfile(overrides: Partial<ProfileConfig> = {}): ProfileConfig {
  return {
    runtime: "host",
    envPassthrough: [],
    yolo: true,
    panes: [{ id: "agent", kind: "agent", focus: true }],
    ...overrides,
  };
}

function makeTurn(input: {
  id: string;
  status: CodexAppServerTurn["status"];
  startedAt: number | null;
  items: CodexAppServerTurn["items"];
}): CodexAppServerTurn {
  return {
    id: input.id,
    items: input.items,
    status: input.status,
    error: null,
    startedAt: input.startedAt,
    completedAt: input.status === "completed" ? 200 : null,
    durationMs: input.status === "completed" ? 1000 : null,
  };
}

function makeThread(input: {
  id: string;
  cwd: string;
  updatedAt: number;
  statusType: string;
  turns: CodexAppServerTurn[];
  source: string;
}): CodexAppServerThread {
  return {
    id: input.id,
    forkedFromId: null,
    preview: "",
    ephemeral: false,
    modelProvider: "openai",
    createdAt: 100,
    updatedAt: input.updatedAt,
    status: { type: input.statusType },
    path: `${input.cwd}/thread.jsonl`,
    cwd: input.cwd,
    cliVersion: "0.120.0",
    source: input.source,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns: input.turns,
  };
}

describe("buildConversationState", () => {
  it("maps user and assistant items into transcript messages", () => {
    const thread = makeThread({
      id: "thread-1",
      cwd: "/tmp/worktree",
      updatedAt: 120,
      statusType: "idle",
      source: "cli",
      turns: [
        makeTurn({
          id: "turn-1",
          status: "completed",
          startedAt: 111,
          items: [
            {
              type: "userMessage",
              id: "user-1",
              content: [{ type: "text", text: "Inspect the diff" }],
            },
            {
              type: "agentMessage",
              id: "assistant-1",
              text: "I inspected it.",
              phase: "final_answer",
              memoryCitation: null,
            },
          ],
        }),
      ],
    });

    expect(buildConversationState(thread)).toEqual({
      provider: "codexAppServer",
      conversationId: "thread-1",
      cwd: "/tmp/worktree",
      running: false,
      activeTurnId: null,
      messages: [
        {
          id: "user-1",
          turnId: "turn-1",
          order: 0,
          role: "user",
          kind: "text",
          text: "Inspect the diff",
          status: "completed",
          createdAt: "1970-01-01T00:01:51.000Z",
        },
        {
          id: "assistant-1",
          turnId: "turn-1",
          order: 1,
          role: "assistant",
          kind: "text",
          phase: "final_answer",
          text: "I inspected it.",
          status: "completed",
          createdAt: "1970-01-01T00:03:20.000Z",
        },
      ],
    });
  });

  it("maps app-server assistant message fields into transcript messages", () => {
    const thread = makeThread({
      id: "thread-message-field",
      cwd: "/tmp/worktree",
      updatedAt: 120,
      statusType: "idle",
      source: "cli",
      turns: [
        makeTurn({
          id: "turn-message-field",
          status: "completed",
          startedAt: 111,
          items: [
            {
              type: "agentMessage",
              id: "assistant-message-field",
              message: "The newer app server uses message here.",
              phase: "final_answer",
              memoryCitation: null,
            },
          ],
        }),
      ],
    });

    expect(buildConversationState(thread).messages).toEqual([
      {
        id: "assistant-message-field",
        turnId: "turn-message-field",
        order: 0,
        role: "assistant",
        kind: "text",
        phase: "final_answer",
        text: "The newer app server uses message here.",
        status: "completed",
        createdAt: "1970-01-01T00:03:20.000Z",
      },
    ]);
  });

  it("maps commentary as assistant text and command execution items as tool messages", () => {
    const thread = makeThread({
      id: "thread-tools",
      cwd: "/tmp/worktree",
      updatedAt: 120,
      statusType: "idle",
      source: "cli",
      turns: [
        makeTurn({
          id: "turn-tools",
          status: "completed",
          startedAt: 111,
          items: [
            {
              type: "agentMessage",
              id: "commentary-1",
              text: "I will inspect the directory.",
              phase: "commentary",
              memoryCitation: null,
            },
            {
              type: "commandExecution",
              id: "call-1",
              command: "/bin/zsh -lc ls",
              cwd: "/tmp/worktree",
              status: "completed",
              commandActions: [{ type: "listFiles", command: "ls", path: null }],
              aggregatedOutput: "README.md\n",
              exitCode: 0,
              durationMs: 12,
            },
          ],
        }),
      ],
    });

    expect(buildConversationState(thread).messages).toEqual([
      {
        id: "commentary-1",
        turnId: "turn-tools",
        order: 0,
        role: "assistant",
        kind: "text",
        phase: "commentary",
        text: "I will inspect the directory.",
        status: "completed",
        createdAt: "1970-01-01T00:03:20.000Z",
      },
      {
        id: "call-1",
        turnId: "turn-tools",
        order: 1,
        role: "assistant",
        kind: "toolUse",
        toolName: "shell",
        toolCallId: "call-1",
        text: "ls",
        command: "/bin/zsh -lc ls",
        cwd: "/tmp/worktree",
        status: "completed",
        createdAt: "1970-01-01T00:03:20.000Z",
        exitCode: 0,
        durationMs: 12,
      },
      {
        id: "call-1:result",
        turnId: "turn-tools",
        order: 2,
        role: "user",
        kind: "toolResult",
        toolName: "shell",
        toolCallId: "call-1",
        text: "README.md",
        command: "/bin/zsh -lc ls",
        cwd: "/tmp/worktree",
        status: "completed",
        createdAt: "1970-01-01T00:03:20.000Z",
        exitCode: 0,
        durationMs: 12,
      },
    ]);
  });

  it("uses app-server command execution items as the transcript source", () => {
    const thread = makeThread({
      id: "thread-tools",
      cwd: "/tmp/worktree",
      updatedAt: 120,
      statusType: "idle",
      source: "cli",
      turns: [
        makeTurn({
          id: "turn-tools",
          status: "completed",
          startedAt: 111,
          items: [
            {
              type: "commandExecution",
              id: "item-tool-1",
              command: "/bin/zsh -lc ls",
              cwd: "/tmp/worktree",
              status: "completed",
              commandActions: [{ type: "listFiles", command: "ls", path: null }],
              aggregatedOutput: "README.md\n",
              exitCode: 0,
              durationMs: 12,
            },
          ],
        }),
      ],
    });

    expect(buildConversationState(thread).messages).toEqual([
      {
        id: "item-tool-1",
        turnId: "turn-tools",
        order: 0,
        role: "assistant",
        kind: "toolUse",
        toolName: "shell",
        toolCallId: "item-tool-1",
        text: "ls",
        command: "/bin/zsh -lc ls",
        cwd: "/tmp/worktree",
        status: "completed",
        createdAt: "1970-01-01T00:03:20.000Z",
        exitCode: 0,
        durationMs: 12,
      },
      {
        id: "item-tool-1:result",
        turnId: "turn-tools",
        order: 1,
        role: "user",
        kind: "toolResult",
        toolName: "shell",
        toolCallId: "item-tool-1",
        text: "README.md",
        command: "/bin/zsh -lc ls",
        cwd: "/tmp/worktree",
        status: "completed",
        createdAt: "1970-01-01T00:03:20.000Z",
        exitCode: 0,
        durationMs: 12,
      },
    ]);
  });

  it("maps app-server tool items into initial transcript tool blocks", () => {
    const thread = makeThread({
      id: "thread-tool-items",
      cwd: "/tmp/worktree",
      updatedAt: 120,
      statusType: "idle",
      source: "cli",
      turns: [
        makeTurn({
          id: "turn-tool-items",
          status: "completed",
          startedAt: 111,
          items: [
            {
              type: "mcpToolCall",
              id: "mcp-1",
              server: "linear",
              tool: "get_issue",
              status: "completed",
              arguments: { issueId: "ENG-123" },
              pluginId: null,
              result: {
                content: [{ type: "text", text: "Issue title" }],
                structuredContent: { status: "Todo" },
                _meta: null,
              },
              error: null,
              durationMs: 25,
            },
            {
              type: "fileChange",
              id: "patch-1",
              status: "completed",
              changes: [
                {
                  path: "README.md",
                  kind: { type: "update", move_path: null },
                  diff: "--- a/README.md\n+++ b/README.md\n",
                },
              ],
            },
            {
              type: "dynamicToolCall",
              id: "dynamic-1",
              namespace: "workspace",
              tool: "lookup",
              arguments: { query: "status" },
              status: "completed",
              contentItems: [{ type: "inputText", text: "ok" }],
              success: true,
              durationMs: 10,
            },
            {
              type: "webSearch",
              id: "search-1",
              query: "codex app server",
              action: {
                type: "search",
                query: null,
                queries: ["codex app server"],
              },
            },
          ],
        }),
      ],
    });

    expect(buildConversationState(thread).messages).toEqual([
      {
        id: "mcp-1",
        turnId: "turn-tool-items",
        order: 0,
        role: "assistant",
        kind: "toolUse",
        toolName: "linear.get_issue",
        toolCallId: "mcp-1",
        text: "{\n  \"issueId\": \"ENG-123\"\n}",
        status: "completed",
        createdAt: "1970-01-01T00:03:20.000Z",
        durationMs: 25,
      },
      {
        id: "mcp-1:result",
        turnId: "turn-tool-items",
        order: 1,
        role: "user",
        kind: "toolResult",
        toolName: "linear.get_issue",
        toolCallId: "mcp-1",
        text: "Issue title\n\n{\n  \"status\": \"Todo\"\n}",
        status: "completed",
        createdAt: "1970-01-01T00:03:20.000Z",
        durationMs: 25,
      },
      {
        id: "patch-1",
        turnId: "turn-tool-items",
        order: 2,
        role: "assistant",
        kind: "toolUse",
        toolName: "file change",
        toolCallId: "patch-1",
        text: "update README.md",
        status: "completed",
        createdAt: "1970-01-01T00:03:20.000Z",
      },
      {
        id: "patch-1:result",
        turnId: "turn-tool-items",
        order: 3,
        role: "user",
        kind: "toolResult",
        toolName: "file change",
        toolCallId: "patch-1",
        text: "--- a/README.md\n+++ b/README.md",
        status: "completed",
        createdAt: "1970-01-01T00:03:20.000Z",
      },
      {
        id: "dynamic-1",
        turnId: "turn-tool-items",
        order: 4,
        role: "assistant",
        kind: "toolUse",
        toolName: "workspace.lookup",
        toolCallId: "dynamic-1",
        text: "{\n  \"query\": \"status\"\n}",
        status: "completed",
        createdAt: "1970-01-01T00:03:20.000Z",
        durationMs: 10,
      },
      {
        id: "dynamic-1:result",
        turnId: "turn-tool-items",
        order: 5,
        role: "user",
        kind: "toolResult",
        toolName: "workspace.lookup",
        toolCallId: "dynamic-1",
        text: "ok",
        status: "completed",
        createdAt: "1970-01-01T00:03:20.000Z",
        durationMs: 10,
      },
      {
        id: "search-1",
        turnId: "turn-tool-items",
        order: 6,
        role: "assistant",
        kind: "toolUse",
        toolName: "web search",
        toolCallId: "search-1",
        text: "codex app server",
        status: "completed",
        createdAt: "1970-01-01T00:03:20.000Z",
      },
    ]);
  });

  it("ignores assistant-looking items without message text", () => {
    const thread = makeThread({
      id: "thread-generic-agent",
      cwd: "/tmp/worktree",
      updatedAt: 120,
      statusType: "idle",
      source: "cli",
      turns: [
        makeTurn({
          id: "turn-generic-agent",
          status: "completed",
          startedAt: 111,
          items: [
            {
              type: "agentMessage",
              id: "assistant-generic",
            },
          ],
        }),
      ],
    });

    expect(buildConversationState(thread).messages).toEqual([]);
  });

  it("does not mark interrupted turns as running", () => {
    const thread = makeThread({
      id: "thread-2",
      cwd: "/tmp/worktree",
      updatedAt: 121,
      statusType: "idle",
      source: "cli",
      turns: [
        makeTurn({
          id: "turn-interrupted",
          status: "interrupted",
          startedAt: 222,
          items: [
            {
              type: "userMessage",
              id: "user-2",
              content: [{ type: "text", text: "Stop after the grep" }],
            },
            {
              type: "agentMessage",
              id: "assistant-2",
              text: "Interrupted after the grep step.",
              phase: "final_answer",
              memoryCitation: null,
            },
          ],
        }),
      ],
    });

    expect(buildConversationState(thread)).toEqual({
      provider: "codexAppServer",
      conversationId: "thread-2",
      cwd: "/tmp/worktree",
      running: false,
      activeTurnId: null,
      messages: [
        {
          id: "user-2",
          turnId: "turn-interrupted",
          order: 0,
          role: "user",
          kind: "text",
          text: "Stop after the grep",
          status: "completed",
          createdAt: "1970-01-01T00:03:42.000Z",
        },
        {
          id: "assistant-2",
          turnId: "turn-interrupted",
          order: 1,
          role: "assistant",
          kind: "text",
          phase: "final_answer",
          text: "Interrupted after the grep step.",
          status: "completed",
          createdAt: "1970-01-01T00:03:42.000Z",
        },
      ],
    });
  });
});

describe("resolveCodexAppServerLaunchContext", () => {
  it("allows host yolo Codex worktrees and maps them to app-server launch params", () => {
    expect(resolveCodexAppServerLaunchContext({
      worktree: makeWorktree(),
      meta: makeMeta(),
      profile: makeProfile(),
    })).toEqual({
      ok: true,
      data: {
        approvalPolicy: "never",
        personality: "pragmatic",
        sandbox: "danger-full-access",
      },
    });
  });

  it("rejects Docker and non-yolo worktrees instead of changing execution context", () => {
    expect(resolveCodexAppServerLaunchContext({
      worktree: makeWorktree(),
      meta: { ...makeMeta(), runtime: "docker" },
      profile: makeProfile({ runtime: "docker", image: "node:22" }),
    })).toEqual({
      ok: false,
      status: 409,
      error: "Codex web chat is only available for host-runtime worktrees. Use the terminal for Docker worktrees.",
    });

    expect(resolveCodexAppServerLaunchContext({
      worktree: makeWorktree(),
      meta: makeMeta(),
      profile: makeProfile({ yolo: false }),
    })).toEqual({
      ok: false,
      status: 409,
      error: "Codex web chat requires a yolo profile to preserve the Codex approval policy. Use the terminal for this worktree.",
    });
  });
});

describe("WorktreeConversationService", () => {
  it("discovers the newest thread by cwd and persists the conversation mapping", async () => {
    const metaStore = new Map<string, WorktreeMeta>();
    const worktree = makeWorktree();
    const gitDir = `${worktree.path}/.git`;
    metaStore.set(gitDir, makeMeta());

    const appServer = new FakeCodexAppServer();
    const olderThread = makeThread({
      id: "thread-old",
      cwd: worktree.path,
      updatedAt: 200,
      statusType: "notLoaded",
      source: "cli",
      turns: [],
    });
    const newestThread = makeThread({
      id: "thread-new",
      cwd: worktree.path,
      updatedAt: 250,
      statusType: "notLoaded",
      source: "cli",
      turns: [
        makeTurn({
          id: "turn-complete",
          status: "completed",
          startedAt: 111,
          items: [
            {
              type: "userMessage",
              id: "user-1",
              content: [{ type: "text", text: "Reply with exactly: CLI_SESSION_OK" }],
            },
            {
              type: "agentMessage",
              id: "assistant-1",
              text: "CLI_SESSION_OK",
              phase: "final_answer",
              memoryCitation: null,
            },
          ],
        }),
      ],
    });
    appServer.listedThreads = [olderThread, newestThread];
    appServer.threads.set(olderThread.id, structuredClone(olderThread));
    appServer.threads.set(newestThread.id, structuredClone(newestThread));

    const service = new WorktreeConversationService({
      appServer,
      git: new FakeGitGateway(),
      resolveLaunchContext: allowCodexLaunchContext,
      now: () => new Date("2026-04-14T12:00:00.000Z"),
      readMeta: async (path) => structuredClone(metaStore.get(path) ?? null),
      writeMeta: async (path, meta) => {
        metaStore.set(path, structuredClone(meta));
      },
    });

    const result = await service.attachWorktreeConversation(worktree);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.worktree.conversation?.conversationId).toBe("thread-new");
    expect(result.data.conversation.messages).toHaveLength(2);
    expect(appServer.calls).toEqual([
      "threadList",
      "threadRead:thread-new:false",
      "threadResume:thread-new",
      "threadRead:thread-new:true",
    ]);
    expect(appServer.threadResumeParams[0]).toEqual({
      threadId: "thread-new",
      cwd: worktree.path,
      approvalPolicy: "never",
      personality: "pragmatic",
      sandbox: "danger-full-access",
    });

    expect(metaStore.get(gitDir)?.conversation).toEqual(
      makeCodexConversationMeta("thread-new", worktree.path, "2026-04-14T12:00:00.000Z"),
    );
  });

  it("uses JSONL session messages as the Codex snapshot transcript when available", async () => {
    const metaStore = new Map<string, WorktreeMeta>();
    const worktree = makeWorktree();
    const gitDir = `${worktree.path}/.git`;
    metaStore.set(gitDir, makeMeta());

    const thread = makeThread({
      id: "thread-jsonl",
      cwd: worktree.path,
      updatedAt: 250,
      statusType: "idle",
      source: "cli",
      turns: [
        makeTurn({
          id: "turn-jsonl",
          status: "completed",
          startedAt: 111,
          items: [
            {
              type: "userMessage",
              id: "user-app-server",
              content: [{ type: "text", text: "App server text only" }],
            },
          ],
        }),
      ],
    });
    const appServer = new FakeCodexAppServer();
    appServer.listedThreads = [thread];
    appServer.threads.set(thread.id, structuredClone(thread));

    const service = new WorktreeConversationService({
      appServer,
      git: new FakeGitGateway(),
      resolveLaunchContext: allowCodexLaunchContext,
      readSessionMessages: async () => [
        {
          id: "call-1",
          turnId: "turn-jsonl",
          order: 0,
          role: "assistant",
          kind: "toolUse",
          toolName: "exec_command",
          toolCallId: "call-1",
          text: "bun test",
          command: "bun test",
          status: "completed",
          createdAt: "2026-05-29T10:00:00.000Z",
        },
        {
          id: "call-1:result",
          turnId: "turn-jsonl",
          order: 1,
          role: "user",
          kind: "toolResult",
          toolName: "exec_command",
          toolCallId: "call-1",
          text: "pass",
          command: "bun test",
          status: "completed",
          createdAt: "2026-05-29T10:00:01.000Z",
        },
      ],
      readMeta: async (path) => structuredClone(metaStore.get(path) ?? null),
      writeMeta: async (path, meta) => {
        metaStore.set(path, structuredClone(meta));
      },
    });

    const result = await service.attachWorktreeConversation(worktree);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.conversation.messages.map((message) => message.id)).toEqual([
      "call-1",
      "call-1:result",
    ]);
    expect(result.data.conversation.messages.map((message) => message.text)).toEqual([
      "bun test",
      "pass",
    ]);
  });

  it("creates a new thread on attach when none can be resolved", async () => {
    const metaStore = new Map<string, WorktreeMeta>();
    const worktree = makeWorktree();
    const gitDir = `${worktree.path}/.git`;
    metaStore.set(gitDir, makeMeta());

    const appServer = new FakeCodexAppServer();
    const service = new WorktreeConversationService({
      appServer,
      git: new FakeGitGateway(),
      resolveLaunchContext: allowCodexLaunchContext,
      now: () => new Date("2026-04-14T12:10:00.000Z"),
      readMeta: async (path) => structuredClone(metaStore.get(path) ?? null),
      writeMeta: async (path, meta) => {
        metaStore.set(path, structuredClone(meta));
      },
    });

    const result = await service.attachWorktreeConversation(worktree);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.worktree.conversation?.conversationId).toBe("thread-created");
    expect(appServer.calls).toEqual([
      "threadList",
      "threadStart:/tmp/worktrees/codex-feature",
    ]);
    expect(appServer.threadStartParams[0]).toEqual({
      cwd: worktree.path,
      approvalPolicy: "never",
      personality: "pragmatic",
      sandbox: "danger-full-access",
    });
    expect(metaStore.get(gitDir)?.conversation).toEqual(
      makeCodexConversationMeta("thread-created", worktree.path, "2026-04-14T12:10:00.000Z"),
    );
  });

  it("starts a Codex turn through the app server", async () => {
    const metaStore = new Map<string, WorktreeMeta>();
    const worktree = makeWorktree();
    const gitDir = `${worktree.path}/.git`;
    metaStore.set(gitDir, {
      ...makeMeta(),
      conversation: makeCodexConversationMeta("thread-existing", worktree.path),
    });

    const thread = makeThread({
      id: "thread-existing",
      cwd: worktree.path,
      updatedAt: 250,
      statusType: "idle",
      source: "cli",
      turns: [],
    });
    const appServer = new FakeCodexAppServer();
    appServer.threads.set(thread.id, structuredClone(thread));

    const service = new WorktreeConversationService({
      appServer,
      git: new FakeGitGateway(),
      resolveLaunchContext: allowCodexLaunchContext,
      readMeta: async (path) => structuredClone(metaStore.get(path) ?? null),
      writeMeta: async (path, meta) => {
        metaStore.set(path, structuredClone(meta));
      },
    });

    const result = await service.sendWorktreeConversationMessage(worktree, "Ship it");
    expect(result).toEqual({
      ok: true,
      data: {
        conversationId: "thread-existing",
        turnId: "turn-created",
        running: true,
        streaming: true,
      },
    });
    expect(appServer.calls).toEqual([
      "threadRead:thread-existing:false",
      "threadRead:thread-existing:true",
      "turnStart:thread-existing:Ship it",
    ]);
    expect(appServer.turnStartParams[0]).toEqual({
      threadId: "thread-existing",
      cwd: worktree.path,
      approvalPolicy: "never",
      input: [{ type: "text", text: "Ship it" }],
    });
  });

  it("rejects Codex turns before app-server calls when launch context is unsupported", async () => {
    const metaStore = new Map<string, WorktreeMeta>();
    const worktree = makeWorktree();
    const gitDir = `${worktree.path}/.git`;
    metaStore.set(gitDir, {
      ...makeMeta(),
      runtime: "docker",
      conversation: makeCodexConversationMeta("thread-existing", worktree.path),
    });

    const appServer = new FakeCodexAppServer();
    const service = new WorktreeConversationService({
      appServer,
      git: new FakeGitGateway(),
      resolveLaunchContext: ({ worktree: resolvedWorktree, meta }) =>
        resolveCodexAppServerLaunchContext({
          worktree: resolvedWorktree,
          meta,
          profile: makeProfile({ runtime: "docker", image: "node:22" }),
        }),
      readMeta: async (path) => structuredClone(metaStore.get(path) ?? null),
      writeMeta: async (path, meta) => {
        metaStore.set(path, structuredClone(meta));
      },
    });

    const result = await service.sendWorktreeConversationMessage(worktree, "Ship it");
    expect(result).toEqual({
      ok: false,
      status: 409,
      error: "Codex web chat is only available for host-runtime worktrees. Use the terminal for Docker worktrees.",
    });
    expect(appServer.calls).toEqual([]);
  });

  it("interrupts the active Codex app-server turn", async () => {
    const metaStore = new Map<string, WorktreeMeta>();
    const worktree = makeWorktree();
    const gitDir = `${worktree.path}/.git`;
    metaStore.set(gitDir, {
      ...makeMeta(),
      conversation: makeCodexConversationMeta("thread-active", worktree.path),
    });

    const thread = makeThread({
      id: "thread-active",
      cwd: worktree.path,
      updatedAt: 250,
      statusType: "active",
      source: "cli",
      turns: [
        makeTurn({
          id: "turn-active",
          status: "inProgress",
          startedAt: 111,
          items: [
            {
              type: "userMessage",
              id: "user-active",
              content: [{ type: "text", text: "Run checks" }],
            },
          ],
        }),
      ],
    });
    const appServer = new FakeCodexAppServer();
    appServer.threads.set(thread.id, structuredClone(thread));

    const service = new WorktreeConversationService({
      appServer,
      git: new FakeGitGateway(),
      resolveLaunchContext: allowCodexLaunchContext,
      readMeta: async (path) => structuredClone(metaStore.get(path) ?? null),
      writeMeta: async (path, meta) => {
        metaStore.set(path, structuredClone(meta));
      },
    });

    const result = await service.interruptWorktreeConversation(worktree);
    expect(result).toEqual({
      ok: true,
      data: {
        conversationId: "thread-active",
        turnId: "turn-active",
        interrupted: true,
        streaming: true,
      },
    });
    expect(appServer.calls.at(-1)).toBe("turnInterrupt:thread-active:turn-active");
  });

  it("keeps the saved thread when cwd discovery contains a newer unrelated thread", async () => {
    const metaStore = new Map<string, WorktreeMeta>();
    const worktree = makeWorktree();
    const gitDir = `${worktree.path}/.git`;
    metaStore.set(gitDir, {
      ...makeMeta(),
      conversation: makeCodexConversationMeta("thread-old", worktree.path),
    });

    const appServer = new FakeCodexAppServer();
    const olderThread = makeThread({
      id: "thread-old",
      cwd: worktree.path,
      updatedAt: 200,
      statusType: "idle",
      source: "cli",
      turns: [
        makeTurn({
          id: "turn-old",
          status: "completed",
          startedAt: 111,
          items: [
            {
              type: "userMessage",
              id: "user-old",
              content: [{ type: "text", text: "Old prompt" }],
            },
            {
              type: "agentMessage",
              id: "assistant-old",
              text: "Old reply",
              phase: "final_answer",
              memoryCitation: null,
            },
          ],
        }),
      ],
    });
    const newestThread = makeThread({
      id: "thread-new",
      cwd: worktree.path,
      updatedAt: 250,
      statusType: "idle",
      source: "cli",
      turns: [
        makeTurn({
          id: "turn-new",
          status: "completed",
          startedAt: 222,
          items: [
            {
              type: "userMessage",
              id: "user-new",
              content: [{ type: "text", text: "Latest prompt" }],
            },
            {
              type: "agentMessage",
              id: "assistant-new",
              text: "Latest reply",
              phase: "final_answer",
              memoryCitation: null,
            },
          ],
        }),
      ],
    });
    appServer.listedThreads = [olderThread, newestThread];
    appServer.threads.set(olderThread.id, structuredClone(olderThread));
    appServer.threads.set(newestThread.id, structuredClone(newestThread));

    const service = new WorktreeConversationService({
      appServer,
      git: new FakeGitGateway(),
      resolveLaunchContext: allowCodexLaunchContext,
      now: () => new Date("2026-04-16T09:00:00.000Z"),
      readMeta: async (path) => structuredClone(metaStore.get(path) ?? null),
      writeMeta: async (path, meta) => {
        metaStore.set(path, structuredClone(meta));
      },
    });

    const result = await service.readWorktreeConversation(worktree);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.worktree.conversation?.conversationId).toBe("thread-old");
    expect(result.data.conversation.messages.at(-1)?.text).toBe("Old reply");
    expect(appServer.calls).toEqual([
      "threadRead:thread-old:false",
      "threadRead:thread-old:true",
    ]);
    expect(metaStore.get(gitDir)?.conversation).toEqual(
      makeCodexConversationMeta("thread-old", worktree.path, "2026-04-14T11:00:00.000Z"),
    );
  });

  it("does not create a new thread when reading history without an existing conversation", async () => {
    const metaStore = new Map<string, WorktreeMeta>();
    const worktree = makeWorktree();
    const gitDir = `${worktree.path}/.git`;
    metaStore.set(gitDir, makeMeta());

    const appServer = new FakeCodexAppServer();
    const service = new WorktreeConversationService({
      appServer,
      git: new FakeGitGateway(),
      resolveLaunchContext: allowCodexLaunchContext,
      readMeta: async (path) => structuredClone(metaStore.get(path) ?? null),
      writeMeta: async (path, meta) => {
        metaStore.set(path, structuredClone(meta));
      },
    });

    const result = await service.readWorktreeConversation(worktree);
    expect(result).toEqual({
      ok: false,
      status: 404,
      error: "No Codex thread could be resolved for this worktree",
    });
    expect(appServer.calls).toEqual([
      "threadList",
    ]);
    expect(metaStore.get(gitDir)?.conversation).toBeUndefined();
  });

});
