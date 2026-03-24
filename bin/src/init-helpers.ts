import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectProjectName, run } from "./shared.ts";

export type InitAuthoringChoice = "claude" | "codex" | "manual";
export type InitAgent = Exclude<InitAuthoringChoice, "manual">;
export type InitPackageManager = "bun" | "npm" | "pnpm" | "yarn";

export interface InitProjectContext {
  gitRoot: string;
  projectName: string;
  mainBranch: string;
  defaultAgent: InitAgent;
  packageManager: InitPackageManager;
}

export interface InitPromptSpec {
  systemPrompt: string;
  userPrompt: string;
}

export interface InitAgentCommandSpec {
  agent: InitAgent;
  cmd: string;
  args: string[];
  summaryPath?: string;
}

export interface InitAgentStreamEvent {
  kind: "assistant_delta" | "assistant_done" | "status" | "warning";
  text: string;
}

export interface InitAgentRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  summary: string;
}

export interface InitAgentRunHandlers {
  onEvent?: (event: InitAgentStreamEvent) => void;
}

interface InitAgentStreamState {
  assistantSnapshot: string;
  lastStatus: string | null;
}

const FAST_CLAUDE_MODEL = "haiku";
const FAST_CLAUDE_EFFORT = "low";
const FAST_CODEX_MODEL = "gpt-5.1-codex";
const FAST_CODEX_REASONING = "low";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function detectPackageManager(gitRoot: string): InitPackageManager {
  if (existsSync(join(gitRoot, "bun.lock")) || existsSync(join(gitRoot, "bun.lockb"))) return "bun";
  if (existsSync(join(gitRoot, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(gitRoot, "yarn.lock"))) return "yarn";
  return "npm";
}

function detectMainBranch(gitRoot: string): string {
  const originHead = run("git", ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], { cwd: gitRoot });
  if (originHead.success) {
    const branch = originHead.stdout.toString().trim().split("/").pop();
    if (branch) return branch;
  }

  const mainBranch = run("git", ["branch", "--list", "main"], { cwd: gitRoot });
  if (mainBranch.success && mainBranch.stdout.toString().trim()) return "main";

  const masterBranch = run("git", ["branch", "--list", "master"], { cwd: gitRoot });
  if (masterBranch.success && masterBranch.stdout.toString().trim()) return "master";

  const currentBranch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: gitRoot });
  if (currentBranch.success) {
    const branch = currentBranch.stdout.toString().trim();
    if (branch && branch !== "HEAD") return branch;
  }

  return "main";
}

function buildRunScriptCommand(packageManager: InitPackageManager, scriptName: "dev" | "start"): string {
  if (packageManager === "bun") return `bun run ${scriptName}`;
  if (packageManager === "pnpm") return `pnpm ${scriptName}`;
  if (packageManager === "yarn") return `yarn ${scriptName}`;
  return `npm run ${scriptName}`;
}

export function detectInitProjectContext(gitRoot: string, defaultAgent: InitAgent): InitProjectContext {
  return {
    gitRoot,
    projectName: detectProjectName(gitRoot),
    mainBranch: detectMainBranch(gitRoot),
    defaultAgent,
    packageManager: detectPackageManager(gitRoot),
  };
}

