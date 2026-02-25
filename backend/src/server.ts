import { join } from "node:path";
import {
  listWorktrees,
  getStatus,
  addWorktree,
  removeWorktree,
  openWorktree,
  mergeWorktree,
  sendPrompt,
  readEnvLocal,
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
import { loadConfig, type WmdevConfig } from "./config";
import { startPrMonitor, type PrEntry } from "./pr";

const PORT = parseInt(process.env.DASHBOARD_PORT || "5111");
const STATIC_DIR = process.env.WMDEV_STATIC_DIR || "";
const PROJECT_DIR = process.env.WMDEV_PROJECT_DIR || process.cwd();
const config: WmdevConfig = loadConfig(PROJECT_DIR);

function ts(): string {
  return new Date().toISOString().slice(11, 23);
}

/** Map branch name → worktree directory using git worktree list. */
function getWorktreePaths(): Map<string, string> {
  const result = Bun.spawnSync(["git", "worktree", "list", "--porcelain"], { stdout: "pipe" });
  const output = new TextDecoder().decode(result.stdout);
  const paths = new Map<string, string>();
  let currentPath = "";
  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      currentPath = line.slice("worktree ".length);
    } else if (line.startsWith("branch ")) {
      // branch refs/heads/foo → "foo"
      const branch = line.slice("branch ".length).replace("refs/heads/", "");
      // Also map by directory basename (workmux uses basename as branch key)
      const basename = currentPath.split("/").pop() ?? "";
      paths.set(branch, currentPath);
      if (basename !== branch) paths.set(basename, currentPath);
    }
  }
  return paths;
}

/** Count tmux panes for a worktree window. */
function getTmuxPaneCount(branch: string): number {
  const result = Bun.spawnSync(
    ["tmux", "list-panes", "-t", `wm-${branch}`, "-F", "#{pane_index}"],
    { stdout: "pipe", stderr: "pipe" }
  );
  if (result.exitCode !== 0) return 0;
  return new TextDecoder().decode(result.stdout).trim().split("\n").filter(Boolean).length;
}

/** Check if a port has a service responding (not just a TCP handshake). */
function isPortListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => { resolve(false); }, 1000);
    fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) })
      .then((res) => { clearTimeout(timeout); resolve(true); })
      .catch(() => { clearTimeout(timeout); resolve(false); });
  });
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status = 500): Response {
  return jsonResponse({ error: message }, status);
}

interface WsData {
  worktree: string;
  attached: boolean;
}

function makeCallbacks(ws: { send: (data: string) => void; readyState: number }) {
  return {
    onData: (data: string) => {
      if (ws.readyState <= 1) {
        ws.send(JSON.stringify({ type: "output", data }));
      }
    },
    onExit: (exitCode: number) => {
      if (ws.readyState <= 1) {
        ws.send(JSON.stringify({ type: "exit", exitCode }));
      }
    },
  };
}

