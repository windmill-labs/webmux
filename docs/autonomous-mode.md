# Autonomous Mode

When running without human intervention (bypass/auto permissions), follow these instructions to work end-to-end.

## Always Plan First

Even in autonomous mode, **enter plan mode before starting non-trivial work**:

- Clarify ambiguous requirements before writing code
- Identify which files and modules are affected
- Read the relevant CLAUDE.md files (`backend/CLAUDE.md`, `frontend/CLAUDE.md`)
- Break large features into stages — commit each stage separately

## Manual Testing

After code changes compile and type-check, verify the feature works:

1. **Check frontend logs** (`tmux capture-pane -t .1 -p -S -50`) — confirm no build errors
2. **Check backend** — the backend runs on the main worktree; verify API responses with `curl`
3. **Test the UI flow** in the browser or with Playwright screenshots
4. **Test edge cases**: empty states, error states, loading states

## End-of-Task Summary

When done, provide:

- What was changed and why (files modified, approach taken)
- What checks passed (`bun run check` in frontend, etc.)
- What was manually tested and the results
- **Screenshots** of UI changes (if tools are available)
- Any known limitations or follow-up work needed