export function buildInitPromptSpec(context: InitProjectContext): InitPromptSpec {
  const systemPrompt = [
    "You are bootstrapping a local repository for webmux.",
    "A starter `.webmux.yaml` already exists at the repo root.",
    "Inspect the repository in the current working directory and edit that existing `.webmux.yaml` in place.",
    "Do not modify any other file.",
    "Do not ask the user questions. Infer the config from the repository contents.",
    "Be efficient: inspect only the files needed to determine the project name, main branch, service layout, dev commands, and ports.",
    "The YAML must be valid and minimal.",
    `Set workspace.defaultAgent to ${context.defaultAgent}.`,
    "Use this config shape:",
    "name: infer from the repository",
    "workspace.mainBranch: infer from git",
    "workspace.worktreeRoot: keep ../worktrees unless there is clear evidence of an existing alternative",
    "services: one entry per real dev service with name, portEnv, and portStart when a default port is clear",
    "profiles.default.runtime: host",
    "profiles.default.envPassthrough: []",
    "profiles.default.panes: start with an agent pane focused true, then add command panes for real services",
    "Command panes should use the repository's real dev command and pass the relevant port env var into the command when needed.",
    "Use split: right for the first command pane and split: bottom for later command panes.",
    "Include integrations.github.linkedRepos as an empty list, integrations.linear.enabled as true, and startupEnvs as an empty object.",
    "Only include optional sections like auto_name, lifecycleHooks, sandbox/docker config, mounts, or systemPrompt if the repository gives clear evidence they are needed.",
    "Prefer editing the existing keys over replacing the file with a completely different shape.",
    "Before finishing, verify that `.webmux.yaml` exists and contains the final YAML.",
  ].join("\n");

  return {
    systemPrompt,
    userPrompt: "Adapt the existing starter `.webmux.yaml` for this repository.",
  };
}

export function buildInitAgentCommand(
  agent: InitAgent,
  prompt: InitPromptSpec,
  outputPrefix = "webmux-init",
): InitAgentCommandSpec {
  if (agent === "claude") {
    return {
      agent,
      cmd: "claude",
      args: [
        "-p",
        "--verbose",
        "--permission-mode",
        "bypassPermissions",
        "--model",
        FAST_CLAUDE_MODEL,
        "--effort",
        FAST_CLAUDE_EFFORT,
        "--output-format",
        "stream-json",
        "--include-partial-messages",
        "--append-system-prompt",
        prompt.systemPrompt,
        prompt.userPrompt,
      ],
    };
  }

  const summaryPath = join(tmpdir(), `${outputPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`);
  return {
    agent,
    cmd: "codex",
    args: [
      "exec",
      "--sandbox",
      "workspace-write",
      "--color",
      "never",
      "--json",
      "-m",
      FAST_CODEX_MODEL,
      "-o",
      summaryPath,
      "-c",
      `model_reasoning_effort="${FAST_CODEX_REASONING}"`,
      "-c",
      `developer_instructions=${prompt.systemPrompt}`,
      prompt.userPrompt,
    ],
    summaryPath,
  };
}

function closeAssistant(state: InitAgentStreamState): InitAgentStreamEvent[] {
  if (!state.assistantSnapshot) return [];
  state.assistantSnapshot = "";
  return [{ kind: "assistant_done", text: "" }];
}

function streamSnapshot(
  state: InitAgentStreamState,
  snapshot: string,
): InitAgentStreamEvent[] {
  if (!snapshot) return [];

  if (!state.assistantSnapshot) {
    state.assistantSnapshot = snapshot;
    return [{ kind: "assistant_delta", text: snapshot }];
  }

  if (snapshot === state.assistantSnapshot) return [];

  if (snapshot.startsWith(state.assistantSnapshot)) {
    const delta = snapshot.slice(state.assistantSnapshot.length);
    state.assistantSnapshot = snapshot;
    return delta ? [{ kind: "assistant_delta", text: delta }] : [];
  }

  state.assistantSnapshot = snapshot;
  return [
    { kind: "assistant_done", text: "" },
    { kind: "assistant_delta", text: snapshot },
  ];
}

function emitStatus(state: InitAgentStreamState, text: string | null): InitAgentStreamEvent[] {
  const status = text?.trim();
  if (!status || status === state.lastStatus) return [];
  state.lastStatus = status;
  return [...closeAssistant(state), { kind: "status", text: status }];
}

function emitWarning(state: InitAgentStreamState, text: string | null): InitAgentStreamEvent[] {
  const warning = text?.trim();
  if (!warning) return [];
  return [...closeAssistant(state), { kind: "warning", text: warning }];
}

