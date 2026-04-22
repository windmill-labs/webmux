import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { networkInterfaces } from "node:os";
import {
  AgentIdParamsSchema,
  AgentsSendMessageRequestSchema,
  apiPaths,
  AvailableBranchesQuerySchema,
  CreateWorktreeRequestSchema,
  NotificationIdParamsSchema,
  PullMainRequestSchema,
  RunIdParamsSchema,
  SendWorktreePromptRequestSchema,
  SetWorktreeArchivedRequestSchema,
  ToggleEnabledRequestSchema,
  UpsertCustomAgentRequestSchema,
  WorktreeNameParamsSchema,
} from "@webmux/api-contract";
import { log } from "./lib/log";
import {
  attach,
  detach,
  interruptPrompt,
  write,
  resize,
  selectPane,
  sendKeys,
  getScrollback,
  setCallbacks,
  clearCallbacks,
  cleanupStaleSessions,
  sendPrompt as sendTerminalPrompt,
  type TerminalAttachTarget,
} from "./adapters/terminal";
import { loadControlToken } from "./adapters/control-token";
import { ClaudeCliClient } from "./adapters/claude-cli";
import { CodexAppServerClient } from "./adapters/codex-app-server";
import {
  getDefaultProfileName,
  persistLocalCustomAgent,
  persistLocalGitHubConfig,
  persistLocalLinearConfig,
  removeLocalCustomAgent,
  type ProjectConfig,
} from "./adapters/config";
import { jsonResponse, errorResponse } from "./lib/http";
import { isRecord, isStringArray } from "./lib/type-guards";
import { parseJsonBody, parseParams, parseQuery } from "./api-validation";
import { hasRecentDashboardActivity, touchDashboardActivity } from "./services/dashboard-activity";
import { buildArchivedWorktreePathSet, normalizeArchivePath } from "./services/archive-service";
import { getAgentDefinition, isBuiltInAgentId, listAgentDetails, listAgentSummaries, normalizeCustomAgentId } from "./services/agent-registry";
import {
  branchMatchesIssue,
  buildLinearIssuesResponse,
  createLinearIssue,
  deriveLinearIssueTitle,
  fetchAssignedIssues,
} from "./services/linear-service";
import { buildCreateWorktreeTargets, LifecycleError } from "./services/lifecycle-service";
import { buildNativeTerminalLaunch, buildNativeTerminalTmuxCommand } from "./services/native-terminal-service";
import { startPrMonitor } from "./services/pr-service";
import { startLinearAutoCreateMonitor, resetProcessedIssues } from "./services/linear-auto-create-service";
import { runAutoRemove, type AutoRemoveDependencies } from "./services/auto-remove-service";
import { pullMainBranch, forcePullMainBranch, startAutoPullMonitor } from "./services/auto-pull-service";
import {
  buildAgentsUiMessageDeltaEvent,
  readAgentsNotificationThreadId,
  shouldRefreshAgentsConversationSnapshot,
} from "./services/agents-ui-stream-service";
import { classifyAgentsTerminalWorktreeError } from "./services/agents-ui-action-service";
import { buildProjectSnapshot } from "./services/snapshot-service";
import { ClaudeConversationService } from "./services/claude-conversation-service";
import { WorktreeConversationService } from "./services/worktree-conversation-service";
import { parseRuntimeEvent } from "./domain/events";
import type { AgentsUiConversationEvent, AgentsUiWorktreeConversationResponse } from "./domain/agents-ui";
import type { ProjectSnapshot, WorktreeSnapshot } from "./domain/model";
import { isValidBranchName, isValidWorktreeName } from "./domain/policies";
import { createWebmuxRuntime } from "./runtime";

const PORT = parseInt(Bun.env.PORT || "5111", 10);
const STATIC_DIR = Bun.env.WEBMUX_STATIC_DIR || "";
// Codex can read Enter before tmux has fully flushed pasted bytes into the pane PTY.
const CODEX_TMUX_PROMPT_SUBMIT_DELAY_MS = 200;
const runtime = createWebmuxRuntime({
  port: PORT,
  projectDir: Bun.env.WEBMUX_PROJECT_DIR || process.cwd(),
});
const PROJECT_DIR = runtime.projectDir;
const config: ProjectConfig = runtime.config;
const git = runtime.git;
const archiveStateService = runtime.archiveStateService;
const tmux = runtime.tmux;
const projectRuntime = runtime.projectRuntime;
const worktreeCreationTracker = runtime.worktreeCreationTracker;
const runtimeNotifications = runtime.runtimeNotifications;
const reconciliationService = runtime.reconciliationService;
const codexAppServerClient = new CodexAppServerClient({
  clientName: "webmux-agents",
  clientVersion: "0.0.0",
});
const claudeCliClient = new ClaudeCliClient();
const worktreeConversationService = new WorktreeConversationService({
  appServer: codexAppServerClient,
  git,
});
const claudeConversationService = new ClaudeConversationService({
  claude: claudeCliClient,
  git,
});
const removingBranches = new Set<string>();
const lifecycleService = runtime.lifecycleService;
let linearAutoCreateEnabled = config.integrations.linear.autoCreateWorktrees;
let stopLinearAutoCreate: (() => void) | null = null;
let autoRemoveOnMergeEnabled = config.integrations.github.autoRemoveOnMerge;

/** Safe to call multiple times — the guard prevents duplicate monitors. */
function startLinearAutoCreate(): void {
  if (stopLinearAutoCreate) return;
  stopLinearAutoCreate = startLinearAutoCreateMonitor({
    lifecycleService,
    git,
    projectRoot: PROJECT_DIR,
    isActive: hasRecentDashboardActivity,
  });
}

function stopLinearAutoCreateMonitor(): void {
  if (stopLinearAutoCreate) {
    stopLinearAutoCreate();
    stopLinearAutoCreate = null;
  }
}

const autoRemoveDeps: AutoRemoveDependencies = {
  lifecycleService,
  git,
  projectRoot: PROJECT_DIR,
  notifications: runtimeNotifications,
  isRemoving: (branch: string) => removingBranches.has(branch),
  markRemoving: (branch: string) => removingBranches.add(branch),
  unmarkRemoving: (branch: string) => removingBranches.delete(branch),
};

