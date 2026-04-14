# Agents UI Plan

## Goal

Add a second UI for worktree conversations that is fully separate from the existing terminal-based webview.

The new UI should:

- run on its own port
- use the existing webmux backend as the source of truth for worktrees and lifecycle state
- talk to Codex worktrees without rendering a terminal
- preserve real Codex conversation continuity through `codex app-server`

The existing dashboard remains unchanged.

## Architecture

### Shared backend

Keep one backend process for:

- worktree lifecycle
- tmux/runtime state
- PR and service health state
- worktree metadata
- the future Codex `app-server` bridge

Do not create a second runtime owner for the same worktrees.

### Separate frontends

Keep two independent frontend apps:

- `frontend/`
  - current dashboard
  - terminal-centric
- `agents-frontend/`
  - new chat-style UI
  - no terminal rendering

### Conversation transport

For direct conversation continuity with existing Codex worktrees, use `codex app-server`, not the Agents SDK as the transport for the same thread.

The Agents SDK can be added later as a higher-level orchestration layer, but the direct worktree chat lane should map to the real Codex thread for that worktree.

## Ports

### Development

- backend: `5181`
- current frontend: `5182`
- agents frontend: `5183`

### `webmux serve`

- backend + current dashboard: `--port` (default `5111`)
- agents UI: `--agents-port` (default `port + 1`)

## Phase plan

### Phase 1

Metadata, route skeleton, and frontend scaffold.

- extend worktree metadata with a persisted conversation reference
- add backend types for the agents UI contract
- add `/api/agents/*` route namespace
- implement `GET /api/agents/bootstrap`
- add stubs for attach/history/message/interrupt routes
- create `agents-frontend/` with its own Vite + Svelte app and typed API client

### Phase 2

Codex `app-server` bridge.

- add adapter for `codex app-server`
- resolve threads by worktree `cwd`
- implement attach/history/message/interrupt behavior
- normalize streamed app-server events for the frontend

### Phase 3

Interactive chat UI.

- worktree rail
- transcript pane
- composer
- streaming updates
- structured cards for commands, file changes, and approvals

### Phase 4

Serve/dev integration.

- update `dev.sh` to run backend + both frontends
- update `webmux serve` to boot the agents UI on its own port
- add routing/proxy support for the agents frontend

### Phase 5

Workspace-level Agents SDK features.

- add an SDK-backed workspace assistant
- keep SDK state separate from direct worktree conversation state
- expose tools over shared backend worktree operations

## Phase 1 implementation details

### Metadata

Extend worktree metadata with an optional conversation record:

- provider
- threadId
- cwd
- lastSeenAt

This makes future Codex thread attachment deterministic instead of relying on `codex resume --last`.

### Backend contract

Phase 1 backend routes:

- `GET /api/agents/bootstrap`
- `POST /api/agents/worktrees/:branch/attach`
- `GET /api/agents/worktrees/:branch/history`
- `POST /api/agents/worktrees/:branch/messages`
- `POST /api/agents/worktrees/:branch/interrupt`

Only `bootstrap` is implemented in phase 1. The others return `501 Not implemented`.

### Frontend scaffold

`agents-frontend/` should include:

- `src/lib/types.ts`
- `src/lib/api.ts`
- `src/App.svelte`
- minimal visual shell showing the project and worktree list from `bootstrap`

It should proxy only:

- `/api/agents`
- `/ws/agents`

The current dashboard frontend remains untouched.