Bun.serve<WsData>({
  port: PORT,
  idleTimeout: 255, // seconds; worktree removal can take >10s

  async fetch(req, server) {
    const url = new URL(req.url);

    const wsMatch = url.pathname.match(/^\/ws\/(.+)$/);
    if (wsMatch) {
      const worktree = decodeURIComponent(wsMatch[1]);
      const upgraded = server.upgrade(req, { data: { worktree, attached: false } });
      if (upgraded) return undefined as unknown as Response;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    if (url.pathname.startsWith("/api/")) {
      return handleApi(req, url);
    }

    // Serve static frontend files in production mode
    if (STATIC_DIR) {
      const filePath = join(STATIC_DIR, url.pathname === "/" ? "index.html" : url.pathname);
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
    open(ws) {
      console.log(`[ws:${ts()}] open worktree=${ws.data.worktree}`);
    },

    async message(ws, message) {
      try {
        const msg = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message));
        const { worktree } = ws.data;

        switch (msg.type) {
          case "input":
            write(worktree, msg.data);
            break;
          case "selectPane":
            if (ws.data.attached && typeof msg.pane === "number") {
              console.log(`[ws:${ts()}] selectPane pane=${msg.pane} worktree=${worktree}`);
              selectPane(worktree, msg.pane);
            }
            break;
          case "resize":
            if (!ws.data.attached) {
              // First resize = client reporting actual dimensions. Spawn now.
              ws.data.attached = true;
              console.log(`[ws:${ts()}] first resize (attaching) worktree=${worktree} cols=${msg.cols} rows=${msg.rows}`);
              try {
                const initialPane = typeof msg.initialPane === "number" ? msg.initialPane : undefined;
                if (initialPane !== undefined) {
                  console.log(`[ws:${ts()}] initialPane=${initialPane} worktree=${worktree}`);
                }
                await attach(worktree, msg.cols, msg.rows, initialPane);
                const { onData, onExit } = makeCallbacks(ws);
                setCallbacks(worktree, onData, onExit);
                const scrollback = getScrollback(worktree);
                console.log(`[ws:${ts()}] attached worktree=${worktree} scrollback=${scrollback.length} bytes`);
                if (scrollback) {
                  ws.send(JSON.stringify({ type: "scrollback", data: scrollback }));
                }
              } catch (err: unknown) {
                const errMsg = err instanceof Error ? err.message : String(err);
                console.log(`[ws:${ts()}] attach failed worktree=${worktree}: ${errMsg}`);
                ws.send(JSON.stringify({ type: "error", message: errMsg }));
                ws.close();
              }
            } else {
              resize(worktree, msg.cols, msg.rows);
            }
            break;
        }
      } catch {
        // Ignore malformed messages
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

async function handleApi(req: Request, url: URL): Promise<Response> {
  const method = req.method;
  const parts = url.pathname.slice(5).split("/").filter(Boolean);

  try {
    // GET /api/config
    if (parts[0] === "config" && parts.length === 1 && method === "GET") {
      return jsonResponse(config);
    }

    // GET /api/worktrees
    if (parts[0] === "worktrees" && parts.length === 1 && method === "GET") {
      const [worktrees, status] = await Promise.all([listWorktrees(), getStatus()]);
      const wtPaths = getWorktreePaths();
      const merged = await Promise.all(worktrees.map(async (wt) => {
        const st = status.find(s =>
          s.worktree.includes(wt.branch) || s.worktree.startsWith(wt.branch)
        );
        const wtDir = wtPaths.get(wt.branch);
        const env = wtDir ? readEnvLocal(wtDir) : {};
        const services = await Promise.all(
          config.services.map(async (svc) => {
            const port = env[svc.portEnv] ? parseInt(env[svc.portEnv]) : null;
            const running = port ? await isPortListening(port) : false;
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
          paneCount: wt.mux === "✓" ? getTmuxPaneCount(wt.branch) : 0,
          prs: env.PR_DATA ? (JSON.parse(env.PR_DATA) as PrEntry[]) : [],
        };
      }));
      return jsonResponse(merged);
    }

    // POST /api/worktrees
    if (parts[0] === "worktrees" && parts.length === 1 && method === "POST") {
      const body = await req.json() as { branch?: string; prompt?: string; profile?: string; agent?: string };
      const profileName = body.profile ?? config.profiles.default.name;
      const isSandbox = config.profiles.sandbox !== undefined && profileName === config.profiles.sandbox.name;
      const profileConfig = isSandbox ? config.profiles.sandbox! : config.profiles.default;
      const agent = body.agent ?? "claude";
      console.log(`[worktree:add] agent=${agent} profile=${profileName}${body.branch ? ` branch=${body.branch}` : ""}${body.prompt ? ` prompt="${body.prompt.slice(0, 80)}"` : ""}`);
      const result = await addWorktree(body.branch, {
        prompt: body.prompt,
        profile: profileName,
        agent,
        autoName: config.autoName,
        profileConfig,
        isSandbox,
        sandboxConfig: isSandbox ? config.profiles.sandbox : undefined,
        services: config.services,
        mainRepoDir: PROJECT_DIR,
      });
      console.log(`[worktree:add] done branch=${result.branch}: ${result.output}`);
      return jsonResponse({ branch: result.branch }, 201);
    }

    // DELETE /api/worktrees/:name
    if (parts[0] === "worktrees" && parts.length === 2 && method === "DELETE") {
      const name = decodeURIComponent(parts[1]);
      console.log(`[worktree:rm] name=${name}`);
      const result = await removeWorktree(name);
      console.log(`[worktree:rm] done name=${name}: ${result}`);
      return jsonResponse({ message: result });
    }

    // POST /api/worktrees/:name/open
    if (parts[0] === "worktrees" && parts.length === 3 && parts[2] === "open" && method === "POST") {
      const name = decodeURIComponent(parts[1]);
      console.log(`[worktree:open] name=${name}`);
      return jsonResponse({ message: await openWorktree(name) });
    }

    // POST /api/worktrees/:name/send
    if (parts[0] === "worktrees" && parts.length === 3 && parts[2] === "send" && method === "POST") {
      const name = decodeURIComponent(parts[1]);
      const body = await req.json() as { text?: string; preamble?: string };
      if (!body.text) return errorResponse("Missing 'text' field", 400);
      console.log(`[worktree:send] name=${name} text="${body.text.slice(0, 80)}"`);
      const result = sendPrompt(name, body.text, 0, body.preamble);
      if (!result.ok) return errorResponse(result.error, 404);
      return jsonResponse({ ok: true });
    }

    // POST /api/worktrees/:name/merge
    if (parts[0] === "worktrees" && parts.length === 3 && parts[2] === "merge" && method === "POST") {
      const name = decodeURIComponent(parts[1]);
      console.log(`[worktree:merge] name=${name}`);
      const result = await mergeWorktree(name);
      console.log(`[worktree:merge] done name=${name}: ${result}`);
      return jsonResponse({ message: result });
    }

    // GET /api/ci-logs/:runId
    if (parts[0] === "ci-logs" && parts.length === 2 && method === "GET") {
      const runId = parts[1];
      if (!/^\d+$/.test(runId)) return errorResponse("Invalid run ID", 400);
      const result = Bun.spawnSync(["gh", "run", "view", runId, "--log"], {
        stdout: "pipe",
        stderr: "pipe",
      });

      if (result.exitCode === 0) {
        const logs = new TextDecoder().decode(result.stdout);
        return jsonResponse({ logs });
      }

      // Fallback for cases where full logs are unavailable.
      const fallback = Bun.spawnSync(["gh", "run", "view", runId, "--log-failed"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      if (fallback.exitCode === 0) {
        const logs = new TextDecoder().decode(fallback.stdout);
        return jsonResponse({ logs });
      }

      const stderr = new TextDecoder().decode(result.stderr).trim();
      const fallbackStderr = new TextDecoder().decode(fallback.stderr).trim();
      return errorResponse(
        `Failed to fetch logs: ${stderr || "unknown error"}${fallbackStderr ? ` (fallback: ${fallbackStderr})` : ""}`,
        502
      );
    }

    // GET /api/worktrees/:name/status
    if (parts[0] === "worktrees" && parts.length === 3 && parts[2] === "status" && method === "GET") {
      const name = decodeURIComponent(parts[1]);
      const status = await getStatus();
      const match = status.find(s => s.worktree.includes(name));
      return jsonResponse(match ?? { status: "unknown" });
    }

    return errorResponse("Not Found", 404);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[api:error] ${method} ${url.pathname}: ${message}`);
    return errorResponse(message);
  }
}

// Ensure tmux server is running (needs at least one session to persist)
const tmuxCheck = Bun.spawnSync(["tmux", "list-sessions"], { stdout: "pipe", stderr: "pipe" });
if (tmuxCheck.exitCode !== 0) {
  Bun.spawnSync(["tmux", "new-session", "-d", "-s", "0"]);
  console.log("Started tmux session");
}

cleanupStaleSessions();
startPrMonitor(getWorktreePaths, config.linkedRepos);

console.log(`Dev Dashboard API running at http://localhost:${PORT}`);
