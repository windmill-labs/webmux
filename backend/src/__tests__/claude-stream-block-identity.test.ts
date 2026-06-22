import { describe, expect, it } from "bun:test";
import {
  parseClaudeStreamLine,
  type ClaudeCliGateway,
  type ClaudeCliRunCallbacks,
  type ClaudeCliRunHandle,
} from "../adapters/claude-cli";
import type { AgentsUiConversationEvent } from "../domain/agents-ui";
import { AgentsConversationStreamSession } from "../services/agents-ui-stream-service";
import { ClaudeConversationStreamService } from "../services/claude-conversation-stream-service";

// These fixtures are abridged-but-faithful copies of real `claude -p --verbose
// --output-format stream-json --include-partial-messages` output, captured on
// 2026-06-19 against claude 2.1.170. The shape that matters:
//
//   * `content_block_delta.index` is scoped to the *current API message* and
//     RESETS to 0 at every `message_start`.
//   * A single user turn can contain MULTIPLE assistant API messages (one
//     before a tool call, one after the tool result), each with its own
//     `message.id` (msg_...).
//   * The full `assistant` record carries the SAME `message.id` as the
//     `message_start` event for that message.
//
// => `message.id` + content-block index is a deterministic, collision-free key
//    shared between the streaming deltas and the final message. The current
//    code keys live deltas by `claude-turn + index` only, so two text blocks
//    that share an index across two messages collapse into one container.

class FakeClaudeCliGateway implements Pick<ClaudeCliGateway, "sendMessage"> {
  callbacks: ClaudeCliRunCallbacks | null = null;

  sendMessage(
    _params: Parameters<ClaudeCliGateway["sendMessage"]>[0],
    callbacks: ClaudeCliRunCallbacks,
  ): ClaudeCliRunHandle {
    this.callbacks = callbacks;
    return {
      completion: Promise.resolve(),
      interrupt: () => {},
      sessionId: Promise.resolve("session-1"),
    };
  }
}

interface Cursor {
  messageId: string | null;
  blockIndex: number;
}

// Mirrors ClaudeCliClient.handleStreamLine + toStreamMessage: parse one raw
// line, advance the message/block cursor, and stamp the stable id the
// production adapter would before fanning out to the run callbacks.
function replayLine(line: string, callbacks: ClaudeCliRunCallbacks, cursor: Cursor): void {
  const parsed = parseClaudeStreamLine(line);
  if (!parsed) return;
  if (parsed.messageStart) cursor.messageId = parsed.messageStart.messageId;
  if (parsed.blockStart) cursor.blockIndex = parsed.blockStart.index;
  if (parsed.assistantDelta) {
    callbacks.onAssistantDelta?.(parsed.assistantDelta.delta, {
      itemId: `${cursor.messageId ?? "msg"}:${parsed.assistantDelta.blockIndex}`,
    });
  }
  for (const block of parsed.blocks) {
    const id = block.kind === "toolResult"
      ? `tool_result:${block.toolCallId ?? `${cursor.messageId ?? "msg"}:${cursor.blockIndex}`}`
      : `${block.messageId ?? cursor.messageId ?? "msg"}:${cursor.blockIndex}`;
    callbacks.onMessage?.({
      id,
      role: block.role,
      kind: block.kind,
      text: block.text,
      createdAt: block.createdAt,
      ...(block.toolName ? { toolName: block.toolName } : {}),
      ...(block.toolCallId ? { toolCallId: block.toolCallId } : {}),
    });
  }
  if (parsed.completeSessionId) callbacks.onComplete?.(parsed.completeSessionId);
  if (parsed.error) callbacks.onError?.(parsed.error);
}