function extractTextBlocks(value: unknown): string {
  if (typeof value === "string") return value;

  if (Array.isArray(value)) {
    return value.map((entry) => extractTextBlocks(entry)).filter((entry) => entry.length > 0).join("");
  }

  if (!isRecord(value)) return "";

  if (value.type === "text" && typeof value.text === "string") {
    return value.text;
  }

  if (typeof value.output_text === "string") return value.output_text;
  if (typeof value.text === "string") return value.text;
  if (typeof value.delta === "string") return value.delta;
  if (Array.isArray(value.content)) return extractTextBlocks(value.content);
  if (Array.isArray(value.contents)) return extractTextBlocks(value.contents);
  if (Array.isArray(value.parts)) return extractTextBlocks(value.parts);
  if (Array.isArray(value.output)) return extractTextBlocks(value.output);

  return "";
}

function extractCommandText(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
    return value.join(" ").trim() || null;
  }
  return null;
}

function truncateText(text: string, limit = 120): string {
  return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
}

function extractStructuredMessage(raw: Record<string, unknown>): string | null {
  const candidates: unknown[] = [
    raw.message,
    raw.result,
    raw.item,
    raw.output,
    raw.content,
    raw.text,
    raw.response,
  ];

  for (const candidate of candidates) {
    const text = extractTextBlocks(candidate).trim();
    if (text) return text;
  }

  return null;
}

function parseClaudeStreamLine(
  raw: Record<string, unknown>,
  state: InitAgentStreamState,
): InitAgentStreamEvent[] {
  const type = readString(raw.type) ?? "unknown";

  if (type === "content_block_delta" && isRecord(raw.delta)) {
    if (raw.delta.type === "text_delta" && typeof raw.delta.text === "string") {
      return [{ kind: "assistant_delta", text: raw.delta.text }];
    }
    if (typeof raw.delta.text === "string") {
      return [{ kind: "assistant_delta", text: raw.delta.text }];
    }
  }

  if (type === "content_block_start" && isRecord(raw.content_block)) {
    if (raw.content_block.type === "tool_use") {
      return emitStatus(state, `Using ${readString(raw.content_block.name) ?? "tool"}...`);
    }

    const snapshot = extractTextBlocks(raw.content_block).trim();
    return streamSnapshot(state, snapshot);
  }

  if (type === "message_stop" || type === "result_stop" || type === "content_block_stop") {
    return closeAssistant(state);
  }

  if (type === "error") {
    const message = isRecord(raw.error) ? readString(raw.error.message) : readString(raw.message);
    return emitWarning(state, message ?? "Claude returned an error.");
  }

  if (type.includes("tool")) {
    const toolName = readString(raw.tool_name)
      ?? (isRecord(raw.tool) ? readString(raw.tool.name) : null)
      ?? readString(raw.name);
    if (toolName) return emitStatus(state, `Using ${toolName}...`);
  }

  const snapshot = extractStructuredMessage(raw);
  if (snapshot) return streamSnapshot(state, snapshot);

  return [];
}

function parseCodexStatus(raw: Record<string, unknown>, type: string): string | null {
  const command = extractCommandText(raw.command)
    ?? (isRecord(raw.item) ? extractCommandText(raw.item.command) : null);
  if (command && (type.includes("command") || type.includes("exec") || type.includes("shell"))) {
    return `Running ${truncateText(command)}`;
  }

  const toolName = readString(raw.tool_name)
    ?? readString(raw.name)
    ?? (isRecord(raw.item) ? readString(raw.item.name) : null);
  if (toolName && (type.includes("tool") || type.includes("function"))) {
    return `Using ${toolName}...`;
  }

  const status = readString(raw.status);
  if (status && !["completed", "done", "finished"].includes(status)) {
    return truncateText(status);
  }

  if (type.includes("turn")) return "Thinking...";
  return null;
}

