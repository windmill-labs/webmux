import { mkdir, chmod } from "node:fs/promises";
import { log } from "./lib/log";

// --- Types ---

interface AppNotification {
  id: number;
  branch: string;
  type: "agent_stopped" | "pr_opened";
  message: string;
  url?: string;
  timestamp: number;
}

type SseEvent =
  | { kind: "notification"; data: AppNotification }
  | { kind: "dismiss"; id: number };

// --- In-memory store ---

let nextId = 1;
const notifications: AppNotification[] = [];
const sseClients = new Set<ReadableStreamDefaultController<Uint8Array>>();

function formatSse(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function broadcast(event: SseEvent): void {
  const encoded =
    event.kind === "notification"
      ? formatSse("notification", event.data)
      : formatSse("dismiss", { id: event.id });
  for (const controller of sseClients) {
    try {
      controller.enqueue(encoded);
    } catch {
      sseClients.delete(controller);
    }
  }
}

// --- Public API ---

export function addNotification(
  branch: string,
  type: "agent_stopped" | "pr_opened",
  url?: string,
): AppNotification {
  const message =
    type === "agent_stopped"
      ? `Agent stopped on ${branch}`
      : `PR opened on ${branch}`;
  const notification: AppNotification = {
    id: nextId++,
    branch,
    type,
    message,
    url,
    timestamp: Date.now(),
  };
  notifications.push(notification);
  if (notifications.length > 50) notifications.shift();
  log.info(`[notify] ${type} branch=${branch}${url ? ` url=${url}` : ""}`);
  broadcast({ kind: "notification", data: notification });
  return notification;
}

export function getNotifications(): AppNotification[] {
  return notifications;
}

export function dismissNotification(id: number): boolean {
  const idx = notifications.findIndex((n) => n.id === id);
  if (idx === -1) return false;
  notifications.splice(idx, 1);
  broadcast({ kind: "dismiss", id });
  return true;
}

// --- SSE handler ---

export function handleNotificationStream(): Response {
  let ctrl: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      ctrl = controller;
      sseClients.add(controller);
      // Send existing notifications as initial batch (distinct event so frontend skips toasts)
      for (const n of notifications) {
        controller.enqueue(formatSse("initial", n));
      }
    },
    cancel() {
      sseClients.delete(ctrl);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

// --- Dismiss handler ---

export function handleDismissNotification(id: number): Response {
  const ok = dismissNotification(id);
  if (!ok) {
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
}

// --- Hook script installation ---

const HOOKS_DIR = `${Bun.env.HOME ?? "/root"}/.config/workmux/hooks`;

const NOTIFY_STOP_SH = `#!/usr/bin/env bash
# Claude Code Stop hook — notifies workmux backend that an agent stopped.
set -euo pipefail

# Read hook input from stdin
INPUT=$(cat)

# Auth: token from env or secret file
TOKEN="\${WORKMUX_RPC_TOKEN:-}"
if [ -z "$TOKEN" ] && [ -f "\${HOME}/.config/workmux/rpc-secret" ]; then
  TOKEN=$(cat "\${HOME}/.config/workmux/rpc-secret")
fi
[ -z "$TOKEN" ] && exit 0

PORT="\${WORKMUX_RPC_PORT:-5111}"

# Extract branch from cwd field: .../__worktrees/<branch>
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
[ -z "$CWD" ] && exit 0
BRANCH=$(echo "$CWD" | grep -oP '__worktrees/\\K[^/]+' || true)
[ -z "$BRANCH" ] && exit 0

PAYLOAD=$(jq -n --arg branch "$BRANCH" '{"command":"notify","branch":$branch,"args":["agent_stopped"]}')

curl -sf -X POST "http://127.0.0.1:\${PORT}/rpc/workmux" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d "$PAYLOAD" \\
  >/dev/null 2>&1 || true
`;

const NOTIFY_PR_SH = `#!/usr/bin/env bash
# Claude Code PostToolUse hook — notifies workmux backend when a PR is opened.
set -euo pipefail

# Read hook input from stdin
INPUT=$(cat)

# Only trigger on Bash tool calls containing "gh pr create"
TOOL_INPUT=$(echo "$INPUT" | jq -r '.tool_input.command // empty')
echo "$TOOL_INPUT" | grep -q 'gh pr create' || exit 0

# Auth: token from env or secret file
TOKEN="\${WORKMUX_RPC_TOKEN:-}"
if [ -z "$TOKEN" ] && [ -f "\${HOME}/.config/workmux/rpc-secret" ]; then
  TOKEN=$(cat "\${HOME}/.config/workmux/rpc-secret")
fi
[ -z "$TOKEN" ] && exit 0

PORT="\${WORKMUX_RPC_PORT:-5111}"

# Extract branch from cwd
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
[ -z "$CWD" ] && exit 0
BRANCH=$(echo "$CWD" | grep -oP '__worktrees/\\K[^/]+' || true)
[ -z "$BRANCH" ] && exit 0

# Extract PR URL from tool response (gh pr create outputs the URL)
PR_URL=$(echo "$INPUT" | jq -r '.tool_response // empty' | grep -oP 'https://github\\.com/[^\\s"]+/pull/\\d+' | head -1 || true)

if [ -n "$PR_URL" ]; then
  PAYLOAD=$(jq -n --arg branch "$BRANCH" --arg url "$PR_URL" '{"command":"notify","branch":$branch,"args":["pr_opened",$url]}')
else
  PAYLOAD=$(jq -n --arg branch "$BRANCH" '{"command":"notify","branch":$branch,"args":["pr_opened"]}')
fi

curl -sf -X POST "http://127.0.0.1:\${PORT}/rpc/workmux" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d "$PAYLOAD" \\
  >/dev/null 2>&1 || true
`;

export async function installHookScripts(): Promise<void> {
  await mkdir(HOOKS_DIR, { recursive: true });
  const stopPath = `${HOOKS_DIR}/notify-stop.sh`;
  const prPath = `${HOOKS_DIR}/notify-pr.sh`;
  await Bun.write(stopPath, NOTIFY_STOP_SH);
  await Bun.write(prPath, NOTIFY_PR_SH);
  await chmod(stopPath, 0o755);
  await chmod(prPath, 0o755);
  log.info(`[notify] installed hook scripts in ${HOOKS_DIR}`);
}
