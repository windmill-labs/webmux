import { describe, expect, it } from "bun:test";
import type { CodexAppServerThread } from "../adapters/codex-app-server";
import { readCodexSessionMessages } from "../services/codex-session-log-service";

function makeThread(path: string | null): CodexAppServerThread {
  return {
    id: "thread-1",
    forkedFromId: null,
    preview: "",
    ephemeral: false,
    modelProvider: "openai",
    createdAt: 100,
    updatedAt: 200,
    status: { type: "idle" },
    path,
    cwd: "/tmp/worktree",
    cliVersion: "0.134.0",
    source: "vscode",
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns: [],
  };
}

describe("codex-session-log-service", () => {
  it("extracts reasoning summaries and persisted tool calls from Codex JSONL", async () => {
    const path = `/tmp/webmux-codex-session-${crypto.randomUUID()}.jsonl`;
    await Bun.write(path, [
      JSON.stringify({
        timestamp: "2026-05-28T10:00:00.000Z",
        type: "event_msg",
        payload: { type: "task_started", turn_id: "turn-1" },
      }),
      JSON.stringify({
        timestamp: "2026-05-28T10:00:01.000Z",
        type: "response_item",
        payload: {
          type: "reasoning",
          summary: [{ text: "Need inspect files first." }],
          encrypted_content: "hidden",
        },
      }),
      JSON.stringify({
        timestamp: "2026-05-28T10:00:02.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          phase: "commentary",
          content: [{ type: "output_text", text: "I will list the directory." }],
        },
      }),
      JSON.stringify({
        timestamp: "2026-05-28T10:00:03.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          arguments: JSON.stringify({ cmd: "test -f /tmp/nope", workdir: "/tmp/worktree" }),
          call_id: "call-1",
        },
      }),
      JSON.stringify({
        timestamp: "2026-05-28T10:00:04.000Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call-1",
          output: "Chunk ID: abc\nWall time: 0.0000 seconds\nProcess exited with code 1\nOriginal token count: 0\nOutput:\n",
        },
      }),
      JSON.stringify({
        timestamp: "2026-05-28T10:00:05.000Z",
        type: "response_item",
        payload: {
          type: "custom_tool_call",
          status: "completed",
          name: "apply_patch",
          input: "*** Begin Patch\n*** Update File: missing.ts\n@@\n*** End Patch\n",
          call_id: "call-2",
        },
      }),
      JSON.stringify({
        timestamp: "2026-05-28T10:00:06.000Z",
        type: "response_item",
        payload: {
          type: "custom_tool_call_output",
          call_id: "call-2",
          output: "apply_patch verification failed: Failed to find expected lines in missing.ts",
        },
      }),
      JSON.stringify({
        timestamp: "2026-05-28T10:00:07.000Z",
        type: "event_msg",
        payload: { type: "task_complete", turn_id: "turn-1" },
      }),
    ].join("\n"));

    expect(await readCodexSessionMessages(makeThread(path))).toEqual([
      {
        id: "reasoning:turn-1:0",
        turnId: "turn-1",
        role: "assistant",
        kind: "thinking",
        phase: "analysis",
        text: "Need inspect files first.",
        status: "completed",
        createdAt: "2026-05-28T10:00:01.000Z",
      },
      {
        id: "call-1",
        turnId: "turn-1",
        role: "assistant",
        kind: "toolUse",
        toolName: "exec_command",
        toolCallId: "call-1",
        text: "test -f /tmp/nope",
        command: "test -f /tmp/nope",
        cwd: "/tmp/worktree",
        status: "failed",
        createdAt: "2026-05-28T10:00:03.000Z",
        exitCode: 1,
      },
      {
        id: "call-1:result",
        turnId: "turn-1",
        role: "user",
        kind: "toolResult",
        toolName: "exec_command",
        toolCallId: "call-1",
        text: "Chunk ID: abc\nWall time: 0.0000 seconds\nProcess exited with code 1\nOriginal token count: 0\nOutput:",
        command: "test -f /tmp/nope",
        cwd: "/tmp/worktree",
        status: "failed",
        createdAt: "2026-05-28T10:00:04.000Z",
        exitCode: 1,
      },
      {
        id: "call-2",
        turnId: "turn-1",
        role: "assistant",
        kind: "toolUse",
        toolName: "apply_patch",
        toolCallId: "call-2",
        text: "apply_patch",
        command: "apply_patch",
        status: "failed",
        createdAt: "2026-05-28T10:00:05.000Z",
        exitCode: null,
      },
      {
        id: "call-2:result",
        turnId: "turn-1",
        role: "user",
        kind: "toolResult",
        toolName: "apply_patch",
        toolCallId: "call-2",
        text: "apply_patch verification failed: Failed to find expected lines in missing.ts",
        command: "apply_patch",
        status: "failed",
        createdAt: "2026-05-28T10:00:06.000Z",
        exitCode: null,
      },
    ]);
  });
});
