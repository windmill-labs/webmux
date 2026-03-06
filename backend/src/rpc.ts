import { loadRpcSecret } from "./rpc-secret";
import { jsonResponse } from "./http";
import { addNotification } from "./notifications";
import type { NotificationService as RuntimeNotificationService } from "./services/notification-service";

interface RpcRequest {
  command: string;
  args?: string[];
  branch?: string;
}

type RpcResponse = { ok: true; output: string } | { ok: false; error: string }

interface WorkmuxRpcDependencies {
  notifications?: RuntimeNotificationService;
}

/** Build env with TMUX set so workmux can resolve agent states outside tmux. */
function tmuxEnv(): Record<string, string | undefined> {
  if (Bun.env.TMUX) return Bun.env;
  const tmpdir = Bun.env.TMUX_TMPDIR || "/tmp";
  const uid = process.getuid?.() ?? 1000;
  return { ...Bun.env, TMUX: `${tmpdir}/tmux-${uid}/default,0,0` };
}

/**
 * Resolve the tmux pane ID for a worktree window (wm-{branch}).
 * Returns the first pane ID, or null if the window doesn't exist.
 */
async function resolvePaneId(branch: string): Promise<string | null> {
  const proc = Bun.spawn(
    ["tmux", "list-panes", "-a", "-F", "#{window_name}\t#{pane_id}"],
    { stdout: "pipe", stderr: "pipe", env: tmuxEnv() },
  );
  const [stdout, , exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) return null;

  const target = `wm-${branch}`;
  for (const line of stdout.trim().split("\n")) {
    const [windowName, paneId] = line.split("\t");
    if (windowName === target && paneId) return paneId;
  }
  return null;
}

export async function handleWorkmuxRpc(
  req: Request,
  deps: WorkmuxRpcDependencies = {},
): Promise<Response> {
  const secret = await loadRpcSecret();
  const authHeader = req.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (token !== secret) {
    return new Response("Unauthorized", { status: 401 });
  }

  let raw: RpcRequest;
  try {
    raw = await req.json() as RpcRequest;
  } catch {
    return jsonResponse({ ok: false, error: "Invalid JSON" } satisfies RpcResponse, 400);
  }

  const { command, args = [], branch } = raw;
  if (!command) {
    return jsonResponse({ ok: false, error: "Missing command" } satisfies RpcResponse, 400);
  }

  // Handle "notify" in-process — no subprocess needed
  if (command === "notify" && branch) {
    const [type, url] = args;
    if (type === "agent_stopped" || type === "pr_opened") {
      if (deps.notifications) {
        deps.notifications.recordEvent(
          type === "pr_opened"
            ? { worktreeId: `legacy:${branch}`, branch, type, ...(url ? { url } : {}) }
            : { worktreeId: `legacy:${branch}`, branch, type },
        );
      } else {
        addNotification(branch, type, url);
      }
      return jsonResponse({ ok: true, output: "ok" } satisfies RpcResponse);
    }
    return jsonResponse({ ok: false, error: `Unknown notification type: ${type}` } satisfies RpcResponse, 400);
  }

  try {
    // Build spawn environment. For set-window-status from a container,
    // resolve the tmux pane ID so the workmux binary can target the right window.
    const env = tmuxEnv();
    if (command === "set-window-status" && branch) {
      const paneId = await resolvePaneId(branch);
      if (paneId) {
        env.TMUX_PANE = paneId;
      }
    }

    const proc = Bun.spawn(["workmux", command, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    if (exitCode !== 0) {
      return jsonResponse({ ok: false, error: stderr.trim() || `exit code ${exitCode}` } satisfies RpcResponse, 422);
    }
    return jsonResponse({ ok: true, output: stdout.trim() } satisfies RpcResponse);
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    return jsonResponse({ ok: false, error } satisfies RpcResponse, 500);
  }
}

export type { RpcRequest, RpcResponse };