function parseCodexStreamLine(
  raw: Record<string, unknown>,
  state: InitAgentStreamState,
): InitAgentStreamEvent[] {
  const type = readString(raw.type) ?? readString(raw.event) ?? "unknown";

  if (type === "response.output_text.delta" && typeof raw.delta === "string") {
    return [{ kind: "assistant_delta", text: raw.delta }];
  }

  if (type === "response.output_text.done") {
    const text = readString(raw.text) ?? extractTextBlocks(raw.item).trim();
    return [...(text ? streamSnapshot(state, text) : []), ...closeAssistant(state)];
  }

  if (type.includes("error")) {
    const message = isRecord(raw.error) ? readString(raw.error.message) : readString(raw.message);
    return emitWarning(state, message ?? "Codex returned an error.");
  }

  const status = parseCodexStatus(raw, type);
  if (status) return emitStatus(state, status);

  if (type.includes("delta") && typeof raw.delta === "string") {
    return [{ kind: "assistant_delta", text: raw.delta }];
  }

  const snapshot = extractStructuredMessage(raw);
  if (snapshot && (type.includes("assistant") || type.includes("message") || type.includes("output") || type.includes("response"))) {
    const events = streamSnapshot(state, snapshot);
    if (type.includes("done") || type.includes("completed") || type.includes("finished")) {
      events.push(...closeAssistant(state));
    }
    return events;
  }

  if (type.includes("done") || type.includes("completed") || type.includes("finished")) {
    return closeAssistant(state);
  }

  return [];
}

export function parseInitAgentStreamLine(
  agent: InitAgent,
  line: string,
  state: InitAgentStreamState = { assistantSnapshot: "", lastStatus: null },
): InitAgentStreamEvent[] {
  const trimmed = line.trim();
  if (!trimmed) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }

  if (!isRecord(parsed)) return [];
  return agent === "claude" ? parseClaudeStreamLine(parsed, state) : parseCodexStreamLine(parsed, state);
}

async function consumeStructuredStream(
  stream: ReadableStream<Uint8Array> | null,
  agent: InitAgent,
  onEvent?: (event: InitAgentStreamEvent) => void,
): Promise<{ raw: string; assistantText: string }> {
  if (!stream) return { raw: "", assistantText: "" };

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const state: InitAgentStreamState = { assistantSnapshot: "", lastStatus: null };
  let buffer = "";
  let raw = "";
  let assistantText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const text = decoder.decode(value, { stream: true });
    raw += text;
    buffer += text;

    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
      buffer = buffer.slice(newlineIndex + 1);
      for (const event of parseInitAgentStreamLine(agent, line, state)) {
        if (event.kind === "assistant_delta") assistantText += event.text;
        onEvent?.(event);
      }
      newlineIndex = buffer.indexOf("\n");
    }
  }

  const tail = decoder.decode();
  raw += tail;
  buffer += tail;

  const finalLine = buffer.replace(/\r$/, "");
  if (finalLine) {
    for (const event of parseInitAgentStreamLine(agent, finalLine, state)) {
      if (event.kind === "assistant_delta") assistantText += event.text;
      onEvent?.(event);
    }
  }

  for (const event of closeAssistant(state)) {
    onEvent?.(event);
  }

  return { raw, assistantText };
}

async function consumeRawStream(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return "";

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let raw = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    raw += decoder.decode(value, { stream: true });
  }

  return raw + decoder.decode();
}

