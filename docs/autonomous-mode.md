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

When testing tmux or webmux behavior that touches a real tmux server, do not use the live local tmux instance directly.
Run those commands through `scripts/run-with-isolated-tmux.sh` so tmux uses a disposable isolated socket and `/dev/null` config by default.

Examples:

- `bash scripts/run-with-isolated-tmux.sh bun test backend/src/__tests__/tmux-adapter.test.ts -t BunTmuxGateway`
- `bash scripts/run-with-isolated-tmux.sh bun bin/webmux.js serve --port 6121`
- `cfg="$(mktemp)" && printf '%s\n' 'set-option -g destroy-unattached on' > "$cfg" && WEBMUX_ISOLATED_TMUX_CONFIG="$cfg" bash scripts/run-with-isolated-tmux.sh bun test backend/src/__tests__/tmux-adapter.test.ts -t BunTmuxGateway; rm -f "$cfg"`

When done, open a PR directly, then provide:

- What was changed and why (files modified, approach taken)
- What checks passed (`bun run check` in frontend, etc.)
- What was manually tested and the results
- **Screenshots** of UI changes (if tools are available)
- Any known limitations or follow-up work needed
