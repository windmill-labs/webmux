import { describe, expect, it } from "bun:test";
import type {
  ClaudeCliGateway,
  ClaudeCliRunCallbacks,
  ClaudeCliRunHandle,
  ClaudeCliSession,
  ClaudeCliSessionSummary,
} from "../adapters/claude-cli";
import type { AgentsUiConversationEvent } from "../domain/agents-ui";
import type { WorktreeMeta, WorktreeSnapshot } from "../domain/model";
import { ClaudeConversationService } from "../services/claude-conversation-service";

class FakeGitGateway {
  resolveWorktreeGitDir(cwd: string): string {
    return `${cwd}/.git`;
  }
}

interface FakeRun {
  callbacks: ClaudeCliRunCallbacks;
  completionReject: (reason?: unknown) => void;
  completionResolve: () => void;
  interrupted: boolean;
  params: {
    cwd: string;
    prompt: string;
    resumeSessionId?: string | null;
  };
  sessionId: string;
}

class FakeClaudeCliGateway implements ClaudeCliGateway {
  readonly calls: string[] = [];
  readonly sessions = new Map<string, ClaudeCliSession>();
  listedSessions: ClaudeCliSessionSummary[] = [];
  nextSessionId = "session-new";
  lastRun: FakeRun | null = null;

  async listSessions(cwd: string): Promise<ClaudeCliSessionSummary[]> {
    this.calls.push(`listSessions:${cwd}`);
    return this.listedSessions.map((session) => ({ ...session }));
  }

  async readSession(sessionId: string, cwd: string): Promise<ClaudeCliSession | null> {
    this.calls.push(`readSession:${sessionId}:${cwd}`);
    return structuredClone(this.sessions.get(sessionId) ?? null);
  }

  sendMessage(
    params: {
      cwd: string;
      prompt: string;
      resumeSessionId?: string | null;
    },
    callbacks: ClaudeCliRunCallbacks,
  ): ClaudeCliRunHandle {
    this.calls.push(`sendMessage:${params.cwd}:${params.resumeSessionId ?? ""}:${params.prompt}`);
    const sessionId = params.resumeSessionId ?? this.nextSessionId;
    callbacks.onSessionId?.(sessionId);

    let completionResolve!: () => void;
    let completionReject!: (reason?: unknown) => void;
    const completion = new Promise<void>((resolve, reject) => {
      completionResolve = resolve;
      completionReject = reject;
    });

    this.lastRun = {
      callbacks,
      completionReject,
      completionResolve,
      interrupted: false,
      params,
      sessionId,
    };

    return {
      completion,
      interrupt: () => {
        if (!this.lastRun) return;
        this.lastRun.interrupted = true;
        this.lastRun.completionResolve();
      },
      sessionId: Promise.resolve(sessionId),
    };
  }

  emitDelta(text: string): void {
    this.lastRun?.callbacks.onAssistantDelta?.(text);
  }

  complete(session: ClaudeCliSession): void {
    this.sessions.set(session.sessionId, structuredClone(session));
    this.lastRun?.callbacks.onComplete?.(session.sessionId);
    this.lastRun?.completionResolve();
  }
}

function makeMeta(): WorktreeMeta {
  return {
    schemaVersion: 1,
    worktreeId: "wt-claude",
    branch: "claude-feature",
    createdAt: "2026-04-14T10:00:00.000Z",
    profile: "default",
    agent: "claude",
    runtime: "host",
    startupEnvValues: {},
    allocatedPorts: {},
  };
}