function getFrontendConfig(): {
  name: string;
  services: ProjectConfig["services"];
  profiles: Array<{ name: string; systemPrompt?: string }>;
  agents: ReturnType<typeof listAgentSummaries>;
  defaultProfileName: string;
  defaultAgentId: string;
  autoName: boolean;
  linearCreateTicketOption: boolean;
  startupEnvs: ProjectConfig["startupEnvs"];
  linkedRepos: Array<{ alias: string; dir?: string }>;
  linearAutoCreateWorktrees: boolean;
  autoRemoveOnMerge: boolean;
  projectDir: string;
  mainBranch: string;
} {
  const defaultProfileName = getDefaultProfileName(config);
  const orderedProfileEntries = Object.entries(config.profiles).sort(([left], [right]) => {
    if (left === defaultProfileName) return -1;
    if (right === defaultProfileName) return 1;
    return 0;
  });

  return {
    name: config.name,
    services: config.services,
    profiles: orderedProfileEntries.map(([name, profile]) => ({
      name,
      ...(profile.systemPrompt ? { systemPrompt: profile.systemPrompt } : {}),
    })),
    agents: listAgentSummaries(config),
    defaultProfileName,
    defaultAgentId: config.workspace.defaultAgent,
    autoName: config.autoName !== null,
    linearCreateTicketOption: config.integrations.linear.enabled && config.integrations.linear.createTicketOption,
    startupEnvs: config.startupEnvs,
    linkedRepos: config.integrations.github.linkedRepos.map((lr) => ({
      alias: lr.alias,
      ...(lr.dir ? { dir: resolve(PROJECT_DIR, lr.dir) } : {}),
    })),
    linearAutoCreateWorktrees: linearAutoCreateEnabled,
    autoRemoveOnMerge: autoRemoveOnMergeEnabled,
    projectDir: PROJECT_DIR,
    mainBranch: config.workspace.mainBranch,
  };
}

// --- WebSocket protocol types ---

interface TerminalWsData {
  kind: "terminal";
  branch: string;
  worktreeId: string | null;
  attachId: string | null;
  attached: boolean;
}

interface AgentsWsData {
  kind: "agents";
  branch: string;
  conversationId: string | null;
  unsubscribe: (() => void) | null;
}

type WsData = TerminalWsData | AgentsWsData;
type ParamsRequest = Request & { params: Record<string, string> };

type WsInboundMessage =
  | { type: "input"; data: string }
  | { type: "sendKeys"; hexBytes: string[] }
  | { type: "selectPane"; pane: number }
  | { type: "resize"; cols: number; rows: number; initialPane?: number };

type WsOutboundMessage =
  | { type: "output"; data: string }
  | { type: "exit"; exitCode: number }
  | { type: "error"; message: string }
  | { type: "scrollback"; data: string };

function parseWsMessage(raw: string | Buffer): WsInboundMessage | null {
  try {
    const str = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
    const msg: unknown = JSON.parse(str);
    if (!isRecord(msg)) return null;
    const m = msg;
    switch (m.type) {
      case "input":
        return typeof m.data === "string" ? { type: "input", data: m.data } : null;
      case "sendKeys":
        return isStringArray(m.hexBytes)
          ? { type: "sendKeys", hexBytes: m.hexBytes }
          : null;
      case "selectPane":
        return typeof m.pane === "number" ? { type: "selectPane", pane: m.pane } : null;
      case "resize":
        return typeof m.cols === "number" && typeof m.rows === "number"
          ? {
            type: "resize",
            cols: m.cols,
            rows: m.rows,
            initialPane: typeof m.initialPane === "number" ? m.initialPane : undefined,
          }
          : null;
      default:
        return null;
    }
  } catch {
    return null;
  }
}

// --- HTTP helpers ---

/** Send a WsOutboundMessage. Hot-path messages (output/scrollback) use a
 *  single-character prefix to avoid JSON encode/decode overhead. */
function sendWs(ws: { send: (data: string) => void }, msg: WsOutboundMessage): void {
  switch (msg.type) {
    case "output":
      ws.send("o" + msg.data);
      break;
    case "scrollback":
      ws.send("s" + msg.data);
      break;
    default:
      ws.send(JSON.stringify(msg));
  }
}

function sendAgentsWs(ws: { readyState: number; send: (data: string) => void }, msg: AgentsUiConversationEvent): void {
  if (ws.readyState <= 1) {
    ws.send(JSON.stringify(msg));
  }
}

/** Wrap an async API handler to catch and log unhandled errors. */
function catching(label: string, fn: () => Promise<Response>): Promise<Response> {
  return fn().catch((err: unknown) => {
    if (err instanceof LifecycleError) {
      return errorResponse(err.message, err.status);
    }

    const msg = err instanceof Error ? err.message : String(err);
    log.error(`[api:error] ${label}: ${msg}`);
    return errorResponse(msg);
  });
}

function ensureBranchNotRemoving(branch: string): void {
  if (removingBranches.has(branch)) {
    throw new LifecycleError(`Worktree is being removed: ${branch}`, 409);
  }
}

function ensureBranchNotCreating(branch: string): void {
  if (worktreeCreationTracker.has(branch)) {
    throw new LifecycleError(`Worktree is being created: ${branch}`, 409);
  }
}

function ensureBranchNotBusy(branch: string): void {
  ensureBranchNotRemoving(branch);
  ensureBranchNotCreating(branch);
}

async function withRemovingBranch<T>(branch: string, fn: () => Promise<T>): Promise<T> {
  ensureBranchNotBusy(branch);
  removingBranches.add(branch);
  try {
    return await fn();
  } finally {
    removingBranches.delete(branch);
  }
}

async function resolveTerminalWorktree(branch: string): Promise<{
  worktreeId: string;
  attachTarget: TerminalAttachTarget;
}> {
  ensureBranchNotBusy(branch);
  let state = projectRuntime.getWorktreeByBranch(branch);
  if (!state || !state.session.exists || !state.session.sessionName) {
    await reconciliationService.reconcile(PROJECT_DIR);
    state = projectRuntime.getWorktreeByBranch(branch);
  }
  if (!state) {
    throw new Error(`Worktree not found: ${branch}`);
  }
  if (!state.session.exists || !state.session.sessionName) {
    throw new Error(`No open tmux window found for worktree: ${branch}`);
  }

  return {
    worktreeId: state.worktreeId,
    attachTarget: {
      ownerSessionName: state.session.sessionName,
      windowName: state.session.windowName,
    },
  };
}

async function resolveAgentsTerminalWorktree(branch: string): Promise<{
  ok: true;
  data: {
    worktreeId: string;
    attachTarget: TerminalAttachTarget;
  };
} | {
  ok: false;
  response: Response;
}> {
  try {
    return {
      ok: true,
      data: await resolveTerminalWorktree(branch),
    };
  } catch (error) {
    const classified = classifyAgentsTerminalWorktreeError(error);
    if (!classified) throw error;
    return {
      ok: false,
      response: errorResponse(classified.error, classified.status),
    };
  }
}

async function apiGetNativeTerminalLaunch(branch: string): Promise<Response> {
  touchDashboardActivity();
  ensureBranchNotBusy(branch);
  await reconciliationService.reconcile(PROJECT_DIR);
  const launch = buildNativeTerminalLaunch({
    branch,
    state: projectRuntime.getWorktreeByBranch(branch),
    tmuxCommand: buildNativeTerminalTmuxCommand(Bun.env),
    sessionPrefix: `wm-native-${PORT}-`,
  });
  if (!launch.ok) {
    return errorResponse(launch.message, launch.reason === "not_found" ? 404 : 409);
  }
  return jsonResponse(launch.data);
}

function getAttachedSessionId(
  data: TerminalWsData,
  ws: { readyState: number; send: (data: string) => void },
): string | null {
  if (data.attached && data.attachId) {
    return data.attachId;
  }

  sendWs(ws, { type: "error", message: "Terminal not attached" });
  return null;
}

async function hasValidControlToken(req: Request): Promise<boolean> {
  const authHeader = req.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  return token === await loadControlToken();
}

