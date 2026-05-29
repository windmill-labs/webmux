import { describe, expect, it } from "bun:test";
import { parseCodexSessionMessages } from "../services/codex-session-log-service";

function line(timestamp: string, type: string, payload: Record<string, unknown>): string {
  return JSON.stringify({ timestamp, type, payload });
}

describe("codex-session-log-service", () => {
  it("parses visible JSONL transcript messages and tool calls in log order", () => {
    const text = [
      line("2026-05-29T10:00:00.000Z", "event_msg", {
        type: "task_started",
        turn_id: "turn-1",
      }),
      line("2026-05-29T10:00:01.000Z", "event_msg", {
        type: "user_message",
        message: "Inspect the repo",
      }),
      line("2026-05-29T10:00:02.000Z", "event_msg", {
        type: "user_message",
        message: "Inspect the repo",
      }),
      line("2026-05-29T10:00:03.000Z", "event_msg", {
        type: "agent_message",
        phase: "commentary",
        message: "I will list files.",
      }),
      line("2026-05-29T10:00:04.000Z", "response_item", {
        type: "function_call",
        name: "exec_command",
        call_id: "call-1",
        arguments: JSON.stringify({
          cmd: "ls",
          workdir: "/tmp/worktree",
        }),
      }),
      line("2026-05-29T10:00:05.000Z", "response_item", {
        type: "function_call_output",
        call_id: "call-1",
        output: "README.md\nProcess exited with code 0\n",
      }),
      line("2026-05-29T10:00:06.000Z", "event_msg", {
        type: "agent_message",
        phase: "final_answer",
        message: "Done.",
      }),
      line("2026-05-29T10:00:07.000Z", "event_msg", {
        type: "task_complete",
        turn_id: "turn-1",
      }),
    ].join("\n");

    expect(parseCodexSessionMessages(text)).toEqual([
      {
        id: "user:turn-1:0",
        turnId: "turn-1",
        order: 0,
        role: "user",
        kind: "text",
        text: "Inspect the repo",
        status: "completed",
        createdAt: "2026-05-29T10:00:01.000Z",
      },
      {
        id: "assistant:turn-1:1",
        turnId: "turn-1",
        order: 1,
        role: "assistant",
        kind: "text",
        phase: "commentary",
        text: "I will list files.",
        status: "completed",
        createdAt: "2026-05-29T10:00:03.000Z",
      },
      {
        id: "call-1",
        turnId: "turn-1",
        order: 2,
        role: "assistant",
        kind: "toolUse",
        toolName: "exec_command",
        toolCallId: "call-1",
        text: "ls",
        command: "ls",
        cwd: "/tmp/worktree",
        status: "completed",
        createdAt: "2026-05-29T10:00:04.000Z",
        exitCode: 0,
      },
      {
        id: "call-1:result",
        turnId: "turn-1",
        order: 3,
        role: "user",
        kind: "toolResult",
        toolName: "exec_command",
        toolCallId: "call-1",
        text: "README.md\nProcess exited with code 0",
        command: "ls",
        cwd: "/tmp/worktree",
        status: "completed",
        createdAt: "2026-05-29T10:00:05.000Z",
        exitCode: 0,
      },
      {
        id: "assistant:turn-1:4",
        turnId: "turn-1",
        order: 4,
        role: "assistant",
        kind: "text",
        phase: "final_answer",
        text: "Done.",
        status: "completed",
        createdAt: "2026-05-29T10:00:06.000Z",
      },
    ]);
  });
});
