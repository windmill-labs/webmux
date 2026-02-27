import { join, resolve } from "node:path";
import { networkInterfaces } from "node:os";
import { ts } from "./lib/utils";
import {
  listWorktrees,
  getStatus,
  addWorktree,
  removeWorktree,
  openWorktree,
  mergeWorktree,
  sendPrompt,
  readEnvLocal,
  parseWorktreePorcelain,
} from "./workmux";
import {
  attach,
  detach,
  write,
  resize,
  selectPane,
  getScrollback,
  setCallbacks,
  clearCallbacks,
  cleanupStaleSessions,
} from "./terminal";
import { loadConfig, gitRoot, type WmdevConfig } from "./config";
import { startPrMonitor, type PrEntry } from "./pr";
import { handleWorkmuxRpc } from "./rpc";
import { jsonResponse, errorResponse } from "./http";

const PORT = parseInt(Bun.env.DASHBOARD_PORT || "5111", 10);
const STATIC_DIR = Bun.env.WMDEV_STATIC_DIR || "";
const PROJECT_DIR = Bun.env.WMDEV_PROJECT_DIR || gitRoot(process.cwd());
const config: WmdevConfig = loadConfig(PROJECT_DIR);

// --- WebSocket protocol types ---

interface WsData {
  worktree: string;
  attached: boolean;
}

type WsInboundMessage =
  | { type: "input"; data: string }
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

function sendWs(ws: { send: (data: string) => void }, msg: WsOutboundMessage): void {
  ws.send(JSON.stringify(msg));
}

function isValidWorktreeName(name: string): boolean {
  return name.length > 0 && /^[a-z0-9][a-z0-9\-_./]*$/.test(name) && !name.includes("..");
}

