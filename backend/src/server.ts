import { join, resolve } from "node:path";
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
import {
  BunGitGateway,
} from "./adapters/git";
import { loadConfig, getDefaultProfileName, gitRoot, type ProjectConfig } from "./adapters/config";
import { loadControlToken } from "./adapters/control-token";
import { BunDockerGateway } from "./adapters/docker";
import { BunLifecycleHookRunner } from "./adapters/hooks";
import { BunPortProbe } from "./adapters/port-probe";
import {
  BunTmuxGateway,
} from "./adapters/tmux";
import { jsonResponse, errorResponse } from "./lib/http";
import { hasRecentDashboardActivity, touchDashboardActivity } from "./services/dashboard-activity";
import { fetchAssignedIssues } from "./services/linear-service";
import { NotificationService as RuntimeNotificationService } from "./services/notification-service";
import { LifecycleError, LifecycleService } from "./services/lifecycle-service";
import { startPrMonitor } from "./services/pr-service";
import { ProjectRuntime } from "./services/project-runtime";
import { ReconciliationService } from "./services/reconciliation-service";
import { buildProjectSnapshot } from "./services/snapshot-service";
import { parseRuntimeEvent } from "./domain/events";

const PORT = parseInt(Bun.env.BACKEND_PORT || "5111", 10);
const STATIC_DIR = Bun.env.WEBMUX_STATIC_DIR || "";
const PROJECT_DIR = Bun.env.WEBMUX_PROJECT_DIR || gitRoot(process.cwd());
const config: ProjectConfig = loadConfig(PROJECT_DIR);
const git = new BunGitGateway();
const portProbe = new BunPortProbe();
const tmux = new BunTmuxGateway();
const docker = new BunDockerGateway();
const hooks = new BunLifecycleHookRunner();
const projectRuntime = new ProjectRuntime();
const runtimeNotifications = new RuntimeNotificationService();
const reconciliationService = new ReconciliationService({
  config,
  git,
  tmux,
  portProbe,
  runtime: projectRuntime,
});
const lifecycleService = new LifecycleService({
  projectRoot: PROJECT_DIR,
  controlBaseUrl: `http://127.0.0.1:${PORT}`,
  getControlToken: loadControlToken,
  config,
  git,
  tmux,
  docker,
  reconciliation: reconciliationService,
  hooks,
});

function getFrontendConfig(): {
  name: string;
  services: ProjectConfig["services"];
  profiles: Array<{ name: string; systemPrompt?: string }>;
  defaultProfileName: string;
  autoName: boolean;
  startupEnvs: ProjectConfig["startupEnvs"];
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
    autoName: false,
    startupEnvs: config.startupEnvs,
  };
}

// --- WebSocket protocol types ---

