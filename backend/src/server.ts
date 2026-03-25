import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { log } from "./lib/log";
import {
  attach,
  detach,
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
import { getDefaultProfileName, persistLocalLinearConfig, persistLocalGitHubConfig, type ProjectConfig } from "./adapters/config";
import { jsonResponse, errorResponse } from "./lib/http";
import { hasRecentDashboardActivity, touchDashboardActivity } from "./services/dashboard-activity";
import {
  branchMatchesIssue,
  buildLinearIssuesResponse,
  createLinearIssue,
  deriveLinearIssueTitle,
  fetchAssignedIssues,
} from "./services/linear-service";
import { LifecycleError } from "./services/lifecycle-service";
import { buildNativeTerminalLaunch, buildNativeTerminalTmuxCommand } from "./services/native-terminal-service";
import { startPrMonitor } from "./services/pr-service";
import { startLinearAutoCreateMonitor, resetProcessedIssues } from "./services/linear-auto-create-service";
import { runAutoRemove, type AutoRemoveDependencies } from "./services/auto-remove-service";
import { pullMainBranch, forcePullMainBranch, startAutoPullMonitor } from "./services/auto-pull-service";
import { buildProjectSnapshot } from "./services/snapshot-service";
import { parseRuntimeEvent } from "./domain/events";
import { isValidBranchName, isValidWorktreeName } from "./domain/policies";
import { createWebmuxRuntime } from "./runtime";

const PORT = parseInt(Bun.env.PORT || "5111", 10);
const STATIC_DIR = Bun.env.WEBMUX_STATIC_DIR || "";
const runtime = createWebmuxRuntime({
  port: PORT,
  projectDir: Bun.env.WEBMUX_PROJECT_DIR || process.cwd(),
});
const PROJECT_DIR = runtime.projectDir;
const config: ProjectConfig = runtime.config;
const git = runtime.git;
const tmux = runtime.tmux;
const projectRuntime = runtime.projectRuntime;
const worktreeCreationTracker = runtime.worktreeCreationTracker;
const runtimeNotifications = runtime.runtimeNotifications;
const reconciliationService = runtime.reconciliationService;
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
  defaultProfileName: string;
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
    defaultProfileName,
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

interface WsData {
  branch: string;
  worktreeId: string | null;
  attachId: string | null;
  attached: boolean;
}

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
    if (!msg || typeof msg !== "object") return null;
    const m = msg as Record<string, unknown>;
    switch (m.type) {
      case "input":
        return typeof m.data === "string" ? { type: "input", data: m.data } : null;
      case "sendKeys":
        return Array.isArray(m.hexBytes) && m.hexBytes.every((b: unknown) => typeof b === "string")
          ? { type: "sendKeys", hexBytes: m.hexBytes as string[] }
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

function getAttachedSessionId(ws: { data: WsData; readyState: number; send: (data: string) => void }): string | null {
  if (ws.data.attached && ws.data.attachId) {
    return ws.data.attachId;
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

// --- API handler functions (thin I/O layer, testable by injecting deps) ---

async function apiGetProject(): Promise<Response> {
  touchDashboardActivity();
  const linearApiKey = Bun.env.LINEAR_API_KEY;
  const linearIssuesPromise = config.integrations.linear.enabled && linearApiKey?.trim()
    ? fetchAssignedIssues()
    : Promise.resolve({ ok: true as const, data: [] });
  const [, linearResult] = await Promise.all([
    reconciliationService.reconcile(PROJECT_DIR),
    linearIssuesPromise,
  ]);
  const linearIssues = linearResult.ok ? linearResult.data : [];
  return jsonResponse(buildProjectSnapshot({
    projectName: config.name,
    mainBranch: config.workspace.mainBranch,
    runtime: projectRuntime,
    creatingWorktrees: worktreeCreationTracker.list(),
    notifications: runtimeNotifications.list(),
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
  }));
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
  const includeRemote = new URL(req.url).searchParams.get("includeRemote") === "true";
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
  const raw: unknown = await req.json();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return errorResponse("Invalid request body", 400);
  }
  const body = raw as Record<string, unknown>;

  // Parse envOverrides: must be a plain object with string keys and values
  let envOverrides: Record<string, string> | undefined;
  if (body.envOverrides && typeof body.envOverrides === "object" && !Array.isArray(body.envOverrides)) {
    const raw = body.envOverrides as Record<string, unknown>;
    const parsed: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === "string") parsed[k] = v;
    }
    if (Object.keys(parsed).length > 0) envOverrides = parsed;
  }

  const branch = typeof body.branch === "string" && body.branch.trim() ? body.branch.trim() : undefined;
  const baseBranch = typeof body.baseBranch === "string" && body.baseBranch.trim() ? body.baseBranch.trim() : undefined;
  const prompt = typeof body.prompt === "string" && body.prompt.trim() ? body.prompt.trim() : undefined;
  const profile = typeof body.profile === "string" ? body.profile : undefined;
  const agent = body.agent === "claude" || body.agent === "codex" ? body.agent : undefined;
  const createLinearTicket = body.createLinearTicket === true;
  const linearTitle = typeof body.linearTitle === "string" && body.linearTitle.trim()
    ? body.linearTitle.trim()
    : undefined;
  const mode = body.mode === "new" || body.mode === "existing" ? body.mode : undefined;

  if (body.mode !== undefined && body.mode !== "new" && body.mode !== "existing") {
    return errorResponse("Invalid worktree create mode", 400);
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
    ensureBranchNotCreating(resolvedBranch);
    log.info(
      `[linear] created ticket ${linearResult.data.identifier} branch=${linearResult.data.branchName} title="${linearResult.data.title.slice(0, 80)}"`,
    );
  } else if (resolvedBranch) {
    ensureBranchNotCreating(resolvedBranch);
  }

  if (resolvedBranch && baseBranch && resolvedBranch === baseBranch) {
    return errorResponse("Base branch must differ from branch name", 400);
  }

  log.info(
    `[worktree:add] mode=${mode ?? "new"}${resolvedBranch ? ` branch=${resolvedBranch}` : ""}${baseBranch ? ` base=${baseBranch}` : ""}${profile ? ` profile=${profile}` : ""}${agent ? ` agent=${agent}` : ""}${createLinearTicket ? " linearTicket=true" : ""}${prompt ? ` prompt="${prompt.slice(0, 80)}"` : ""}`,
  );
  const result = await lifecycleService.createWorktree({
    mode,
    branch: resolvedBranch,
    baseBranch,
    prompt,
    profile,
    agent,
    envOverrides,
  });
  log.debug(`[worktree:add] done branch=${result.branch} worktreeId=${result.worktreeId}`);
  return jsonResponse({ branch: result.branch }, 201);
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

async function apiSendPrompt(name: string, req: Request): Promise<Response> {
  ensureBranchNotBusy(name);
  const raw: unknown = await req.json();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return errorResponse("Invalid request body", 400);
  }
  const body = raw as Record<string, unknown>;
  const text = typeof body.text === "string" ? body.text : "";
  if (!text) return errorResponse("Missing 'text' field", 400);
  const preamble = typeof body.preamble === "string" ? body.preamble : undefined;
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

async function apiSetLinearAutoCreate(req: Request): Promise<Response> {
  const raw: unknown = await req.json();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return errorResponse("Invalid request body", 400);
  }
  const body = raw as Record<string, unknown>;
  if (typeof body.enabled !== "boolean") {
    return errorResponse("Missing boolean 'enabled' field", 400);
  }

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
  const raw: unknown = await req.json();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return errorResponse("Invalid request body", 400);
  }
  const body = raw as Record<string, unknown>;
  if (typeof body.enabled !== "boolean") {
    return errorResponse("Missing boolean 'enabled' field", 400);
  }

  autoRemoveOnMergeEnabled = body.enabled;
  log.info(`[config] Auto-remove on merge ${autoRemoveOnMergeEnabled ? "enabled" : "disabled"}`);

  await persistLocalGitHubConfig(PROJECT_DIR, { autoRemoveOnMerge: autoRemoveOnMergeEnabled });

  return jsonResponse({ ok: true, enabled: autoRemoveOnMergeEnabled });
}