/** Wrap an async API handler to catch and log unhandled errors. */
function catching(label: string, fn: () => Promise<Response>): Promise<Response> {
  return fn().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[api:error] ${label}: ${msg}`);
    return errorResponse(msg);
  });
}

function safeJsonParse<T>(str: string): T | null {
  try {
    return JSON.parse(str) as T;
  } catch {
    return null;
  }
}

// --- Process helpers ---

/** Map branch name → worktree directory using git worktree list.
 *  Skips the main working tree (always the first entry). */
async function getWorktreePaths(): Promise<Map<string, string>> {
  const proc = Bun.spawn(["git", "worktree", "list", "--porcelain"], { stdout: "pipe" });
  await proc.exited;
  const output = await new Response(proc.stdout).text();
  const all = parseWorktreePorcelain(output);
  const paths = new Map<string, string>();
  let isFirst = true;
  for (const [branch, path] of all) {
    // Skip the main working tree (first entry in porcelain output)
    if (isFirst) { isFirst = false; continue; }
    paths.set(branch, path);
    // Also map by directory basename (workmux uses basename as branch key)
    const basename = path.split("/").pop() ?? "";
    if (basename !== branch) paths.set(basename, path);
  }
  return paths;
}

/** Count tmux panes for a worktree window. */
async function getTmuxPaneCount(branch: string): Promise<number> {
  const proc = Bun.spawn(
    ["tmux", "list-panes", "-t", `wm-${branch}`, "-F", "#{pane_index}"],
    { stdout: "pipe", stderr: "pipe" }
  );
  const exitCode = await proc.exited;
  if (exitCode !== 0) return 0;
  const out = await new Response(proc.stdout).text();
  return out.trim().split("\n").filter(Boolean).length;
}

/** Check if a port has a service responding (not just a TCP handshake). */
function isPortListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => { resolve(false); }, 1000);
    fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) })
      .then(() => { clearTimeout(timeout); resolve(true); })
      .catch(() => { clearTimeout(timeout); resolve(false); });
  });
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

async function apiGetWorktrees(): Promise<Response> {
  const [worktrees, status, wtPaths] = await Promise.all([
    listWorktrees(),
    getStatus(),
    getWorktreePaths(),
  ]);
  const merged = await Promise.all(worktrees.map(async (wt) => {
    const st = status.find(s =>
      s.worktree.includes(wt.branch) || s.worktree.startsWith(wt.branch)
    );
    const wtDir = wtPaths.get(wt.branch);
    const env = wtDir ? await readEnvLocal(wtDir) : {};
    const services = await Promise.all(
      config.services.map(async (svc) => {
        const port = env[svc.portEnv] ? parseInt(env[svc.portEnv], 10) : null;
        const running = port !== null && port >= 1 && port <= 65535
          ? await isPortListening(port)
          : false;
        return { name: svc.name, port, running };
      })
    );
    return {
      ...wt,
      dir: wtDir ?? null,
      status: st?.status ?? "",
      elapsed: st?.elapsed ?? "",
      title: st?.title ?? "",
      profile: env.PROFILE || null,
      agentName: env.AGENT || null,
      services,
      paneCount: wt.mux === "✓" ? await getTmuxPaneCount(wt.branch) : 0,
      prs: env.PR_DATA ? (safeJsonParse<PrEntry[]>(env.PR_DATA) ?? []).map(pr => ({ ...pr, comments: pr.comments ?? [] })) : [],
    };
  }));
  return jsonResponse(merged);
}

async function apiCreateWorktree(req: Request): Promise<Response> {
  const raw: unknown = await req.json();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return errorResponse("Invalid request body", 400);
  }
  const body = raw as Record<string, unknown>;
  const branch = typeof body.branch === "string" ? body.branch : undefined;
  const prompt = typeof body.prompt === "string" ? body.prompt : undefined;
  const profileName = typeof body.profile === "string" ? body.profile : config.profiles.default.name;
  const agent = typeof body.agent === "string" ? body.agent : "claude";
  const isSandbox = config.profiles.sandbox !== undefined && profileName === config.profiles.sandbox.name;
  const profileConfig = isSandbox ? config.profiles.sandbox! : config.profiles.default;
  console.log(`[worktree:add] agent=${agent} profile=${profileName}${branch ? ` branch=${branch}` : ""}${prompt ? ` prompt="${prompt.slice(0, 80)}"` : ""}`);
  const result = await addWorktree(branch, {
    prompt,
    profile: profileName,
    agent,
    autoName: config.autoName,
    profileConfig,
    isSandbox,
    sandboxConfig: isSandbox ? config.profiles.sandbox : undefined,
    services: config.services,
    mainRepoDir: PROJECT_DIR,
  });
  if (!result.ok) return errorResponse(result.error, 422);
  console.log(`[worktree:add] done branch=${result.branch}: ${result.output}`);
  return jsonResponse({ branch: result.branch }, 201);
}

async function apiDeleteWorktree(name: string): Promise<Response> {
  console.log(`[worktree:rm] name=${name}`);
  const result = await removeWorktree(name);
  if (!result.ok) return errorResponse(result.error, 422);
  console.log(`[worktree:rm] done name=${name}: ${result.output}`);
  return jsonResponse({ message: result.output });
}

async function apiOpenWorktree(name: string): Promise<Response> {
  console.log(`[worktree:open] name=${name}`);
  const result = await openWorktree(name);
  if (!result.ok) return errorResponse(result.error, 422);
  return jsonResponse({ message: result.output });
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
  console.log(`[worktree:send] name=${name} text="${text.slice(0, 80)}"`);
  const result = await sendPrompt(name, text, 0, preamble);
  if (!result.ok) return errorResponse(result.error, 503);
  return jsonResponse({ ok: true });
}

async function apiMergeWorktree(name: string): Promise<Response> {
  console.log(`[worktree:merge] name=${name}`);
  const result = await mergeWorktree(name);
  if (!result.ok) return errorResponse(result.error, 422);
  console.log(`[worktree:merge] done name=${name}: ${result.output}`);
  return jsonResponse({ message: result.output });
}

async function apiWorktreeStatus(name: string): Promise<Response> {
  const statuses = await getStatus();
  const match = statuses.find(s => s.worktree.includes(name));
  if (!match) return errorResponse("Worktree status not found", 404);
  return jsonResponse(match);
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
      const worktree = decodeURIComponent(req.params.worktree);
      return server.upgrade(req, { data: { worktree, attached: false } })
        ? undefined
        : new Response("WebSocket upgrade failed", { status: 400 });
    },

    "/rpc/workmux": {
      POST: (req) => handleWorkmuxRpc(req),
    },

    "/api/config": {
      GET: () => jsonResponse(config),
    },

    "/api/worktrees": {
      GET: () => catching("GET /api/worktrees", apiGetWorktrees),
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

    "/api/worktrees/:name/status": {
      GET: (req) => {
        const name = decodeURIComponent(req.params.name);
        if (!isValidWorktreeName(name)) return errorResponse("Invalid worktree name", 400);
        return catching(`GET /api/worktrees/${name}/status`, () => apiWorktreeStatus(name));
      },
    },

    "/api/ci-logs/:runId": {
      GET: (req) => catching(`GET /api/ci-logs/${req.params.runId}`, () => apiCiLogs(req.params.runId)),
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
        return new Response(file);
      }
      // SPA fallback: serve index.html for unmatched routes
      return new Response(Bun.file(join(STATIC_DIR, "index.html")));
    }
    return new Response("Not Found", { status: 404 });
  },

  websocket: {
    // Type ws.data via the data property (Bun.serve<T> generic is deprecated)
    data: {} as WsData,

    open(ws) {
      console.log(`[ws:${ts()}] open worktree=${ws.data.worktree}`);
    },

    async message(ws, message) {
      const msg = parseWsMessage(message);
      if (!msg) {
        sendWs(ws, { type: "error", message: "malformed message" });
        return;
      }
      const { worktree } = ws.data;

      switch (msg.type) {
        case "input":
          write(worktree, msg.data);
          break;
        case "selectPane":
          if (ws.data.attached) {
            console.log(`[ws:${ts()}] selectPane pane=${msg.pane} worktree=${worktree}`);
            await selectPane(worktree, msg.pane);
          }
          break;
        case "resize":
          if (!ws.data.attached) {
            // First resize = client reporting actual dimensions. Attach now.
            ws.data.attached = true;
            console.log(`[ws:${ts()}] first resize (attaching) worktree=${worktree} cols=${msg.cols} rows=${msg.rows}`);
            try {
              if (msg.initialPane !== undefined) {
                console.log(`[ws:${ts()}] initialPane=${msg.initialPane} worktree=${worktree}`);
              }
              await attach(worktree, msg.cols, msg.rows, msg.initialPane);
              const { onData, onExit } = makeCallbacks(ws);
              setCallbacks(worktree, onData, onExit);
              const scrollback = getScrollback(worktree);
              console.log(`[ws:${ts()}] attached worktree=${worktree} scrollback=${scrollback.length} bytes`);
              if (scrollback.length > 0) {
                sendWs(ws, { type: "scrollback", data: scrollback });
              }
            } catch (err: unknown) {
              const errMsg = err instanceof Error ? err.message : String(err);
              console.log(`[ws:${ts()}] attach failed worktree=${worktree}: ${errMsg}`);
              sendWs(ws, { type: "error", message: errMsg });
              ws.close(1011, errMsg.slice(0, 123)); // 1011 = Internal Error
            }
          } else {
            await resize(worktree, msg.cols, msg.rows);
          }
          break;
      }
    },

    async close(ws) {
      console.log(`[ws:${ts()}] close worktree=${ws.data.worktree} attached=${ws.data.attached}`);
      clearCallbacks(ws.data.worktree);
      await detach(ws.data.worktree);
      console.log(`[ws:${ts()}] close complete worktree=${ws.data.worktree}`);
    },
  },
});


// Ensure tmux server is running (needs at least one session to persist)
const tmuxCheck = Bun.spawnSync(["tmux", "list-sessions"], { stdout: "pipe", stderr: "pipe" });
if (tmuxCheck.exitCode !== 0) {
  Bun.spawnSync(["tmux", "new-session", "-d", "-s", "0"]);
  console.log("Started tmux session");
}

cleanupStaleSessions();
startPrMonitor(getWorktreePaths, config.linkedRepos, PROJECT_DIR);

console.log(`Dev Dashboard API running at http://localhost:${PORT}`);
const nets = networkInterfaces();
for (const addrs of Object.values(nets)) {
  for (const a of addrs ?? []) {
    if (a.family === "IPv4" && !a.internal) {
      console.log(`  Network: http://${a.address}:${PORT}`);
    }
  }
}