// A turn with two assistant API messages, each emitting a TEXT block at content
// index 0 (this happens whenever extended thinking is off, or whenever the
// model thinks before each step so text lands at the same index in both
// messages). msgA says one thing, calls a tool, then msgB answers.
const TWO_MESSAGE_TURN: string[] = [
  // ---- assistant message A: text@0, tool_use@1 ----
  JSON.stringify({ type: "stream_event", session_id: "session-1", event: { type: "message_start", message: { id: "msg_AAA", role: "assistant" } } }),
  JSON.stringify({ type: "stream_event", session_id: "session-1", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } }),
  JSON.stringify({ type: "stream_event", session_id: "session-1", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Let me read that file." } } }),
  JSON.stringify({ type: "assistant", session_id: "session-1", uuid: "rec-A-text", message: { id: "msg_AAA", role: "assistant", content: [{ type: "text", text: "Let me read that file." }] } }),
  JSON.stringify({ type: "stream_event", session_id: "session-1", event: { type: "content_block_stop", index: 0 } }),
  JSON.stringify({ type: "stream_event", session_id: "session-1", event: { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_1", name: "Read", input: {} } } }),
  JSON.stringify({ type: "assistant", session_id: "session-1", uuid: "rec-A-tool", message: { id: "msg_AAA", role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "Read", input: { file_path: "/tmp/alpha.txt" } }] } }),
  JSON.stringify({ type: "stream_event", session_id: "session-1", event: { type: "content_block_stop", index: 1 } }),
  JSON.stringify({ type: "stream_event", session_id: "session-1", event: { type: "message_delta", delta: { stop_reason: "tool_use" } } }),
  // ---- tool result ----
  JSON.stringify({ type: "user", session_id: "session-1", uuid: "rec-toolresult", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "hello from alpha" }] } }),
  JSON.stringify({ type: "stream_event", session_id: "session-1", event: { type: "message_stop" } }),
  // ---- assistant message B: text@0 (index RESETS) ----
  JSON.stringify({ type: "stream_event", session_id: "session-1", event: { type: "message_start", message: { id: "msg_BBB", role: "assistant" } } }),
  JSON.stringify({ type: "stream_event", session_id: "session-1", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } }),
  JSON.stringify({ type: "stream_event", session_id: "session-1", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "The file says hello." } } }),
  JSON.stringify({ type: "assistant", session_id: "session-1", uuid: "rec-B-text", message: { id: "msg_BBB", role: "assistant", content: [{ type: "text", text: "The file says hello." }] } }),
  JSON.stringify({ type: "stream_event", session_id: "session-1", event: { type: "content_block_stop", index: 0 } }),
  JSON.stringify({ type: "stream_event", session_id: "session-1", event: { type: "message_delta", delta: { stop_reason: "end_turn" } } }),
  JSON.stringify({ type: "stream_event", session_id: "session-1", event: { type: "message_stop" } }),
  JSON.stringify({ type: "result", session_id: "session-1", is_error: false, result: "done" }),
];

// Reconstruct the visible assistant text containers the way the live UI does:
// `messageDelta` events append to their itemId, `messageUpsert` events set the
// text for their message id. (This mirrors frontend applyConversationMessage*.)
function collectAssistantTextsByItem(events: AgentsUiConversationEvent[]): Map<string, string> {
  const byId = new Map<string, string>();
  for (const event of events) {
    if (event.type === "messageDelta") {
      byId.set(event.itemId, `${byId.get(event.itemId) ?? ""}${event.delta}`);
      continue;
    }
    if (event.type === "messageUpsert" && event.message.role === "assistant" && event.message.kind === "text") {
      byId.set(event.message.id, event.message.text);
    }
  }
  return byId;
}

describe("Claude stream block identity (investigation)", () => {
  it("the parser surfaces message.id so two same-index text blocks can be told apart", () => {
    const starts = TWO_MESSAGE_TURN
      .map(parseClaudeStreamLine)
      .filter((p): p is NonNullable<typeof p> => p !== null);
    // The delta path only knows about blockIndex today — both text blocks
    // report index 0, with no message id attached. That is the information
    // loss at the root of the bug.
    const deltaIndexes = starts.flatMap((p) => p.assistantDelta ? [p.assistantDelta.blockIndex] : []);
    expect(deltaIndexes).toEqual([0, 0]);
  });

  it("keeps the two assistant text blocks in two separate containers (full stream)", () => {
    const texts = runTurn(TWO_MESSAGE_TURN);
    // Both distinct assistant sentences must survive as their own messages.
    expect(texts).toContain("Let me read that file.");
    expect(texts).toContain("The file says hello.");
    // And critically, neither container may contain BOTH sentences concatenated.
    for (const text of texts) {
      expect(text.includes("Let me read that file.") && text.includes("The file says hello.")).toBe(false);
    }
  });

  // The live-streaming path must be self-sufficient: identity has to come from
  // the delta stream itself (message.id + index), NOT from the full `assistant`
  // records happening to arrive in just the right order to "rename" the live
  // item before the next same-index block reuses its slot. This replays ONLY the
  // streaming-delta lines — exactly what drives the live UI before any full
  // record lands. Today both index-0 text blocks collapse into one container.
  it("keeps the two text blocks separate from the delta stream alone", () => {
    const deltaOnly = TWO_MESSAGE_TURN.filter((line) => {
      const parsed = JSON.parse(line) as { type?: string };
      return parsed.type === "stream_event";
    });
    const texts = runTurn(deltaOnly);

    const merged = texts.filter(
      (text) => text.includes("Let me read that file.") && text.includes("The file says hello."),
    );
    expect(merged).toEqual([]);
  });
});

function runTurn(lines: string[]): string[] {
  const gateway = new FakeClaudeCliGateway();
  const service = new ClaudeConversationStreamService({ claude: gateway });
  const events: AgentsUiConversationEvent[] = [];
  const session = new AgentsConversationStreamSession({
    conversationId: "session-1",
    nextOrder: 0,
    send: (event) => events.push(event),
  });
  service.subscribe("session-1", session);

  service.startRun({
    conversationId: "session-1",
    turnId: "claude-turn:turn-1",
    cwd: "/tmp/work",
    prompt: "Read alpha.txt and tell me what it says.",
    sessionId: "session-1",
  });

  const cursor: Cursor = { messageId: null, blockIndex: 0 };
  for (const line of lines) {
    replayLine(line, gateway.callbacks!, cursor);
  }

  return [...collectAssistantTextsByItem(events).values()];
}
