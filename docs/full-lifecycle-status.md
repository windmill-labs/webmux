# Full Lifecycle Refactor Status

This document is the current checkpoint for the hard-cutover refactor.

For the execution strategy and remaining sequencing, follow `docs/full-lifecycle-cutover-plan.md`.

## Current Position

The refactor direction is now a hard cutover, not a migration plan.

That means:

- no temporary compatibility layer
- no `vnext` route family
- no requirement for legacy code to keep working during the cutover

The legacy backend still powers some product behavior today, but the new architecture already owns the config foundations, runtime identity model, reconciliation, terminal transport, the main lifecycle routes for host worktrees, and the frontend worktree read path.

## What Is Done

### 1. Final config model is cut over

- `backend/src/config.ts` now loads the final `.webmux.yaml` shape into `ProjectConfig`
- `.workmux.yaml` is no longer part of the new config path
- the repo config has been rewritten to the new schema
- the server still projects a frontend-oriented `/api/config` response from the new config

### 2. Canonical metadata and env storage are in place

- `meta.json` remains the canonical durable worktree record
- `runtime.env` and `control.env` remain generated runtime artifacts
- the new lifecycle path no longer emits `.env.local`

### 3. Runtime identity is keyed by `worktreeId`

- `worktreeId` is now the internal runtime identity
- `branch` remains a mutable attribute and display field
- runtime events and runtime bookkeeping now follow that rule

### 4. Reconciliation exists and drives the new read model

- `backend/src/services/reconciliation-service.ts` is implemented
- reconciliation discovers Git worktrees, metadata, tmux state, and projected services
- unmanaged worktrees are represented with synthetic IDs
- stale runtime entries are removed during reconciliation

### 5. A live snapshot-backed read path exists

- `GET /api/project` is wired through the new composition root
- that route runs reconciliation and returns a snapshot from the new runtime model
- this is the first live backend path that reads from the new architecture end to end

### 6. Runtime events and notifications are partially cut over

- `POST /api/runtime/events` now exists
- runtime events are validated, reconciled against the current repo state, and applied to `ProjectRuntime`
- runtime notifications are now recorded through `RuntimeNotificationService`
- `/api/notifications/stream` and dismiss now run through the new runtime-backed notification service

### 7. Terminal transport and prompt delivery are cut over

- terminal websocket attach now resolves the deterministic runtime-owned tmux session/window target
- websocket terminal sessions are keyed internally by `worktreeId`, not branch name
- prompt send now resolves runtime state first and writes directly through the new terminal transport
- the backend no longer exposes `/rpc/workmux`

### 8. Lifecycle routes are cut over for host worktrees

- `POST /api/worktrees` now creates managed worktrees through `LifecycleService`
- `POST /api/worktrees/:branch/open` now initializes unmanaged worktrees and rebuilds tmux layout through the new services
- `DELETE /api/worktrees/:branch` and `POST /api/worktrees/:branch/merge` now use native Git/tmux orchestration instead of `workmux`
- lifecycle validation and HTTP error mapping now come from typed lifecycle errors instead of ad hoc route handling
- Docker runtime worktrees are still explicitly unsupported in the native lifecycle path

### 9. Frontend worktree reads are snapshot-backed

- the frontend worktree list now reads from `GET /api/project`
- the client maps snapshot worktrees onto the UI state instead of polling `GET /api/worktrees`
- `GET /api/worktrees` still exists, but it is no longer the primary frontend read path

### 10. Verification is still green

- `cd backend && bun test` passes
- `cd backend && bun run check` passes
- `cd frontend && bun run check` passes
- `cd frontend && bun run build` passes
- current backend test count is 97 passing tests

## What Is Wired Live Right Now

These pieces are already using the new architecture:

- final `.webmux.yaml` loading
- runtime identity keyed by `worktreeId`
- reconciliation
- `GET /api/project`
- `POST /api/runtime/events`
- runtime-backed notification stream and dismiss
- terminal websocket attach/send behavior
- prompt send flow
- create/open/remove/merge lifecycle routes for host worktrees
- frontend worktree list state driven by `GET /api/project`

These pieces still run through legacy code:

- `GET /api/worktrees`
- Docker and hook event delivery still using legacy hook/container control code
- some frontend reads and enrichments still use legacy split endpoints

## What Is Not Done Yet

The remaining work is the actual cutover of runtime I/O and lifecycle ownership:

1. Finish Docker runtime support in the native lifecycle path.
2. Cut Docker and hook-driven agent event flow over to `webmux-agentctl`.
3. Delete `GET /api/worktrees` and the remaining legacy backend modules once the remaining enrichments move over.
4. Collapse the remaining split frontend reads where they are still only compensating for legacy backend data.

## Recommended Next Steps

Do these next, in order:

1. Replace Docker and hook-driven event delivery with `webmux-agentctl`.
2. Finish Docker runtime support in the native lifecycle path.
3. Delete `GET /api/worktrees` and the remaining legacy backend modules.

At that point, the backend will have crossed the main boundary from "new read model exists" to "new runtime owns live behavior."

## Fresh Chat Handoff

If this work continues in a new chat, start from:

1. `docs/full-lifecycle-cutover-plan.md`
2. `backend/src/server.ts`
3. `backend/src/services/reconciliation-service.ts`
4. `backend/src/services/project-runtime.ts`

The next implementation slice should replace Docker/hook runtime control with `webmux-agentctl`, add Docker support to the native lifecycle path, and then delete the remaining legacy backend modules.