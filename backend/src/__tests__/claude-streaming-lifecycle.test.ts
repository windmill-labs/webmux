import { describe, expect, it } from "bun:test";
import type {
  ClaudeCliGateway,
  ClaudeCliRunCallbacks,
  ClaudeCliRunHandle,
} from "../adapters/claude-cli";
import { ClaudeConversationStreamService } from "../services/claude-conversation-stream-service";
import { ProjectRuntime } from "../services/project-runtime";

class FakeClaudeCliGateway implements Pick<ClaudeCliGateway, "sendMessage"> {
  callbacks: ClaudeCliRunCallbacks | null = null;

  sendMessage(
    params: Parameters<ClaudeCliGateway["sendMessage"]>[0],
    callbacks: ClaudeCliRunCallbacks,
  ): ClaudeCliRunHandle {
    this.callbacks = callbacks;
    return {
      completion: Promise.resolve(),
      interrupt: () => {},
      sessionId: Promise.resolve(params.sessionId ?? params.resumeSessionId ?? "session-1"),
    };
  }
}

// Mirrors the server's busy gate (isBusyAgentStatus): a worktree is "busy" for
// web chat only while its agent lifecycle is starting/running.
const isBusy = (lifecycle: string): boolean => lifecycle === "starting" || lifecycle === "running";

describe("Claude web-chat streaming lifecycle", () => {
  it("marks the worktree finished when a streamed claude -p turn ends so the next web message is allowed", () => {
    const runtime = new ProjectRuntime();
    runtime.upsertWorktree({ worktreeId: "wt-1", branch: "feat", path: "/tmp/wt" });
    const claude = new FakeClaudeCliGateway();
    const stream = new ClaudeConversationStreamService({ claude });

    // The same wiring the server uses in sendClaudeStreamingMessage: drive the
    // worktree lifecycle from the owned claude -p run instead of the lossy hook.
    const setLifecycle = (lifecycle: "running" | "stopped"): void => {
      runtime.applyEvent({ type: "agent_status_changed", worktreeId: "wt-1", branch: "feat", lifecycle });
    };
    const status = (): string => runtime.getWorktree("wt-1")!.agent.lifecycle;

    // Web message #1: server starts the owned claude -p run and marks it running.
    expect(stream.startRun({
      conversationId: "session-1",
      turnId: "claude-turn:turn-1",
      cwd: "/tmp/wt",
      prompt: "first",
      sessionId: "session-1",
      onRunSettled: () => setLifecycle("stopped"),
    })).toEqual({ ok: true });
    setLifecycle("running");

    // While streaming, the worktree reads as busy — a 2nd web message is gated.
    expect(isBusy(status())).toBe(true);

    // The claude -p turn ends (stream result line) — the owned end-turn signal.
    claude.callbacks?.onComplete?.("session-1");

    // Lands on the finished state (maps to "done" in the UI, same as a terminal
    // turn finishing) so the next web message passes the busy gate.
    expect(status()).toBe("stopped");
    expect(isBusy(status())).toBe(false);
  });
});
