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
import type { WorktreeMeta, WorktreeSnapshot } from "../domain/model";
import {
  WorktreeConversationService,
  buildConversationState,
} from "../services/worktree-conversation-service";

class FakeGitGateway {
  resolveWorktreeGitDir(cwd: string): string {
    return `${cwd}/.git`;
  }
}

class FakeCodexAppServer implements CodexAppServerGateway {
  readonly calls: string[] = [];
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
    const thread = this.requireThread(params.threadId);
    thread.status = { type: "idle" };
    return this.buildContext(thread);
  }

  async threadStart(params: CodexAppServerThreadStartParams): Promise<CodexAppServerThreadContext> {
    this.calls.push(`threadStart:${params.cwd}`);
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
    path: "/tmp/worktrees/codex-feature",
    dir: "codex-feature",
    archived: false,
    profile: "default",
    agentName: "codex",
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
  };
}

function makeTurn(input: {
  id: string;
  status: string;
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
          role: "user",
          text: "Inspect the diff",
          status: "completed",
          createdAt: "1970-01-01T00:01:51.000Z",
        },
        {
          id: "assistant-1",
          turnId: "turn-1",
          role: "assistant",
          text: "I inspected it.",
          status: "completed",
          createdAt: "1970-01-01T00:03:20.000Z",
        },
      ],
    });
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
          role: "user",
          text: "Stop after the grep",
          status: "completed",
          createdAt: "1970-01-01T00:03:42.000Z",
        },
        {
          id: "assistant-2",
          turnId: "turn-interrupted",
          role: "assistant",
          text: "Interrupted after the grep step.",
          status: "completed",
          createdAt: "1970-01-01T00:03:42.000Z",
        },
      ],
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

    expect(metaStore.get(gitDir)?.conversation).toEqual(
      makeCodexConversationMeta("thread-new", worktree.path, "2026-04-14T12:00:00.000Z"),
    );
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
    expect(metaStore.get(gitDir)?.conversation).toEqual(
      makeCodexConversationMeta("thread-created", worktree.path, "2026-04-14T12:10:00.000Z"),
    );
  });

  it("switches to the newest discovered thread when saved metadata points to an older thread", async () => {
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
      now: () => new Date("2026-04-16T09:00:00.000Z"),
      readMeta: async (path) => structuredClone(metaStore.get(path) ?? null),
      writeMeta: async (path, meta) => {
        metaStore.set(path, structuredClone(meta));
      },
    });

    const result = await service.readWorktreeConversation(worktree);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.worktree.conversation?.conversationId).toBe("thread-new");
    expect(result.data.conversation.messages.at(-1)?.text).toBe("Latest reply");
    expect(appServer.calls).toEqual([
      "threadList",
      "threadRead:thread-new:false",
      "threadRead:thread-new:true",
    ]);
    expect(metaStore.get(gitDir)?.conversation).toEqual(
      makeCodexConversationMeta("thread-new", worktree.path, "2026-04-16T09:00:00.000Z"),
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
