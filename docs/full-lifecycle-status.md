# Full Lifecycle Refactor Status

This document is the current checkpoint for the hard-cutover refactor.

For the execution strategy and remaining sequencing, follow `docs/full-lifecycle-cutover-plan.md`.

## Current Position

The refactor direction is now a hard cutover, not a migration plan.

That means:

- no temporary compatibility layer
- no `vnext` route family
- no requirement for legacy code to keep working during the cutover

The remaining legacy surface is now mostly read-only enrichment data.
The new architecture owns the config foundations, runtime identity model, reconciliation, terminal transport, runtime event delivery, lifecycle routes for host and Docker worktrees, and the frontend worktree read path.

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

### 6. Runtime events and notifications are cut over end to end

- `POST /api/runtime/events` now exists
- runtime events are validated, reconciled against the current repo state, and applied to `ProjectRuntime`
- runtime notifications are now recorded through `RuntimeNotificationService`
- `/api/notifications/stream` and dismiss now run through the new runtime-backed notification service
- per-worktree `webmux-agentctl` artifacts now own agent event delivery
- Claude hook settings now point at per-worktree runtime artifacts instead of global `workmux` hook scripts

### 7. Terminal transport and prompt delivery are cut over

- terminal websocket attach now resolves the deterministic runtime-owned tmux session/window target
- websocket terminal sessions are keyed internally by `worktreeId`, not branch name
- prompt send now resolves runtime state first and writes directly through the new terminal transport
- the backend no longer exposes `/rpc/workmux`

### 8. Lifecycle routes are cut over for host and Docker worktrees

- `POST /api/worktrees` now creates managed worktrees through `LifecycleService`
- `POST /api/worktrees/:branch/open` now initializes unmanaged worktrees and rebuilds tmux layout through the new services
- `DELETE /api/worktrees/:branch` and `POST /api/worktrees/:branch/merge` now use native Git/tmux orchestration instead of `workmux`
- lifecycle validation and HTTP error mapping now come from typed lifecycle errors instead of ad hoc route handling
- Docker runtime worktrees now launch through the native lifecycle path and no longer rely on injected `workmux` shims
- create failure cleanup now removes partially created tmux/container/worktree resources from the native orchestrator

### 9. Frontend worktree reads are snapshot-backed

- the frontend worktree list now reads from `GET /api/project`
- the client maps snapshot worktrees onto the UI state instead of polling `GET /api/worktrees`
- `GET /api/worktrees` and `/api/worktrees/:name/status` have been deleted

### 10. Verification is still green

- `cd backend && bun test` passes
- `cd backend && bun run check` passes
- `cd frontend && bun run check` passes
- `cd frontend && bun run build` passes
- current backend test count is 99 passing tests

### 11. Legacy backend runtime modules are deleted

- `backend/src/workmux.ts` is gone
- `backend/src/notifications.ts` is gone
- `backend/src/rpc-secret.ts` is gone
- the server no longer installs global `workmux` hook scripts or exposes legacy worktree read/status routes

## What Is Wired Live Right Now

These pieces are already using the new architecture:

- final `.webmux.yaml` loading
- runtime identity keyed by `worktreeId`
- reconciliation
- `GET /api/project`
- `POST /api/runtime/events`
- runtime-backed notification stream and dismiss
- agent event delivery through per-worktree `webmux-agentctl`
- terminal websocket attach/send behavior
- prompt send flow
- create/open/remove/merge lifecycle routes for host and Docker worktrees
- frontend worktree list state driven by `GET /api/project`

These pieces still run through legacy code:

- PR enrichment still writes through the older `.env.local`-backed path
- some frontend enrichments still use split endpoints instead of a single snapshot-backed model

## What Is Not Done Yet

The remaining work is mostly enrichment collapse and cleanup around the already-cut-over runtime:

1. Move PR/Linear/CI enrichment off the remaining split and `.env.local`-oriented paths.
2. Collapse the remaining frontend reads so the dashboard consumes one coherent snapshot-backed model.
3. Remove stale docs and artifacts that still describe the deleted `workmux` runtime path.

## Recommended Next Steps

Do these next, in order:

1. Collapse PR and other enrichment data into the runtime-backed snapshot path.
2. Delete or rewrite any docs still describing `workmux` RPC, global hook scripts, or `GET /api/worktrees`.
3. Remove the remaining `.env.local` dependency from enrichment code.

At that point, the backend will be mostly in post-cutover cleanup rather than architecture replacement.

## Fresh Chat Handoff

If this work continues in a new chat, start from:

1. `docs/full-lifecycle-cutover-plan.md`
2. `backend/src/server.ts`
3. `backend/src/services/reconciliation-service.ts`
4. `backend/src/services/project-runtime.ts`

The next implementation slice should focus on collapsing enrichment data into the runtime-backed snapshot and cleaning up the remaining `.env.local`-based read path.
