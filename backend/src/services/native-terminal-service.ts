import type { ManagedWorktreeRuntimeState, NativeTerminalLaunch } from "../domain/model";

export type NativeTerminalLaunchResult =
  | { ok: true; data: NativeTerminalLaunch }
  | { ok: false; reason: "not_found" | "closed"; message: string };

function quoteShell(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function sanitizeSessionSuffix(value: string): string {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "");
  const trimmed = sanitized.slice(0, 24);
  return trimmed || "x";
}

export function buildNativeTerminalTmuxCommand(
  env: Record<string, string | undefined>,
): string {
  const socket = env.WEBMUX_ISOLATED_TMUX_SOCKET;
  const config = env.WEBMUX_ISOLATED_TMUX_CONFIG;

  if (socket && config) {
    return `tmux -L ${quoteShell(socket)} -f ${quoteShell(config)}`;
  }

  if (socket) {
    return `tmux -L ${quoteShell(socket)}`;
  }

  return "tmux";
}

export function buildNativeTerminalLaunch(input: {
  branch: string;
  state: ManagedWorktreeRuntimeState | null;
  tmuxCommand: string;
  sessionPrefix?: string;
}): NativeTerminalLaunchResult {
  const { branch, state, tmuxCommand } = input;

  if (!state || !state.git.exists) {
    return {
      ok: false,
      reason: "not_found",
      message: `Worktree not found: ${branch}`,
    };
  }

  if (!state.session.exists || !state.session.sessionName) {
    return {
      ok: false,
      reason: "closed",
      message: `No open tmux window found for worktree: ${branch}`,
    };
  }

  const sessionPrefix = input.sessionPrefix ?? "wm-native-launch-";
  const groupedSessionPrefix = `${sessionPrefix}${sanitizeSessionSuffix(state.worktreeId)}`;
  const ownerSessionName = quoteShell(state.session.sessionName);
  const groupedWindowTarget = `"${"$"}g_name:${state.session.windowName}"`;
  const groupedPaneTarget = `"${"$"}g_name:${state.session.windowName}.0"`;

  const attachScript = [
    `g_name="${groupedSessionPrefix}-${"$"}$-$(date +%s)"`,
    `cleanup() { ${tmuxCommand} kill-session -t "${"$"}g_name" >/dev/null 2>&1 || true; }`,
    "cleanup",
    `${tmuxCommand} new-session -d -s "${"$"}g_name" -t ${ownerSessionName}`,
    `${tmuxCommand} set-option -t ${ownerSessionName} window-size latest`,
    `${tmuxCommand} set-option -t "${"$"}g_name" mouse on`,
    `${tmuxCommand} set-option -t "${"$"}g_name" set-clipboard on`,
    `${tmuxCommand} select-window -t ${groupedWindowTarget}`,
    `if [ "$(${tmuxCommand} display-message -t ${groupedWindowTarget} -p '#{window_zoomed_flag}')" = "1" ]; then ${tmuxCommand} resize-pane -Z -t ${groupedWindowTarget}; fi`,
    `${tmuxCommand} select-pane -t ${groupedPaneTarget}`,
    "trap cleanup EXIT INT TERM",
    `exec ${tmuxCommand} attach-session -t "${"$"}g_name"`,
  ].join(" && ");

  return {
    ok: true,
    data: {
      worktreeId: state.worktreeId,
      branch: state.branch,
      path: state.path,
      shellCommand: `/bin/sh -lc ${quoteShell(attachScript)}`,
    },
  };
}
