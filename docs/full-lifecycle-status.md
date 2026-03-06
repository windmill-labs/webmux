# Full Lifecycle Refactor Status

This document is the current checkpoint for the hard-cutover refactor.

For the execution strategy and remaining sequencing, follow `docs/full-lifecycle-cutover-plan.md`.

## Current Position

The refactor direction is now a hard cutover, not a migration plan.

That means:

- no temporary compatibility layer
- no `vnext` route family
- no requirement for legacy code to keep working during the cutover

The legacy backend still powers most product behavior today, but the new architecture already owns the config foundations, runtime identity model, reconciliation, and one live snapshot-backed read path.

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

### 6. Backend coverage is still green

- `cd backend && bun test` passes
- `cd backend && bun run check` passes
- current backend test count is 93 passing tests

## What Is Wired Live Right Now

These pieces are already using the new architecture:

- final `.webmux.yaml` loading
- runtime identity keyed by `worktreeId`
- reconciliation
- `GET /api/project`

These pieces still run through legacy code:

- `GET /api/worktrees`
- create/open/remove/merge lifecycle routes
- prompt send flow
- terminal websocket attach/send behavior
- runtime event ingestion
- notification streaming
- most frontend reads

## What Is Not Done Yet

The remaining work is the actual cutover of runtime I/O and lifecycle ownership:

1. Add `POST /api/runtime/events`.
2. Feed runtime events into `ProjectRuntime` and `RuntimeNotificationService`.
3. Replace legacy notification flow with the new runtime-backed notification path.
4. Cut terminal attach/send over to the new session ownership model.
5. Wire create/open/remove/merge/prompt through the new lifecycle services.
6. Add missing validation and rollback behavior in the lifecycle service.
7. Move the frontend read path to `GET /api/project`.
8. Cut Docker and hook-driven agent event flow over to `webmux-agentctl`.
9. Delete legacy backend modules once the new slice is live end to end.

## Recommended Next Steps

Do these next, in order:

1. Add `POST /api/runtime/events`.
2. Apply runtime events to `ProjectRuntime` and `RuntimeNotificationService`.
3. Replace legacy notification streaming with the new notification service.
4. Replace terminal websocket attach/send with the new session ownership model.
5. Cut over create/open/remove/merge/prompt routes to the new lifecycle services.

At that point, the backend will have crossed the main boundary from "new read model exists" to "new runtime owns live behavior."

## Fresh Chat Handoff

If this work continues in a new chat, start from:

1. `docs/full-lifecycle-cutover-plan.md`
2. `backend/src/server.ts`
3. `backend/src/services/reconciliation-service.ts`
4. `backend/src/services/project-runtime.ts`

The next implementation slice should begin with runtime event ingestion and then move directly into notifications and terminal cutover.

## Local Workspace Note

There is an unrelated untracked file in the workspace:

- `Dockerfile.test-init`

It is not part of this refactor status and should be left alone unless explicitly requested.