// --- Process helpers ---

async function getWorktreeGitDirs(): Promise<Map<string, string>> {
  const gitDirs = new Map<string, string>();
  const projectRoot = resolve(PROJECT_DIR);
  for (const entry of git.listWorktrees(projectRoot)) {
    if (entry.bare || resolve(entry.path) === projectRoot || !entry.branch) continue;
    gitDirs.set(entry.branch, git.resolveWorktreeGitDir(entry.path));
  }
  return gitDirs;
}

function makeCallbacks(ws: { send: (data: string) => void; readyState: number }): {
  onData: (data: string) => void;
  onExit: (exitCode: number) => void;
} {
  return {
    onData: (data: string) => {
      if (ws.readyState <= 1) sendWs(ws, { type: "output", data });
    },
    onExit: (exitCode: number) => {
      if (ws.readyState <= 1) sendWs(ws, { type: "exit", exitCode });
    },
  };
}

async function readProjectSnapshot(): Promise<ProjectSnapshot> {
  const linearApiKey = Bun.env.LINEAR_API_KEY;
  const linearIssuesPromise = config.integrations.linear.enabled && linearApiKey?.trim()
    ? fetchAssignedIssues()
    : Promise.resolve({ ok: true as const, data: [] });
  await reconciliationService.reconcile(PROJECT_DIR);
  const archiveState = await archiveStateService.prune(projectRuntime.listWorktrees().map((worktree) => worktree.path));
  const linearResult = await linearIssuesPromise;
  const archivedPaths = buildArchivedWorktreePathSet(archiveState);
  const linearIssues = linearResult.ok ? linearResult.data : [];
  return buildProjectSnapshot({
    projectName: config.name,
    mainBranch: config.workspace.mainBranch,
    runtime: projectRuntime,
    creatingWorktrees: worktreeCreationTracker.list(),
    notifications: runtimeNotifications.list(),
    isArchived: (path) => archivedPaths.has(normalizeArchivePath(path)),
    findLinearIssue: (branch) => {
      const match = linearIssues.find((issue) => branchMatchesIssue(branch, issue.branchName));
      return match
        ? {
            identifier: match.identifier,
            url: match.url,
            state: match.state,
          }
        : null;
    },
    findAgentLabel: (agentId) => {
      if (!agentId) return null;
      return getAgentDefinition(config, agentId)?.label ?? agentId;
    },
  });
}

// --- API handler functions (thin I/O layer, testable by injecting deps) ---

async function apiGetProject(): Promise<Response> {
  touchDashboardActivity();
  return jsonResponse(await readProjectSnapshot());
}

async function apiGetWorktrees(): Promise<Response> {
  touchDashboardActivity();
  return jsonResponse({
    worktrees: (await readProjectSnapshot()).worktrees,
  });
}

function findSnapshotWorktree(snapshot: ProjectSnapshot, branch: string): WorktreeSnapshot | null {
  return snapshot.worktrees.find((worktree) => worktree.branch === branch) ?? null;
}

async function resolveAgentsWorktree(branch: string): Promise<{
  ok: true;
  worktree: WorktreeSnapshot;
} | {
  ok: false;
  response: Response;
}> {
  const snapshot = await readProjectSnapshot();
  const worktree = findSnapshotWorktree(snapshot, branch);
  if (!worktree) {
    return {
      ok: false,
      response: errorResponse(`Worktree not found: ${branch}`, 404),
    };
  }

  return {
    ok: true,
    worktree,
  };
}

async function apiAttachAgentsWorktree(branch: string): Promise<Response> {
  touchDashboardActivity();
  const resolved = await resolveAgentsWorktree(branch);
  if (!resolved.ok) return resolved.response;

  const result = resolved.worktree.agentName === "claude"
    ? await claudeConversationService.attachWorktreeConversation(resolved.worktree)
    : await worktreeConversationService.attachWorktreeConversation(resolved.worktree);
  return result.ok
    ? jsonResponse(result.data)
    : errorResponse(result.error, result.status);
}

async function apiGetAgentsWorktreeHistory(branch: string): Promise<Response> {
  touchDashboardActivity();
  const resolved = await resolveAgentsWorktree(branch);
  if (!resolved.ok) return resolved.response;

  const result = resolved.worktree.agentName === "claude"
    ? await claudeConversationService.readWorktreeConversation(resolved.worktree)
    : await worktreeConversationService.readWorktreeConversation(resolved.worktree);
  return result.ok
    ? jsonResponse(result.data)
    : errorResponse(result.error, result.status);
}

async function apiSendAgentsWorktreeMessage(branch: string, req: Request): Promise<Response> {
  touchDashboardActivity();
  const parsed = await parseJsonBody(req, AgentsSendMessageRequestSchema);
  if (!parsed.ok) return parsed.response;

  const resolved = await resolveAgentsWorktree(branch);
  if (!resolved.ok) return resolved.response;
  if (!resolved.worktree.mux) {
    return errorResponse("Open this worktree in the main dashboard before sending messages here", 409);
  }

  const conversationResult = resolved.worktree.agentName === "claude"
    ? await claudeConversationService.readWorktreeConversation(resolved.worktree)
    : await worktreeConversationService.readWorktreeConversation(resolved.worktree);
  if (!conversationResult.ok) {
    return errorResponse(conversationResult.error, conversationResult.status);
  }

  const terminalWorktree = await resolveAgentsTerminalWorktree(branch);
  if (!terminalWorktree.ok) return terminalWorktree.response;
  const sendResult = await sendTerminalPrompt(
    terminalWorktree.data.worktreeId,
    terminalWorktree.data.attachTarget,
    parsed.data.text,
    0,
    undefined,
    resolved.worktree.agentName === "codex" ? CODEX_TMUX_PROMPT_SUBMIT_DELAY_MS : 0,
  );
  if (!sendResult.ok) {
    return errorResponse(sendResult.error, 503);
  }

  // tmux send has no real turn id yet; history replaces this optimistic placeholder on refresh.
  return jsonResponse({
    conversationId: conversationResult.data.conversation.conversationId,
    turnId: `tmux:${crypto.randomUUID()}`,
    running: true,
  });
}

async function apiInterruptAgentsWorktree(branch: string): Promise<Response> {
  touchDashboardActivity();
  const resolved = await resolveAgentsWorktree(branch);
  if (!resolved.ok) return resolved.response;
  if (!resolved.worktree.mux) {
    return errorResponse("Open this worktree in the main dashboard before interrupting it here", 409);
  }

  const conversationResult = resolved.worktree.agentName === "claude"
    ? await claudeConversationService.readWorktreeConversation(resolved.worktree)
    : await worktreeConversationService.readWorktreeConversation(resolved.worktree);
  if (!conversationResult.ok) {
    return errorResponse(conversationResult.error, conversationResult.status);
  }

  const terminalWorktree = await resolveAgentsTerminalWorktree(branch);
  if (!terminalWorktree.ok) return terminalWorktree.response;
  const interruptResult = await interruptPrompt(terminalWorktree.data.attachTarget, 0);
  if (!interruptResult.ok) {
    return errorResponse(interruptResult.error, 503);
  }

  return jsonResponse({
    conversationId: conversationResult.data.conversation.conversationId,
    turnId: conversationResult.data.conversation.activeTurnId ?? `tmux:${crypto.randomUUID()}`,
    interrupted: true,
  });
}

