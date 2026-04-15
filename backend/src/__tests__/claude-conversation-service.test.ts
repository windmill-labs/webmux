import { describe, expect, it } from "bun:test";
import type {
  ClaudeCliGateway,
  ClaudeCliSession,
  ClaudeCliSessionSummary,
} from "../adapters/claude-cli";
import type { WorktreeMeta, WorktreeSnapshot } from "../domain/model";
import { ClaudeConversationService } from "../services/claude-conversation-service";

class FakeGitGateway {
  resolveWorktreeGitDir(cwd: string): string {
    return `${cwd}/.git`;
  }
}

class FakeClaudeCliGateway implements Pick<ClaudeCliGateway, "listSessions" | "readSession"> {
  readonly calls: string[] = [];
  readonly sessions = new Map<string, ClaudeCliSession>();
  listedSessions: ClaudeCliSessionSummary[] = [];

  async listSessions(cwd: string): Promise<ClaudeCliSessionSummary[]> {
    this.calls.push(`listSessions:${cwd}`);
    return this.listedSessions.map((session) => ({ ...session }));
  }

  async readSession(sessionId: string, cwd: string): Promise<ClaudeCliSession | null> {
    this.calls.push(`readSession:${sessionId}:${cwd}`);
    return structuredClone(this.sessions.get(sessionId) ?? null);
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
    expect(result.data.conversation.running).toBe(false);
    expect(result.data.conversation.messages).toHaveLength(2);
    expect(metaStore.get(gitDir)?.conversation).toEqual({
      provider: "claudeCode",
      conversationId: "session-existing",
      sessionId: "session-existing",
      cwd: worktree.path,
      lastSeenAt: "2026-04-14T12:00:00.000Z",
    });
  });
});