function makeWorktree(): WorktreeSnapshot {
  return {
    branch: "claude-feature",
    path: "/tmp/worktrees/claude-feature",
    dir: "claude-feature",
    archived: false,
    profile: "default",
    agentName: "claude",
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

function makeSession(input: {
  sessionId: string;
  cwd: string;
  messages: ClaudeCliSession["messages"];
}): ClaudeCliSession {
  return {
    sessionId: input.sessionId,
    cwd: input.cwd,
    path: `${input.cwd}/${input.sessionId}.jsonl`,
    gitBranch: "claude-feature",
    createdAt: "2026-04-14T10:00:00.000Z",
    lastSeenAt: "2026-04-14T10:05:00.000Z",
    messages: input.messages,
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("ClaudeConversationService", () => {
  it("discovers the newest Claude session and persists it into metadata", async () => {
    const metaStore = new Map<string, WorktreeMeta>();
    const worktree = makeWorktree();
    const gitDir = `${worktree.path}/.git`;
    metaStore.set(gitDir, makeMeta());

    const session = makeSession({
      sessionId: "session-existing",
      cwd: worktree.path,
      messages: [
        {
          id: "user-1",
          turnId: "user-1",
          role: "user",
          text: "Inspect the diff",
          createdAt: "2026-04-14T10:01:00.000Z",
        },
        {
          id: "assistant-1",
          turnId: "user-1",
          role: "assistant",
          text: "The diff is clean.",
          createdAt: "2026-04-14T10:02:00.000Z",
        },
      ],
    });

    const claude = new FakeClaudeCliGateway();
    claude.listedSessions = [{
      sessionId: session.sessionId,
      cwd: worktree.path,
      path: session.path,
      lastSeenAt: "2026-04-14T10:05:00.000Z",
    }];
    claude.sessions.set(session.sessionId, structuredClone(session));

    const service = new ClaudeConversationService({
      claude,
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

    expect(result.data.conversation.provider).toBe("claudeCode");
    expect(result.data.conversation.conversationId).toBe("session-existing");
    expect(result.data.conversation.messages).toHaveLength(2);
    expect(metaStore.get(gitDir)?.conversation).toEqual({
      provider: "claudeCode",
      conversationId: "session-existing",
      sessionId: "session-existing",
      cwd: worktree.path,
      lastSeenAt: "2026-04-14T12:00:00.000Z",
    });
  });

  it("streams a Claude turn, snapshots completion, and supports interrupt", async () => {
    const metaStore = new Map<string, WorktreeMeta>();
    const worktree = makeWorktree();
    const gitDir = `${worktree.path}/.git`;
    metaStore.set(gitDir, makeMeta());

    const claude = new FakeClaudeCliGateway();
    const events: AgentsUiConversationEvent[] = [];
    const service = new ClaudeConversationService({
      claude,
      git: new FakeGitGateway(),
      now: () => new Date("2026-04-14T12:00:00.000Z"),
      readMeta: async (path) => structuredClone(metaStore.get(path) ?? null),
      writeMeta: async (path, meta) => {
        metaStore.set(path, structuredClone(meta));
      },
    });

    const unsubscribe = service.subscribe(worktree.branch, (event) => {
      events.push(event);
    });

    const sendResult = await service.sendWorktreeMessage(worktree, "Inspect the failing route");
    expect(sendResult).toEqual({
      ok: true,
      data: {
        conversationId: "session-new",
        turnId: expect.any(String),
        running: true,
      },
    });

    claude.emitDelta("Looking at the route now.");
    const runningState = await service.readWorktreeConversation(worktree);
    expect(runningState.ok).toBe(true);
    if (!runningState.ok) return;
    expect(runningState.data.conversation.running).toBe(true);
    expect(runningState.data.conversation.messages.at(-1)).toEqual({
      id: expect.stringMatching(/^assistant:/),
      turnId: sendResult.ok ? sendResult.data.turnId : "",
      role: "assistant",
      text: "Looking at the route now.",
      status: "inProgress",
      createdAt: null,
    });
    expect(events.at(-1)).toEqual({
      type: "messageDelta",
      conversationId: "session-new",
      turnId: sendResult.ok ? sendResult.data.turnId : "",
      itemId: expect.stringMatching(/^assistant:/),
      delta: "Looking at the route now.",
    });

    claude.complete(makeSession({
      sessionId: "session-new",
      cwd: worktree.path,
      messages: [
        {
          id: "user-2",
          turnId: "user-2",
          role: "user",
          text: "Inspect the failing route",
          createdAt: "2026-04-14T12:00:00.000Z",
        },
        {
          id: "assistant-2",
          turnId: "user-2",
          role: "assistant",
          text: "The route fails because the params are never parsed.",
          createdAt: "2026-04-14T12:00:02.000Z",
        },
      ],
    }));
    await waitFor(() => events.some((event) => event.type === "snapshot"));

    expect(events.some((event) => event.type === "snapshot")).toBe(true);
    const finalState = await service.readWorktreeConversation(worktree);
    expect(finalState.ok).toBe(true);
    if (!finalState.ok) return;
    expect(finalState.data.conversation.running).toBe(false);
    expect(finalState.data.conversation.messages.at(-1)?.text).toBe("The route fails because the params are never parsed.");

    const interruptSend = await service.sendWorktreeMessage(worktree, "Stop after the grep");
    expect(interruptSend.ok).toBe(true);
    const interruptResult = await service.interruptWorktreeConversation(worktree);
    expect(interruptResult).toEqual({
      ok: true,
      data: {
        conversationId: "session-new",
        turnId: interruptSend.ok ? interruptSend.data.turnId : "",
        interrupted: true,
      },
    });
    expect(claude.lastRun?.interrupted).toBe(true);

    unsubscribe();
  });
});