async function loadAgentsConversationSnapshot(
  branch: string,
): Promise<{
  ok: true;
  data: AgentsUiWorktreeConversationResponse;
} | {
  ok: false;
  message: string;
}> {
  const resolved = await resolveAgentsWorktree(branch);
  if (!resolved.ok) {
    return {
      ok: false,
      message: await readErrorMessage(resolved.response),
    };
  }

  const result = resolved.worktree.agentName === "claude"
    ? await claudeConversationService.readWorktreeConversation(resolved.worktree)
    : await worktreeConversationService.readWorktreeConversation(resolved.worktree);
  return result.ok
    ? { ok: true, data: result.data }
    : { ok: false, message: result.error };
}

async function readErrorMessage(response: Response): Promise<string> {
  const contentType = response.headers.get("Content-Type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const body: unknown = await response.json();
      if (isRecord(body) && typeof body.error === "string" && body.error.length > 0) {
        return body.error;
      }
    } catch {
      // Ignore parse failures and fall through to raw text.
    }
  }

  const text = await response.text();
  return text.length > 0 ? text : `HTTP ${response.status}`;
}

async function openAgentsSocket(
  ws: { readyState: number; send: (data: string) => void; close: (code?: number, reason?: string) => void },
  data: AgentsWsData,
): Promise<void> {
  const snapshot = await loadAgentsConversationSnapshot(data.branch);
  if (!snapshot.ok) {
    sendAgentsWs(ws, { type: "error", message: snapshot.message });
    ws.close(1011, snapshot.message.slice(0, 123));
    return;
  }

  data.conversationId = snapshot.data.conversation.conversationId;
  sendAgentsWs(ws, {
    type: "snapshot",
    data: snapshot.data,
  });

  if (snapshot.data.conversation.provider !== "codexAppServer") {
    return;
  }

  data.unsubscribe = codexAppServerClient.onNotification((notification) => {
    const notificationThreadId = readAgentsNotificationThreadId(notification);
    if (!notificationThreadId || notificationThreadId !== data.conversationId) return;

    const deltaEvent = buildAgentsUiMessageDeltaEvent(notification);
    if (deltaEvent) {
      sendAgentsWs(ws, deltaEvent);
      return;
    }

    if (!shouldRefreshAgentsConversationSnapshot(notification)) return;

    void (async () => {
      const nextSnapshot = await loadAgentsConversationSnapshot(data.branch);
      if (!nextSnapshot.ok) {
        sendAgentsWs(ws, { type: "error", message: nextSnapshot.message });
        return;
      }

      data.conversationId = nextSnapshot.data.conversation.conversationId;
      sendAgentsWs(ws, {
        type: "snapshot",
        data: nextSnapshot.data,
      });
    })();
  });
}

