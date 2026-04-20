export function classifyAgentsTerminalWorktreeError(
  error: unknown,
): { status: 404 | 409; error: string } | null {
  const message = error instanceof Error ? error.message : String(error);

  if (message.startsWith("No open tmux window found for worktree: ")) {
    return { status: 409, error: message };
  }

  if (message.startsWith("Worktree not found: ")) {
    return { status: 404, error: message };
  }

  return null;
}