interface WsData {
  branch: string;
  worktreeId: string | null;
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

function isValidWorktreeName(name: string): boolean {
  return name.length > 0 && /^[a-z0-9][a-z0-9\-_./]*$/.test(name) && !name.includes("..");
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

async function resolveTerminalWorktree(branch: string): Promise<{
  worktreeId: string;
  attachTarget: TerminalAttachTarget;
}> {
  await reconciliationService.reconcile(PROJECT_DIR);
  const state = projectRuntime.getWorktreeByBranch(branch);
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

function getAttachedWorktreeId(ws: { data: WsData; readyState: number; send: (data: string) => void }): string | null {
  if (ws.data.attached && ws.data.worktreeId) {
    return ws.data.worktreeId;
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
  await reconciliationService.reconcile(PROJECT_DIR);
  return jsonResponse(buildProjectSnapshot({
    projectName: config.name,
    mainBranch: config.workspace.mainBranch,
    runtime: projectRuntime,
    notifications: runtimeNotifications.list(),
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

  await reconciliationService.reconcile(PROJECT_DIR);

  try {
    projectRuntime.applyEvent(event);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Unknown worktree id")) {
      return errorResponse(message, 404);
    }
    throw error;
  }

  const notification = runtimeNotifications.recordEvent(event);
  return jsonResponse({
    ok: true,
    ...(notification ? { notification } : {}),
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

  const branch = typeof body.branch === "string" ? body.branch : undefined;
  const prompt = typeof body.prompt === "string" ? body.prompt : undefined;
  const profile = typeof body.profile === "string" ? body.profile : undefined;
  const agent = body.agent === "claude" || body.agent === "codex" ? body.agent : undefined;

  log.info(
    `[worktree:add]${branch ? ` branch=${branch}` : ""}${profile ? ` profile=${profile}` : ""}${agent ? ` agent=${agent}` : ""}${prompt ? ` prompt="${prompt.slice(0, 80)}"` : ""}`,
  );
  const result = await lifecycleService.createWorktree({
    branch,
    prompt,
    profile,
    agent,
    envOverrides,
  });
  log.debug(`[worktree:add] done branch=${result.branch} worktreeId=${result.worktreeId}`);
  return jsonResponse({ branch: result.branch }, 201);
}

async function apiDeleteWorktree(name: string): Promise<Response> {
  log.info(`[worktree:rm] name=${name}`);
  await lifecycleService.removeWorktree(name);
  log.debug(`[worktree:rm] done name=${name}`);
  return jsonResponse({ ok: true });
}

async function apiOpenWorktree(name: string): Promise<Response> {
  log.info(`[worktree:open] name=${name}`);
  const result = await lifecycleService.openWorktree(name);
  log.debug(`[worktree:open] done name=${name} worktreeId=${result.worktreeId}`);
  return jsonResponse({ ok: true });
}

async function apiSendPrompt(name: string, req: Request): Promise<Response> {
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
  log.info(`[worktree:merge] name=${name}`);
  await lifecycleService.mergeWorktree(name);
  log.debug(`[worktree:merge] done name=${name}`);
  return jsonResponse({ ok: true });
}

async function apiGetLinearIssues(): Promise<Response> {
  const result = await fetchAssignedIssues();
  if (!result.ok) return errorResponse(result.error, 502);
  return jsonResponse(result.data);
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

// --- Server ---

Bun.serve({
  port: PORT,
  idleTimeout: 255, // seconds; worktree removal can take >10s

  routes: {
    "/ws/:worktree": (req, server) => {
      const branch = decodeURIComponent(req.params.worktree);
      return server.upgrade(req, { data: { branch, worktreeId: null, attached: false } })
        ? undefined
        : new Response("WebSocket upgrade failed", { status: 400 });
    },

    "/api/config": {
      GET: () => jsonResponse(getFrontendConfig()),
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

    "/api/worktrees/:name/send": {
      POST: (req) => {
        const name = decodeURIComponent(req.params.name);
        if (!isValidWorktreeName(name)) return errorResponse("Invalid worktree name", 400);
        return catching(`POST /api/worktrees/${name}/send`, () => apiSendPrompt(name, req));
      },
    },

    "/api/worktrees/:name/merge": {
      POST: (req) => {
        const name = decodeURIComponent(req.params.name);
        if (!isValidWorktreeName(name)) return errorResponse("Invalid worktree name", 400);
        return catching(`POST /api/worktrees/${name}/merge`, () => apiMergeWorktree(name));
      },
    },

    "/api/linear/issues": {
      GET: () => catching("GET /api/linear/issues", () => apiGetLinearIssues()),
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
          const worktreeId = getAttachedWorktreeId(ws);
          if (!worktreeId) return;
          write(worktreeId, msg.data);
          break;
        }
        case "sendKeys": {
          const worktreeId = getAttachedWorktreeId(ws);
          if (!worktreeId) return;
          await sendKeys(worktreeId, msg.hexBytes);
          break;
        }
        case "selectPane":
          {
            const worktreeId = getAttachedWorktreeId(ws);
            if (!worktreeId) return;
            log.debug(`[ws] selectPane pane=${msg.pane} branch=${branch} worktreeId=${worktreeId}`);
            await selectPane(worktreeId, msg.pane);
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
              ws.data.worktreeId = terminalWorktree.worktreeId;
              await attach(
                terminalWorktree.worktreeId,
                terminalWorktree.attachTarget,
                msg.cols,
                msg.rows,
                msg.initialPane,
              );
              const { onData, onExit } = makeCallbacks(ws);
              setCallbacks(terminalWorktree.worktreeId, onData, onExit);
              const scrollback = getScrollback(terminalWorktree.worktreeId);
              log.debug(
                `[ws] attached branch=${branch} worktreeId=${terminalWorktree.worktreeId} scrollback=${scrollback.length} bytes`,
              );
              if (scrollback.length > 0) {
                sendWs(ws, { type: "scrollback", data: scrollback });
              }
            } catch (err: unknown) {
              const errMsg = err instanceof Error ? err.message : String(err);
              ws.data.attached = false;
              ws.data.worktreeId = null;
              log.error(`[ws] attach failed branch=${branch}: ${errMsg}`);
              sendWs(ws, { type: "error", message: errMsg });
              ws.close(1011, errMsg.slice(0, 123)); // 1011 = Internal Error
            }
          } else {
            const worktreeId = getAttachedWorktreeId(ws);
            if (!worktreeId) return;
            await resize(worktreeId, msg.cols, msg.rows);
          }
          break;
      }
    },

    async close(ws) {
      log.debug(`[ws] close branch=${ws.data.branch} attached=${ws.data.attached} worktreeId=${ws.data.worktreeId}`);
      if (ws.data.worktreeId) {
        clearCallbacks(ws.data.worktreeId);
        await detach(ws.data.worktreeId);
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
startPrMonitor(getWorktreeGitDirs, config.integrations.github.linkedRepos, PROJECT_DIR, undefined, hasRecentDashboardActivity);

log.info(`Dev Dashboard API running at http://localhost:${PORT}`);
const nets = networkInterfaces();
for (const addrs of Object.values(nets)) {
  for (const a of addrs ?? []) {
    if (a.family === "IPv4" && !a.internal) {
      log.info(`  Network: http://${a.address}:${PORT}`);
    }
  }
}