async function apiRuntimeEvent(req: Request): Promise<Response> {
  if (!await hasValidControlToken(req)) {
    return new Response("Unauthorized", { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return errorResponse("Invalid JSON", 400);
  }
  const event = parseRuntimeEvent(raw);
  if (!event) return errorResponse("Invalid runtime event body", 400);

  try {
    projectRuntime.applyEvent(event);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Unknown worktree id")) {
      await reconciliationService.reconcile(PROJECT_DIR);
      try {
        projectRuntime.applyEvent(event);
      } catch (retryError) {
        const retryMessage = retryError instanceof Error ? retryError.message : String(retryError);
        if (retryMessage.includes("Unknown worktree id")) {
          return errorResponse(retryMessage, 404);
        }
        throw retryError;
      }
    } else {
      throw error;
    }
  }

  const notification = runtimeNotifications.recordEvent(event);
  return jsonResponse({
    ok: true,
    ...(notification ? { notification } : {}),
  });
}

async function apiListBranches(req: Request): Promise<Response> {
  const parsed = parseQuery(req, AvailableBranchesQuerySchema);
  if (!parsed.ok) return parsed.response;

  const includeRemote = parsed.data.includeRemote === true;
  return jsonResponse({
    branches: lifecycleService.listAvailableBranches({ includeRemote }),
  });
}

async function apiListBaseBranches(): Promise<Response> {
  return jsonResponse({
    branches: lifecycleService.listBaseBranches(),
  });
}

async function apiCreateWorktree(req: Request): Promise<Response> {
  const parsed = await parseJsonBody(req, CreateWorktreeRequestSchema);
  if (!parsed.ok) return parsed.response;

  const body = parsed.data;
  const envOverrides = body.envOverrides && Object.keys(body.envOverrides).length > 0 ? body.envOverrides : undefined;
  const branch = body.branch?.trim() ? body.branch.trim() : undefined;
  const baseBranch = body.baseBranch?.trim() ? body.baseBranch.trim() : undefined;
  const prompt = body.prompt?.trim() ? body.prompt.trim() : undefined;
  const profile = body.profile;
  const agent = body.agent?.trim() || undefined;
  const agents = body.agents?.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  const createLinearTicket = body.createLinearTicket === true;
  const linearTitle = body.linearTitle?.trim() ? body.linearTitle.trim() : undefined;
  const mode = body.mode;
  const selectedAgents = agents && agents.length > 0
    ? agents
    : agent
      ? [agent]
      : [config.workspace.defaultAgent];

  if (body.agents && selectedAgents.length === 0) {
    return errorResponse("At least one agent must be selected", 400);
  }

  if (baseBranch && !isValidBranchName(baseBranch)) {
    return errorResponse("Invalid base branch name", 400);
  }

  if (createLinearTicket && mode === "existing") {
    return errorResponse("Linear ticket creation is only supported for new branches", 400);
  }

  if (baseBranch && mode === "existing") {
    return errorResponse("Base branch is only supported for new branches", 400);
  }

  if (createLinearTicket && !config.integrations.linear.enabled) {
    return errorResponse("Linear integration is disabled", 400);
  }

  if (createLinearTicket && !config.integrations.linear.createTicketOption) {
    return errorResponse("Linear ticket creation is not enabled for this project", 400);
  }

  if (createLinearTicket && !prompt) {
    return errorResponse("Prompt is required when creating a Linear ticket", 400);
  }

  let resolvedBranch = branch;
  if (createLinearTicket) {
    const title = deriveLinearIssueTitle(linearTitle, prompt);
    if (!title) {
      return errorResponse("Linear ticket title could not be derived from the prompt", 400);
    }

    const teamId = config.integrations.linear.teamId;
    if (!teamId) {
      return errorResponse("Linear teamId is not configured", 503);
    }

    const linearResult = await createLinearIssue({
      title,
      description: prompt ?? "",
      teamId,
    });
    if (!linearResult.ok) {
      return errorResponse(linearResult.error, 502);
    }

    resolvedBranch = linearResult.data.branchName;
    log.info(
      `[linear] created ticket ${linearResult.data.identifier} branch=${linearResult.data.branchName} title="${linearResult.data.title.slice(0, 80)}"`,
    );
  }

  if (resolvedBranch) {
    const targetBranches = buildCreateWorktreeTargets(resolvedBranch, selectedAgents).map((target) => target.branch);
    for (const targetBranch of targetBranches) {
      ensureBranchNotBusy(targetBranch);
    }

    if (baseBranch && targetBranches.some((targetBranch) => targetBranch === baseBranch)) {
      return errorResponse("Base branch must differ from branch name", 400);
    }
  }

  log.info(
    `[worktree:add] mode=${mode ?? "new"}${resolvedBranch ? ` branch=${resolvedBranch}` : ""}${baseBranch ? ` base=${baseBranch}` : ""}${profile ? ` profile=${profile}` : ""} agents=${selectedAgents.join(",")}${createLinearTicket ? " linearTicket=true" : ""}${prompt ? ` prompt="${prompt.slice(0, 80)}"` : ""}`,
  );
  const result = await lifecycleService.createWorktrees({
    mode,
    branch: resolvedBranch,
    baseBranch,
    prompt,
    profile,
    ...(agents && agents.length > 0 ? { agents } : { agent }),
    envOverrides,
  });
  log.debug(`[worktree:add] done branches=${result.branches.join(",")}`);
  return jsonResponse({
    primaryBranch: result.primaryBranch,
    branches: result.branches,
  }, 201);
}

async function apiDeleteWorktree(name: string): Promise<Response> {
  return withRemovingBranch(name, async () => {
    log.info(`[worktree:rm] name=${name}`);
    await lifecycleService.removeWorktree(name);
    log.debug(`[worktree:rm] done name=${name}`);
    return jsonResponse({ ok: true });
  });
}

async function apiOpenWorktree(name: string): Promise<Response> {
  ensureBranchNotBusy(name);
  log.info(`[worktree:open] name=${name}`);
  const result = await lifecycleService.openWorktree(name);
  log.debug(`[worktree:open] done name=${name} worktreeId=${result.worktreeId}`);
  return jsonResponse({ ok: true });
}

async function apiCloseWorktree(name: string): Promise<Response> {
  ensureBranchNotBusy(name);
  log.info(`[worktree:close] name=${name}`);
  await lifecycleService.closeWorktree(name);
  log.debug(`[worktree:close] done name=${name}`);
  return jsonResponse({ ok: true });
}

async function apiSetWorktreeArchived(name: string, req: Request): Promise<Response> {
  ensureBranchNotBusy(name);
  const parsed = await parseJsonBody(req, SetWorktreeArchivedRequestSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  log.info(`[worktree:archive] name=${name} archived=${body.archived}`);
  await lifecycleService.setWorktreeArchived(name, body.archived);
  log.debug(`[worktree:archive] done name=${name} archived=${body.archived}`);
  return jsonResponse({ ok: true, archived: body.archived });
}

async function apiSendPrompt(name: string, req: Request): Promise<Response> {
  ensureBranchNotBusy(name);
  const parsed = await parseJsonBody(req, SendWorktreePromptRequestSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const text = body.text;
  const preamble = body.preamble;
  log.info(`[worktree:send] name=${name} text="${text.slice(0, 80)}"`);
  const terminalWorktree = await resolveTerminalWorktree(name);
  const result = await sendTerminalPrompt(
    terminalWorktree.worktreeId,
    terminalWorktree.attachTarget,
    text,
    0,
    preamble,
  );
  if (!result.ok) return errorResponse(result.error, 503);
  return jsonResponse({ ok: true });
}

async function apiMergeWorktree(name: string): Promise<Response> {
  ensureBranchNotBusy(name);
  log.info(`[worktree:merge] name=${name}`);
  await lifecycleService.mergeWorktree(name);
  log.debug(`[worktree:merge] done name=${name}`);
  return jsonResponse({ ok: true });
}

async function apiListAgents(): Promise<Response> {
  return jsonResponse({ agents: listAgentDetails(config) });
}

async function apiCreateAgent(req: Request): Promise<Response> {
  const parsed = await parseJsonBody(req, UpsertCustomAgentRequestSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const agentId = normalizeCustomAgentId(body.label);

  if (isBuiltInAgentId(agentId) || config.agents[agentId]) {
    return errorResponse(`Agent already exists: ${agentId}`, 409);
  }

  const agentConfig = {
    label: body.label,
    startCommand: body.startCommand,
    ...(body.resumeCommand?.trim() ? { resumeCommand: body.resumeCommand.trim() } : {}),
  };

  await persistLocalCustomAgent(PROJECT_DIR, agentId, agentConfig);
  config.agents[agentId] = agentConfig;

  const agent = listAgentDetails(config).find((entry) => entry.id === agentId);
  if (!agent) {
    return errorResponse(`Created agent could not be loaded: ${agentId}`, 500);
  }

  return jsonResponse({ agent });
}

async function apiUpdateAgent(agentId: string, req: Request): Promise<Response> {
  if (isBuiltInAgentId(agentId)) {
    return errorResponse(`Built-in agent cannot be edited: ${agentId}`, 400);
  }
  if (!config.agents[agentId]) {
    return errorResponse(`Unknown agent: ${agentId}`, 404);
  }

  const parsed = await parseJsonBody(req, UpsertCustomAgentRequestSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const agentConfig = {
    label: body.label,
    startCommand: body.startCommand,
    ...(body.resumeCommand?.trim() ? { resumeCommand: body.resumeCommand.trim() } : {}),
  };

  await persistLocalCustomAgent(PROJECT_DIR, agentId, agentConfig);
  config.agents[agentId] = agentConfig;

  const agent = listAgentDetails(config).find((entry) => entry.id === agentId);
  if (!agent) {
    return errorResponse(`Updated agent could not be loaded: ${agentId}`, 500);
  }

  return jsonResponse({ agent });
}

async function apiDeleteAgent(agentId: string): Promise<Response> {
  if (isBuiltInAgentId(agentId)) {
    return errorResponse(`Built-in agent cannot be deleted: ${agentId}`, 400);
  }
  if (!config.agents[agentId]) {
    return errorResponse(`Unknown agent: ${agentId}`, 404);
  }

  await removeLocalCustomAgent(PROJECT_DIR, agentId);
  delete config.agents[agentId];
  return jsonResponse({ ok: true });
}

async function apiSetLinearAutoCreate(req: Request): Promise<Response> {
  const parsed = await parseJsonBody(req, ToggleEnabledRequestSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  linearAutoCreateEnabled = body.enabled;
  if (linearAutoCreateEnabled) {
    resetProcessedIssues();
    startLinearAutoCreate();
    log.info("[config] Linear auto-create worktrees enabled");
  } else {
    stopLinearAutoCreateMonitor();
    log.info("[config] Linear auto-create worktrees disabled");
  }

  await persistLocalLinearConfig(PROJECT_DIR, { autoCreateWorktrees: linearAutoCreateEnabled });

  return jsonResponse({ ok: true, enabled: linearAutoCreateEnabled });
}

async function apiSetAutoRemoveOnMerge(req: Request): Promise<Response> {
  const parsed = await parseJsonBody(req, ToggleEnabledRequestSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  autoRemoveOnMergeEnabled = body.enabled;
  log.info(`[config] Auto-remove on merge ${autoRemoveOnMergeEnabled ? "enabled" : "disabled"}`);

  await persistLocalGitHubConfig(PROJECT_DIR, { autoRemoveOnMerge: autoRemoveOnMergeEnabled });

  return jsonResponse({ ok: true, enabled: autoRemoveOnMergeEnabled });
}

async function apiPullMain(req: Request): Promise<Response> {
  const raw: unknown = await req.json().catch(() => ({}));
  const parsed = PullMainRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return errorResponse("Invalid request body", 400);
  }
  const force = parsed.data.force === true;
  const repo = parsed.data.repo ?? "";

  let projectRoot = PROJECT_DIR;
  if (repo) {
    const linkedRepo = config.integrations.github.linkedRepos.find((lr) => lr.alias === repo);
    if (!linkedRepo) return errorResponse(`Unknown linked repo: ${repo}`, 404);
    if (!linkedRepo.dir) return errorResponse(`Linked repo "${repo}" has no dir configured`, 400);
    const resolvedDir = resolve(PROJECT_DIR, linkedRepo.dir);
    const repoRoot = git.resolveRepoRoot(resolvedDir);
    if (!repoRoot) return errorResponse(`Linked repo "${repo}" dir is not a git repository: ${resolvedDir}`, 400);
    projectRoot = repoRoot;
  }

  // NOTE: linked repos inherit the project's mainBranch setting — if a linked
  // repo uses a different default branch this will need a per-repo override.
  const deps = { git, projectRoot, mainBranch: config.workspace.mainBranch };
  const result = force ? forcePullMainBranch(deps) : pullMainBranch(deps);

  log.info(`[pull-main] ${repo || "main"} ${force ? "force " : ""}pull: ${result.status}`);
  return jsonResponse(result);
}

async function apiGetLinearIssues(): Promise<Response> {
  const apiKey = Bun.env.LINEAR_API_KEY;
  const fetchResult = config.integrations.linear.enabled && apiKey?.trim()
    ? await fetchAssignedIssues()
    : undefined;
  const result = buildLinearIssuesResponse({
    integrationEnabled: config.integrations.linear.enabled,
    apiKey,
    fetchResult,
  });
  if (!result.ok) return errorResponse(result.error, 502);
  return jsonResponse(result.data);
}

const MAX_DIFF_BYTES = 200 * 1024;

async function apiGetWorktreeDiff(name: string): Promise<Response> {
  await reconciliationService.reconcile(PROJECT_DIR);
  const state = projectRuntime.getWorktreeByBranch(name);
  if (!state) return errorResponse(`Worktree not found: ${name}`, 404);

  const uncommitted = git.readDiff(state.path);
  const gitStatus = git.readStatus(state.path);
  const unpushedCommits = git.listUnpushedCommits(state.path);

  const truncated = uncommitted.length > MAX_DIFF_BYTES;
  return jsonResponse({
    uncommitted: truncated ? uncommitted.slice(0, MAX_DIFF_BYTES) : uncommitted,
    uncommittedTruncated: truncated,
    gitStatus,
    unpushedCommits,
  });
}

async function apiCiLogs(runId: number): Promise<Response> {
  const proc = Bun.spawn(["gh", "run", "view", String(runId), "--log-failed"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  if (exitCode === 0) {
    const logs = await new Response(proc.stdout).text();
    return jsonResponse({ logs });
  }
  const stderr = (await new Response(proc.stderr).text()).trim();
  return errorResponse(`Failed to fetch logs: ${stderr || "unknown error"}`, 502);
}

const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

function sanitizeFilename(name: string): string {
  // Strip directory components, replace unsafe chars
  const base = name.split("/").pop()?.split("\\").pop() ?? "upload";
  return base.replace(/[^a-zA-Z0-9._-]/g, "_") || "upload";
}

async function apiUploadFiles(name: string, req: Request): Promise<Response> {
  const state = projectRuntime.getWorktreeByBranch(name);
  if (!state) return errorResponse(`Worktree not found: ${name}`, 404);

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return errorResponse("Invalid multipart form data", 400);
  }

  const entries = formData.getAll("files");
  if (entries.length === 0) return errorResponse("No files provided", 400);

  const uploadDir = `/tmp/webmux-uploads/${sanitizeFilename(name)}`;
  mkdirSync(uploadDir, { recursive: true });

  const results: Array<{ path: string }> = [];
  for (const entry of entries) {
    if (!(entry instanceof File)) continue;
    if (!ALLOWED_IMAGE_TYPES.has(entry.type)) {
      return errorResponse(`Unsupported file type: ${entry.type}`, 400);
    }
    if (entry.size > MAX_FILE_SIZE) {
      return errorResponse(`File too large: ${entry.name} (max 10MB)`, 400);
    }
    const safeName = `${Date.now()}_${sanitizeFilename(entry.name)}`;
    const destPath = join(uploadDir, safeName);
    if (!resolve(destPath).startsWith(uploadDir + "/")) {
      return errorResponse("Invalid filename", 400);
    }
    await Bun.write(destPath, entry);
    results.push({ path: destPath });
  }

  log.info(`[upload] branch=${name} files=${results.length}`);
  return jsonResponse({ files: results });
}

function parseWorktreeNameParam(params: Record<string, string>):
  | { ok: true; data: string }
  | { ok: false; response: Response } {
  const parsed = parseParams(params, WorktreeNameParamsSchema);
  if (!parsed.ok) return parsed;
  if (!isValidWorktreeName(parsed.data.name)) {
    return {
      ok: false,
      response: errorResponse("Invalid worktree name", 400),
    };
  }
  return {
    ok: true,
    data: parsed.data.name,
  };
}

function parseRunIdParam(params: Record<string, string>):
  | { ok: true; data: number }
  | { ok: false; response: Response } {
  const parsed = parseParams(params, RunIdParamsSchema);
  if (!parsed.ok) return parsed;
  return {
    ok: true,
    data: parsed.data.runId,
  };
}

function parseNotificationIdParam(params: Record<string, string>):
  | { ok: true; data: number }
  | { ok: false; response: Response } {
  const parsed = parseParams(params, NotificationIdParamsSchema);
  if (!parsed.ok) return parsed;
  return {
    ok: true,
    data: parsed.data.id,
  };
}

function parseAgentIdParam(params: Record<string, string>):
  | { ok: true; data: string }
  | { ok: false; response: Response } {
  const parsed = parseParams(params, AgentIdParamsSchema);
  if (!parsed.ok) return parsed;
  const agentId = parsed.data.id.trim();
  if (!agentId) {
    return {
      ok: false,
      response: errorResponse("Invalid agent id", 400),
    };
  }
  return {
    ok: true,
    data: agentId,
  };
}

// --- Server ---

Bun.serve({
  port: PORT,
  idleTimeout: 255, // seconds; worktree removal can take >10s

  routes: {
    [apiPaths.streamAgentsWorktreeConversation]: (req, server) => {
      const branch = decodeURIComponent(req.params.name);
      return server.upgrade(req, { data: { kind: "agents", branch, conversationId: null, unsubscribe: null } })
        ? undefined
        : new Response("WebSocket upgrade failed", { status: 400 });
    },

    "/ws/:worktree": (req, server) => {
      const branch = decodeURIComponent(req.params.worktree);
      return server.upgrade(req, {
        data: { kind: "terminal", branch, worktreeId: null, attachId: null, attached: false },
      })
        ? undefined
        : new Response("WebSocket upgrade failed", { status: 400 });
    },

    [apiPaths.fetchConfig]: {
      GET: () => jsonResponse(getFrontendConfig()),
    },

    [apiPaths.fetchAvailableBranches]: {
      GET: (req) => catching("GET /api/branches", () => apiListBranches(req)),
    },

    [apiPaths.fetchBaseBranches]: {
      GET: () => catching("GET /api/base-branches", () => apiListBaseBranches()),
    },

    [apiPaths.fetchProject]: {
      GET: () => catching("GET /api/project", () => apiGetProject()),
    },

    [apiPaths.fetchAgents]: {
      GET: () => catching("GET /api/agents", () => apiListAgents()),
      POST: (req) => catching("POST /api/agents", () => apiCreateAgent(req)),
    },

    [apiPaths.updateAgent]: {
      PUT: (req) => {
        const parsed = parseAgentIdParam(req.params);
        if (!parsed.ok) return parsed.response;
        return catching("PUT /api/agents/:id", () => apiUpdateAgent(parsed.data, req));
      },
      DELETE: (req) => {
        const parsed = parseAgentIdParam(req.params);
        if (!parsed.ok) return parsed.response;
        return catching("DELETE /api/agents/:id", () => apiDeleteAgent(parsed.data));
      },
    },

    [apiPaths.attachAgentsWorktreeConversation]: {
      POST: (req) => {
        const parsed = parseWorktreeNameParam(req.params);
        if (!parsed.ok) return parsed.response;
        const name = parsed.data;
        return catching(`POST ${apiPaths.attachAgentsWorktreeConversation}`, () => apiAttachAgentsWorktree(name));
      },
    },

    [apiPaths.fetchAgentsWorktreeConversationHistory]: {
      GET: (req) => {
        const parsed = parseWorktreeNameParam(req.params);
        if (!parsed.ok) return parsed.response;
        const name = parsed.data;
        return catching(`GET ${apiPaths.fetchAgentsWorktreeConversationHistory}`, () => apiGetAgentsWorktreeHistory(name));
      },
    },

    [apiPaths.sendAgentsWorktreeConversationMessage]: {
      POST: (req) => {
        const parsed = parseWorktreeNameParam(req.params);
        if (!parsed.ok) return parsed.response;
        const name = parsed.data;
        return catching(
          `POST ${apiPaths.sendAgentsWorktreeConversationMessage}`,
          () => apiSendAgentsWorktreeMessage(name, req),
        );
      },
    },

    [apiPaths.interruptAgentsWorktreeConversation]: {
      POST: (req) => {
        const parsed = parseWorktreeNameParam(req.params);
        if (!parsed.ok) return parsed.response;
        const name = parsed.data;
        return catching(
          `POST ${apiPaths.interruptAgentsWorktreeConversation}`,
          () => apiInterruptAgentsWorktree(name),
        );
      },
    },

    "/api/runtime/events": {
      POST: (req) => catching("POST /api/runtime/events", () => apiRuntimeEvent(req)),
    },

    [apiPaths.fetchWorktrees]: {
      GET: () => catching("GET /api/worktrees", () => apiGetWorktrees()),
      POST: (req) => catching("POST /api/worktrees", () => apiCreateWorktree(req)),
    },

    [apiPaths.removeWorktree]: {
      DELETE: (req) => {
        const parsed = parseWorktreeNameParam(req.params);
        if (!parsed.ok) return parsed.response;
        const name = parsed.data;
        return catching(`DELETE /api/worktrees/${name}`, () => apiDeleteWorktree(name));
      },
    },

    [apiPaths.openWorktree]: {
      POST: (req) => {
        const parsed = parseWorktreeNameParam(req.params);
        if (!parsed.ok) return parsed.response;
        const name = parsed.data;
        return catching(`POST /api/worktrees/${name}/open`, () => apiOpenWorktree(name));
      },
    },

    "/api/worktrees/:name/terminal-launch": {
      GET: (req) => {
        const parsed = parseWorktreeNameParam(req.params);
        if (!parsed.ok) return parsed.response;
        const name = parsed.data;
        return catching(`GET /api/worktrees/${name}/terminal-launch`, () => apiGetNativeTerminalLaunch(name));
      },
    },

    [apiPaths.closeWorktree]: {
      POST: (req) => {
        const parsed = parseWorktreeNameParam(req.params);
        if (!parsed.ok) return parsed.response;
        const name = parsed.data;
        return catching(`POST /api/worktrees/${name}/close`, () => apiCloseWorktree(name));
      },
    },

    [apiPaths.setWorktreeArchived]: {
      PUT: (req) => {
        const parsed = parseWorktreeNameParam(req.params);
        if (!parsed.ok) return parsed.response;
        const name = parsed.data;
        return catching(`PUT /api/worktrees/${name}/archive`, () => apiSetWorktreeArchived(name, req));
      },
    },

    [apiPaths.sendWorktreePrompt]: {
      POST: (req) => {
        const parsed = parseWorktreeNameParam(req.params);
        if (!parsed.ok) return parsed.response;
        const name = parsed.data;
        return catching(`POST /api/worktrees/${name}/send`, () => apiSendPrompt(name, req));
      },
    },

    "/api/worktrees/:name/upload": {
      POST: (req) => {
        const parsed = parseWorktreeNameParam(req.params);
        if (!parsed.ok) return parsed.response;
        const name = parsed.data;
        return catching(`POST /api/worktrees/${name}/upload`, () => apiUploadFiles(name, req));
      },
    },

    [apiPaths.mergeWorktree]: {
      POST: (req) => {
        const parsed = parseWorktreeNameParam(req.params);
        if (!parsed.ok) return parsed.response;
        const name = parsed.data;
        return catching(`POST /api/worktrees/${name}/merge`, () => apiMergeWorktree(name));
      },
    },

    [apiPaths.fetchWorktreeDiff]: {
      GET: (req) => {
        const parsed = parseWorktreeNameParam(req.params);
        if (!parsed.ok) return parsed.response;
        const name = parsed.data;
        return catching(`GET /api/worktrees/${name}/diff`, () => apiGetWorktreeDiff(name));
      },
    },

    [apiPaths.fetchLinearIssues]: {
      GET: () => catching("GET /api/linear/issues", () => apiGetLinearIssues()),
    },

    [apiPaths.setLinearAutoCreate]: {
      PUT: (req) => catching("PUT /api/linear/auto-create", () => apiSetLinearAutoCreate(req)),
    },

    [apiPaths.setAutoRemoveOnMerge]: {
      PUT: (req) => catching("PUT /api/github/auto-remove-on-merge", () => apiSetAutoRemoveOnMerge(req)),
    },

    [apiPaths.pullMain]: {
      POST: (req) => catching("POST /api/pull-main", () => apiPullMain(req)),
    },

    [apiPaths.fetchCiLogs]: {
      GET: (req) => {
        const parsed = parseRunIdParam(req.params);
        if (!parsed.ok) return parsed.response;
        return catching(`GET /api/ci-logs/${parsed.data}`, () => apiCiLogs(parsed.data));
      },
    },

    "/api/notifications/stream": {
      GET: () => runtimeNotifications.stream(),
    },

    [apiPaths.dismissNotification]: {
      POST: (req) => {
        const parsed = parseNotificationIdParam(req.params);
        if (!parsed.ok) return parsed.response;
        const id = parsed.data;
        if (!runtimeNotifications.dismiss(id)) return errorResponse("Not found", 404);
        return jsonResponse({ ok: true });
      },
    },
  },

  async fetch(req) {
    const url = new URL(req.url);
    // Static frontend files in production mode (fallback for unmatched routes)
    if (STATIC_DIR) {
      const rawPath = url.pathname === "/" ? "index.html" : url.pathname;
      const filePath = join(STATIC_DIR, rawPath);
      const staticRoot = resolve(STATIC_DIR);
      // Path traversal protection: resolved path must stay within STATIC_DIR
      if (!resolve(filePath).startsWith(staticRoot + "/")) {
        return new Response("Forbidden", { status: 403 });
      }
      const file = Bun.file(filePath);
      if (await file.exists()) {
        // Vite-hashed assets are immutable — cache forever
        const headers: HeadersInit = rawPath.startsWith("/assets/")
          ? { "Cache-Control": "public, max-age=31536000, immutable" }
          : {};
        return new Response(file, { headers });
      }
      // SPA fallback: serve index.html (never cache so new deploys take effect)
      return new Response(Bun.file(join(STATIC_DIR, "index.html")), {
        headers: { "Cache-Control": "no-cache" },
      });
    }
    return new Response("Not Found", { status: 404 });
  },

  websocket: {
    // WebSocket-specific timeout; keepalive pings prevent idle tab disconnects.
    idleTimeout: 255,
    sendPings: true,
    // Type ws.data via the data property (Bun.serve<T> generic is deprecated)
    data: {} as WsData,

    open(ws) {
      const data = ws.data;
      if (data.kind === "terminal") {
        log.debug(`[ws] open branch=${data.branch}`);
        return;
      }

      log.debug(`[ws:agents] open branch=${data.branch}`);
      void openAgentsSocket(ws, data);
    },

    async message(ws, message) {
      const data = ws.data;
      if (data.kind === "agents") {
        log.debug(`[ws:agents] ignoring inbound message branch=${data.branch}`);
        return;
      }

      const msg = parseWsMessage(message);
      if (!msg) {
        sendWs(ws, { type: "error", message: "malformed message" });
        return;
      }
      const { branch } = data;

      switch (msg.type) {
        case "input": {
          const attachId = getAttachedSessionId(data, ws);
          if (!attachId) return;
          write(attachId, msg.data);
          break;
        }
        case "sendKeys": {
          const attachId = getAttachedSessionId(data, ws);
          if (!attachId) return;
          await sendKeys(attachId, msg.hexBytes);
          break;
        }
        case "selectPane":
          {
            const attachId = getAttachedSessionId(data, ws);
            if (!attachId) return;
            log.debug(`[ws] selectPane pane=${msg.pane} branch=${branch} attachId=${attachId}`);
            await selectPane(attachId, msg.pane);
          }
          break;
        case "resize":
          if (!data.attached) {
            // First resize = client reporting actual dimensions. Attach now.
            data.attached = true;
            log.debug(`[ws] first resize (attaching) branch=${branch} cols=${msg.cols} rows=${msg.rows}`);
            try {
              if (msg.initialPane !== undefined) {
                log.debug(`[ws] initialPane=${msg.initialPane} branch=${branch}`);
              }
              const terminalWorktree = await resolveTerminalWorktree(branch);
              const attachId = `${terminalWorktree.worktreeId}:${randomUUID()}`;
              data.worktreeId = terminalWorktree.worktreeId;
              data.attachId = attachId;
              await attach(
                attachId,
                terminalWorktree.attachTarget,
                msg.cols,
                msg.rows,
                msg.initialPane,
              );
              const { onData, onExit } = makeCallbacks(ws);
              setCallbacks(attachId, onData, onExit);
              const scrollback = getScrollback(attachId);
              log.debug(
                `[ws] attached branch=${branch} worktreeId=${terminalWorktree.worktreeId} attachId=${attachId} scrollback=${scrollback.length} bytes`,
              );
              if (scrollback.length > 0) {
                sendWs(ws, { type: "scrollback", data: scrollback });
              }
            } catch (err: unknown) {
              const errMsg = err instanceof Error ? err.message : String(err);
              data.attached = false;
              data.worktreeId = null;
              data.attachId = null;
              log.error(`[ws] attach failed branch=${branch}: ${errMsg}`);
              sendWs(ws, { type: "error", message: errMsg });
              ws.close(1011, errMsg.slice(0, 123)); // 1011 = Internal Error
            }
          } else {
            const attachId = getAttachedSessionId(data, ws);
            if (!attachId) return;
            await resize(attachId, msg.cols, msg.rows);
          }
          break;
      }
    },

    async close(ws, code, reason) {
      const data = ws.data;
      if (data.kind === "agents") {
        log.debug(`[ws:agents] close branch=${data.branch} code=${code} reason=${reason}`);
        data.unsubscribe?.();
        data.unsubscribe = null;
        return;
      }

      log.debug(
        `[ws] close branch=${data.branch} code=${code} reason=${reason} attached=${data.attached} worktreeId=${data.worktreeId} attachId=${data.attachId}`,
      );
      if (data.attachId) {
        clearCallbacks(data.attachId);
        await detach(data.attachId);
      }
    },
  },
});


// Ensure tmux server is running (needs at least one session to persist)
const tmuxCheck = Bun.spawnSync(["tmux", "list-sessions"], { stdout: "pipe", stderr: "pipe" });
if (tmuxCheck.exitCode !== 0) {
  Bun.spawnSync(["tmux", "new-session", "-d", "-s", "0"]);
  log.info("Started tmux session");
}

cleanupStaleSessions();
startPrMonitor(getWorktreeGitDirs, config.integrations.github.linkedRepos, PROJECT_DIR, undefined, hasRecentDashboardActivity, async () => {
  if (autoRemoveOnMergeEnabled) {
    await runAutoRemove(autoRemoveDeps);
  }
});
if (linearAutoCreateEnabled) {
  startLinearAutoCreate();
}
if (config.workspace.autoPull.enabled) {
  startAutoPullMonitor(
    { git, projectRoot: PROJECT_DIR, mainBranch: config.workspace.mainBranch },
    config.workspace.autoPull.intervalSeconds * 1000,
  );
}

log.info(`Dev Dashboard API running at http://localhost:${PORT}`);
const nets = networkInterfaces();
for (const addrs of Object.values(nets)) {
  for (const a of addrs ?? []) {
    if (a.family === "IPv4" && !a.internal) {
      log.info(`  Network: http://${a.address}:${PORT}`);
    }
  }
}