export async function runInitAgentCommand(
  spec: InitAgentCommandSpec,
  cwd: string,
  handlers: InitAgentRunHandlers = {},
): Promise<InitAgentRunResult> {
  const proc = Bun.spawn([spec.cmd, ...spec.args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [exitCode, stdoutResult, stderr] = await Promise.all([
    proc.exited,
    consumeStructuredStream(proc.stdout, spec.agent, handlers.onEvent),
    consumeRawStream(proc.stderr),
  ]);

  let summary = stdoutResult.assistantText.trim();
  if (spec.summaryPath && existsSync(spec.summaryPath)) {
    try {
      summary = readFileSync(spec.summaryPath, "utf8").trim() || summary;
    } finally {
      rmSync(spec.summaryPath, { force: true });
    }
  }

  return { exitCode, stdout: stdoutResult.raw, stderr, summary };
}

export function buildStarterTemplate(input: {
  projectName: string;
  mainBranch: string;
  defaultAgent?: InitAgent;
  packageManager?: InitPackageManager;
}): string {
  const defaultAgent = input.defaultAgent ?? "claude";
  const packageManager = input.packageManager ?? "npm";
  const devCommand = buildRunScriptCommand(packageManager, "dev");

  return `# Starter config for webmux.
# Keep the active keys below as a minimal working setup, then uncomment
# the examples to enable more services, profiles, integrations, or hooks.

# Project display name in the dashboard
name: ${input.projectName}

workspace:
  # Base branch used when creating new worktrees
  mainBranch: ${input.mainBranch}
  # Relative or absolute directory for managed worktrees
  worktreeRoot: ../worktrees
  # Default agent for new worktrees
  defaultAgent: ${defaultAgent}
  # autoPull:
  #   enabled: false
  #   intervalSeconds: 300

# Each service defines a port env var that webmux injects into panes and
# lifecycle hooks. Ports are auto-assigned as: portStart + (slot x portStep).
services:
  # - name: app
  #   portEnv: PORT
  #   portStart: 3000
  #   portStep: 10
  #   urlTemplate: http://localhost:\${PORT}

profiles:
  default:
    runtime: host
    envPassthrough:
      # - ANTHROPIC_API_KEY
      # - OPENAI_API_KEY
    # systemPrompt: >
    #   You are working in \${WEBMUX_WORKTREE_PATH}
    # yolo: true
    panes:
      - id: agent
        kind: agent
        focus: true
        # split: right
        # sizePct: 50
        # cwd: worktree
      # - id: app
      #   kind: command
      #   split: right
      #   sizePct: 50
      #   cwd: worktree
      #   workingDir: frontend
      #   command: PORT=$PORT ${devCommand}
      # - id: shell
      #   kind: shell
      #   split: bottom
      #   sizePct: 30
      #   cwd: repo

  # sandbox:
  #   runtime: docker
  #   image: ghcr.io/your-org/your-image:latest
  #   envPassthrough:
  #     - ANTHROPIC_API_KEY
  #     - OPENAI_API_KEY
  #   systemPrompt: >
  #     Extra instructions for the sandbox profile.
  #   yolo: true
  #   mounts:
  #     - hostPath: ~/.codex
  #       guestPath: /root/.codex
  #       writable: true
  #   panes:
  #     - id: agent
  #       kind: agent
  #       focus: true
  #     - id: shell
  #       kind: shell
  #       split: right
  #       cwd: repo

integrations:
  github:
    linkedRepos:
      # - repo: your-org/your-repo
      #   alias: repo
      #   dir: ../your-repo
    # autoRemoveOnMerge: true
  linear:
    enabled: true
    # autoCreateWorktrees: true
    # createTicketOption: true
    # teamId: team-123

# startupEnvs are added to the managed worktree runtime environment.
startupEnvs:
  # FEATURE_FLAG: true
  # API_BASE_URL: http://localhost:\${PORT}

# lifecycleHooks:
#   postCreate: bun install
#   preRemove: tmux kill-session -t "$WEBMUX_WORKTREE_ID" || true

# auto_name:
#   provider: ${defaultAgent}
#   model: ${defaultAgent === "codex" ? "gpt-5.1-codex" : "claude-3-5-haiku-latest"}
#   system_prompt: >
#     Generate a short kebab-case git branch name.
`;
}
