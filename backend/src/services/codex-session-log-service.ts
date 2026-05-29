import type { CodexAppServerThread } from "../adapters/codex-app-server";
import type { AgentsUiConversationMessage } from "../domain/agents-ui";
import { isRecord } from "../lib/type-guards";

const TOOL_OUTPUT_TRUNCATE_LIMIT = 12000;

interface ParsedLogRecord {
  timestamp: string | null;
  type: string | null;
  payload: Record<string, unknown> | null;
}

interface ToolCallMetadata {
  toolName: string;
  command?: string;
  cwd?: string;
}

function readString(raw: unknown): string | null {
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

function parseLogLine(line: string): ParsedLogRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) return null;
  return {
    timestamp: readString(parsed.timestamp),
    type: readString(parsed.type),
    payload: isRecord(parsed.payload) ? parsed.payload : null,
  };
}

function truncate(text: string, limit = TOOL_OUTPUT_TRUNCATE_LIMIT): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}... (truncated, ${text.length - limit} more chars)`;
}

function compactJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function readReasoningSummary(raw: unknown): string {
  if (!Array.isArray(raw)) return "";
  return raw
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (!isRecord(entry)) return "";
      if (typeof entry.text === "string") return entry.text;
      if (typeof entry.summary === "string") return entry.summary;
      return "";
    })
    .filter((text) => text.trim().length > 0)
    .join("\n")
    .trim();
}

function parseArgumentsRecord(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isRecord(parsed) ? parsed : null;
}

function readToolCommand(toolName: string, argumentsText: string | null): string | null {
  if (toolName === "apply_patch") return "apply_patch";
  const args = parseArgumentsRecord(argumentsText);
  if (!args) return null;
  if (toolName === "exec_command" && typeof args.cmd === "string") return args.cmd;
  return null;
}

function readToolCwd(argumentsText: string | null): string | null {
  const args = parseArgumentsRecord(argumentsText);
  if (!args) return null;
  return typeof args.workdir === "string" ? args.workdir : null;
}

function buildToolUseText(toolName: string, argumentsText: string | null): string {
  const command = readToolCommand(toolName, argumentsText);
  if (command) return command;
  return argumentsText?.trim() ?? "";
}

function readOutputExitCode(output: string): number | null {
  const processMatch = output.match(/Process exited with code (-?\d+)/);
  if (processMatch?.[1]) return Number(processMatch[1]);

  const exitMatch = output.match(/^Exit code: (-?\d+)/m);
  if (exitMatch?.[1]) return Number(exitMatch[1]);

  return null;
}

function readOutputStatus(output: string): AgentsUiConversationMessage["status"] {
  const exitCode = readOutputExitCode(output);
  if (exitCode !== null) return exitCode === 0 ? "completed" : "failed";
  return output.startsWith("apply_patch verification failed") ? "failed" : "completed";
}

function pushMessage(
  messages: AgentsUiConversationMessage[],
  message: Omit<AgentsUiConversationMessage, "order">,
): void {
  messages.push({
    ...message,
    order: messages.length,
  });
}

function hasDuplicateTextMessage(input: {
  messages: AgentsUiConversationMessage[];
  turnId: string;
  role: AgentsUiConversationMessage["role"];
  text: string;
  phase?: string;
}): boolean {
  return input.messages.some((message) =>
    message.turnId === input.turnId
    && message.role === input.role
    && message.kind === "text"
    && message.text === input.text
    && message.phase === input.phase
  );
}

function finalizeToolStatuses(messages: AgentsUiConversationMessage[]): AgentsUiConversationMessage[] {
  const resultByCallId = new Map<string, AgentsUiConversationMessage>();
  for (const message of messages) {
    if (message.kind === "toolResult" && message.toolCallId) {
      resultByCallId.set(message.toolCallId, message);
    }
  }

  return messages.map((message) => {
    if (message.kind !== "toolUse" || !message.toolCallId) return message;
    const result = resultByCallId.get(message.toolCallId);
    if (!result) return message;
    return {
      ...message,
      status: result.status,
      ...(result.exitCode !== undefined ? { exitCode: result.exitCode } : {}),
      ...(result.durationMs !== undefined ? { durationMs: result.durationMs } : {}),
    };
  });
}

export function parseCodexSessionMessages(text: string): AgentsUiConversationMessage[] {
  const messages: AgentsUiConversationMessage[] = [];
  const toolCallMetadata = new Map<string, ToolCallMetadata>();
  let currentTurnId: string | null = null;
  let blockIndex = 0;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    const record = parseLogLine(trimmed);
    if (!record?.payload) continue;

    if (record.type === "event_msg") {
      const eventType = readString(record.payload.type);
      if (eventType === "task_started") {
        currentTurnId = readString(record.payload.turn_id);
        blockIndex = 0;
        continue;
      }
      if (eventType === "task_complete" || eventType === "turn_aborted") {
        currentTurnId = null;
        continue;
      }
      if (eventType === "user_message" && currentTurnId) {
        const text = readString(record.payload.message);
        if (!text || hasDuplicateTextMessage({ messages, turnId: currentTurnId, role: "user", text })) continue;
        pushMessage(messages, {
          id: `user:${currentTurnId}:${blockIndex}`,
          turnId: currentTurnId,
          role: "user",
          kind: "text",
          text,
          status: "completed",
          createdAt: record.timestamp,
        });
        blockIndex += 1;
        continue;
      }
      if (eventType === "agent_message" && currentTurnId) {
        const text = readString(record.payload.message);
        if (!text) continue;
        const phase = readString(record.payload.phase) ?? undefined;
        if (hasDuplicateTextMessage({ messages, turnId: currentTurnId, role: "assistant", text, phase })) continue;
        pushMessage(messages, {
          id: `assistant:${currentTurnId}:${blockIndex}`,
          turnId: currentTurnId,
          role: "assistant",
          kind: phase === "analysis" ? "thinking" : "text",
          ...(phase ? { phase } : {}),
          text,
          status: "completed",
          createdAt: record.timestamp,
        });
        blockIndex += 1;
      }
      continue;
    }

    if (record.type !== "response_item" || !currentTurnId) continue;
    const payloadType = readString(record.payload.type);

    if (payloadType === "reasoning") {
      const summary = readReasoningSummary(record.payload.summary);
      if (summary.length === 0) continue;
      pushMessage(messages, {
        id: `reasoning:${currentTurnId}:${blockIndex}`,
        turnId: currentTurnId,
        role: "assistant",
        kind: "thinking",
        phase: "analysis",
        text: summary,
        status: "completed",
        createdAt: record.timestamp,
      });
      blockIndex += 1;
      continue;
    }

    if (payloadType === "function_call" || payloadType === "custom_tool_call") {
      const callId = readString(record.payload.call_id);
      if (!callId) continue;
      const toolName = readString(record.payload.name) ?? "tool";
      const argumentsText = payloadType === "custom_tool_call"
        ? typeof record.payload.input === "string" ? record.payload.input : compactJson(record.payload.input ?? {})
        : typeof record.payload.arguments === "string" ? record.payload.arguments : compactJson(record.payload.arguments ?? {});
      const command = readToolCommand(toolName, argumentsText);
      const cwd = payloadType === "custom_tool_call" ? null : readToolCwd(argumentsText);
      toolCallMetadata.set(callId, {
        toolName,
        ...(command ? { command } : {}),
        ...(cwd ? { cwd } : {}),
      });
      pushMessage(messages, {
        id: callId,
        turnId: currentTurnId,
        role: "assistant",
        kind: "toolUse",
        toolName,
        toolCallId: callId,
        text: payloadType === "custom_tool_call" ? toolName : buildToolUseText(toolName, argumentsText),
        ...(command ? { command } : {}),
        ...(cwd ? { cwd } : {}),
        status: record.payload.status === "failed" ? "failed" : "completed",
        createdAt: record.timestamp,
      });
      blockIndex += 1;
      continue;
    }

    if (payloadType === "function_call_output" || payloadType === "custom_tool_call_output") {
      const callId = readString(record.payload.call_id);
      if (!callId) continue;
      const metadata = toolCallMetadata.get(callId);
      const output = typeof record.payload.output === "string"
        ? record.payload.output.trimEnd()
        : compactJson(record.payload.output ?? "");
      const exitCode = readOutputExitCode(output);
      pushMessage(messages, {
        id: `${callId}:result`,
        turnId: currentTurnId,
        role: "user",
        kind: "toolResult",
        ...(metadata?.toolName ? { toolName: metadata.toolName } : {}),
        toolCallId: callId,
        text: truncate(output),
        ...(metadata?.command ? { command: metadata.command } : {}),
        ...(metadata?.cwd ? { cwd: metadata.cwd } : {}),
        status: readOutputStatus(output),
        createdAt: record.timestamp,
        exitCode,
      });
      blockIndex += 1;
    }
  }

  return finalizeToolStatuses(messages);
}

export async function readCodexSessionMessages(thread: CodexAppServerThread): Promise<AgentsUiConversationMessage[]> {
  if (!thread.path) return [];

  try {
    const file = Bun.file(thread.path);
    if (!await file.exists()) return [];
    return parseCodexSessionMessages(await file.text());
  } catch {
    return [];
  }
}