async function apiPullMain(req: Request): Promise<Response> {
  const raw: unknown = await req.json().catch(() => ({}));
  const body = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const force = body.force === true;
  const repo = typeof body.repo === "string" ? body.repo : "";

  let projectRoot = PROJECT_DIR;
  if (repo) {
    const linkedRepo = config.integrations.github.linkedRepos.find((lr) => lr.alias === repo);
    if (!linkedRepo) return errorResponse(`Unknown linked repo: ${repo}`, 404);
    if (!linkedRepo.dir) return errorResponse(`Linked repo "${repo}" has no dir configured`, 400);
    projectRoot = resolve(PROJECT_DIR, linkedRepo.dir);
    if (!projectRoot.startsWith(PROJECT_DIR)) {
      return errorResponse("Invalid linked repo directory", 400);
    }
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
  const unpushedCommits = git.listUnpushedCommits(state.path);

  const truncated = uncommitted.length > MAX_DIFF_BYTES;
  return jsonResponse({
    uncommitted: truncated ? uncommitted.slice(0, MAX_DIFF_BYTES) : uncommitted,
    uncommittedTruncated: truncated,
    unpushedCommits,
  });
}

async function apiCiLogs(runId: string): Promise<Response> {
  if (!/^\d+$/.test(runId)) return errorResponse("Invalid run ID", 400);
  const proc = Bun.spawn(["gh", "run", "view", runId, "--log-failed"], {
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

// --- Server ---

Bun.serve({
  port: PORT,
  idleTimeout: 255, // seconds; worktree removal can take >10s

  routes: {
    "/ws/:worktree": (req, server) => {
      const branch = decodeURIComponent(req.params.worktree);
      return server.upgrade(req, { data: { branch, worktreeId: null, attachId: null, attached: false } })
        ? undefined
        : new Response("WebSocket upgrade failed", { status: 400 });
    },

    "/api/config": {
      GET: () => jsonResponse(getFrontendConfig()),
    },

    "/api/branches": {
      GET: (req) => catching("GET /api/branches", () => apiListBranches(req)),
    },

    "/api/base-branches": {
      GET: () => catching("GET /api/base-branches", () => apiListBaseBranches()),
    },

    "/api/project": {
      GET: () => catching("GET /api/project", () => apiGetProject()),
    },

    "/api/runtime/events": {
      POST: (req) => catching("POST /api/runtime/events", () => apiRuntimeEvent(req)),
    },

    "/api/worktrees": {
      POST: (req) => catching("POST /api/worktrees", () => apiCreateWorktree(req)),
    },

    "/api/worktrees/:name": {
      DELETE: (req) => {
        const name = decodeURIComponent(req.params.name);
        if (!isValidWorktreeName(name)) return errorResponse("Invalid worktree name", 400);
        return catching(`DELETE /api/worktrees/${name}`, () => apiDeleteWorktree(name));
      },
    },

    "/api/worktrees/:name/open": {
      POST: (req) => {
        const name = decodeURIComponent(req.params.name);
        if (!isValidWorktreeName(name)) return errorResponse("Invalid worktree name", 400);
        return catching(`POST /api/worktrees/${name}/open`, () => apiOpenWorktree(name));
      },
    },

    "/api/worktrees/:name/terminal-launch": {
      GET: (req) => {
        const name = decodeURIComponent(req.params.name);
        if (!isValidWorktreeName(name)) return errorResponse("Invalid worktree name", 400);
        return catching(`GET /api/worktrees/${name}/terminal-launch`, () => apiGetNativeTerminalLaunch(name));
      },
    },

    "/api/worktrees/:name/close": {
      POST: (req) => {
        const name = decodeURIComponent(req.params.name);
        if (!isValidWorktreeName(name)) return errorResponse("Invalid worktree name", 400);
        return catching(`POST /api/worktrees/${name}/close`, () => apiCloseWorktree(name));
      },
    },

    "/api/worktrees/:name/send": {
      POST: (req) => {
        const name = decodeURIComponent(req.params.name);
        if (!isValidWorktreeName(name)) return errorResponse("Invalid worktree name", 400);
        return catching(`POST /api/worktrees/${name}/send`, () => apiSendPrompt(name, req));
      },
    },

    "/api/worktrees/:name/upload": {
      POST: (req) => {
        const name = decodeURIComponent(req.params.name);
        if (!isValidWorktreeName(name)) return errorResponse("Invalid worktree name", 400);
        return catching(`POST /api/worktrees/${name}/upload`, () => apiUploadFiles(name, req));
      },
    },

    "/api/worktrees/:name/merge": {
      POST: (req) => {
        const name = decodeURIComponent(req.params.name);
        if (!isValidWorktreeName(name)) return errorResponse("Invalid worktree name", 400);
        return catching(`POST /api/worktrees/${name}/merge`, () => apiMergeWorktree(name));
      },
    },

    "/api/worktrees/:name/diff": {
      GET: (req) => {
        const name = decodeURIComponent(req.params.name);
        if (!isValidWorktreeName(name)) return errorResponse("Invalid worktree name", 400);
        return catching(`GET /api/worktrees/${name}/diff`, () => apiGetWorktreeDiff(name));
      },
    },

    "/api/linear/issues": {
      GET: () => catching("GET /api/linear/issues", () => apiGetLinearIssues()),
    },

    "/api/linear/auto-create": {
      PUT: (req) => catching("PUT /api/linear/auto-create", () => apiSetLinearAutoCreate(req)),
    },

    "/api/github/auto-remove-on-merge": {
      PUT: (req) => catching("PUT /api/github/auto-remove-on-merge", () => apiSetAutoRemoveOnMerge(req)),
    },

    "/api/pull-main": {
      POST: (req) => catching("POST /api/pull-main", () => apiPullMain(req)),
    },

    "/api/ci-logs/:runId": {
      GET: (req) => catching(`GET /api/ci-logs/${req.params.runId}`, () => apiCiLogs(req.params.runId)),
    },

    "/api/notifications/stream": {
      GET: () => runtimeNotifications.stream(),
    },

    "/api/notifications/:id/dismiss": {
      POST: (req) => {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) return errorResponse("Invalid notification ID", 400);
        if (!runtimeNotifications.dismiss(id)) return errorResponse("Not found", 404);
        return jsonResponse({ ok: true });
      },
    },
  },

  async fetch(req) {
    // Static frontend files in production mode (fallback for unmatched routes)
    if (STATIC_DIR) {
      const url = new URL(req.url);
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
      log.debug(`[ws] open branch=${ws.data.branch}`);
    },

    async message(ws, message) {
      const msg = parseWsMessage(message);
      if (!msg) {
        sendWs(ws, { type: "error", message: "malformed message" });
        return;
      }
      const { branch } = ws.data;

      switch (msg.type) {
        case "input": {
          const attachId = getAttachedSessionId(ws);
          if (!attachId) return;
          write(attachId, msg.data);
          break;
        }
        case "sendKeys": {
          const attachId = getAttachedSessionId(ws);
          if (!attachId) return;
          await sendKeys(attachId, msg.hexBytes);
          break;
        }
        case "selectPane":
          {
            const attachId = getAttachedSessionId(ws);
            if (!attachId) return;
            log.debug(`[ws] selectPane pane=${msg.pane} branch=${branch} attachId=${attachId}`);
            await selectPane(attachId, msg.pane);
          }
          break;
        case "resize":
          if (!ws.data.attached) {
            // First resize = client reporting actual dimensions. Attach now.
            ws.data.attached = true;
            log.debug(`[ws] first resize (attaching) branch=${branch} cols=${msg.cols} rows=${msg.rows}`);
            try {
              if (msg.initialPane !== undefined) {
                log.debug(`[ws] initialPane=${msg.initialPane} branch=${branch}`);
              }
              const terminalWorktree = await resolveTerminalWorktree(branch);
              const attachId = `${terminalWorktree.worktreeId}:${randomUUID()}`;
              ws.data.worktreeId = terminalWorktree.worktreeId;
              ws.data.attachId = attachId;
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
              ws.data.attached = false;
              ws.data.worktreeId = null;
              ws.data.attachId = null;
              log.error(`[ws] attach failed branch=${branch}: ${errMsg}`);
              sendWs(ws, { type: "error", message: errMsg });
              ws.close(1011, errMsg.slice(0, 123)); // 1011 = Internal Error
            }
          } else {
            const attachId = getAttachedSessionId(ws);
            if (!attachId) return;
            await resize(attachId, msg.cols, msg.rows);
          }
          break;
      }
    },

    async close(ws, code, reason) {
      log.debug(
        `[ws] close branch=${ws.data.branch} code=${code} reason=${reason} attached=${ws.data.attached} worktreeId=${ws.data.worktreeId} attachId=${ws.data.attachId}`,
      );
      if (ws.data.attachId) {
        clearCallbacks(ws.data.attachId);
        await detach(ws.data.attachId);
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
