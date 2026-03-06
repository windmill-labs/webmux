# Full Lifecycle Refactor Status

This document is the implementation checkpoint for the `webmux` full-lifecycle refactor.

Use it as the handoff note if work continues in a fresh chat.

For the current hard-cutover direction, follow `docs/full-lifecycle-cutover-plan.md`.
The migration-oriented `vnext` and config-bridge steps below reflect an earlier sequencing and should not be treated as the current target plan.

## Current Position

The refactor has started and the new architecture already has real backend foundations.

The codebase is currently in a parallel state:

- legacy production behavior still runs through `backend/src/server.ts`, `backend/src/workmux.ts`, `backend/src/terminal.ts`, and related legacy modules
- new lifecycle/runtime foundations exist under new module boundaries
- the new architecture is not wired into the live server yet

## What Is Done

### 1. New domain model exists

Implemented:

- `backend/src/domain/config.ts`
- `backend/src/domain/model.ts`
- `backend/src/domain/events.ts`
- `backend/src/domain/policies.ts`

This covers:

- project config types
- pane/profile/runtime types
- worktree metadata types
- runtime state types
- runtime event types
- branch and env validation
- service port allocation policy

### 2. Canonical metadata and env storage model exists

Implemented:

- `backend/src/adapters/fs.ts`
- `backend/src/adapters/git.ts`

This already supports:

- resolving repo root
- resolving a worktree Git admin dir via `git rev-parse --git-dir`
- storing canonical metadata in:
  - `<worktree-git-dir>/webmux/meta.json`
- storing generated env files in:
  - `<worktree-git-dir>/webmux/runtime.env`
  - `<worktree-git-dir>/webmux/control.env`
- optionally emitting `<worktree>/.env.local` as compatibility output only

Important architectural decision already implemented:

- internal `webmux` metadata does not live in the tracked working tree
- `.env.local` is not canonical

### 3. Native tmux ownership foundations exist

Implemented:

- `backend/src/adapters/tmux.ts`
- `backend/src/services/session-service.ts`

This already supports:

- deterministic project session names
- deterministic `wm-{branch}` window names
- layout planning from pane templates
- window creation
- pane splitting
- focus selection
- open-state checks

### 4. Native lifecycle primitives exist

Implemented:

- `backend/src/services/worktree-service.ts`

This already supports:

- create managed worktree
- initialize managed worktree storage
- remove managed worktree
- merge managed worktree

The create flow already does:

1. create Git worktree
2. resolve worktree Git admin dir
3. write metadata
4. write runtime env
5. write control env
6. optionally write `.env.local`
7. optionally realize tmux layout

### 5. Runtime and snapshot foundations exist

Implemented:

- `backend/src/services/project-runtime.ts`
- `backend/src/services/notification-service.ts`
- `backend/src/services/snapshot-service.ts`

This already supports:

- in-memory runtime registry
- runtime event application
- notification creation for user-visible runtime events
- snapshot projection from runtime state to frontend-facing data

### 6. Managed command building exists

Implemented:

- `backend/src/services/agent-service.ts`

This already supports:

- building shell commands that source `runtime.env`
- wrapping command panes so they inherit managed env
- building agent commands for supported agent types

### 7. New tests exist and pass

Implemented tests:

- `backend/src/__tests__/git-adapter.test.ts`
- `backend/src/__tests__/worktree-storage.test.ts`
- `backend/src/__tests__/tmux-adapter.test.ts`
- `backend/src/__tests__/session-service.test.ts`
- `backend/src/__tests__/project-runtime.test.ts`
- `backend/src/__tests__/notification-service.test.ts`
- `backend/src/__tests__/snapshot-service.test.ts`
- `backend/src/__tests__/agent-service.test.ts`
- `backend/src/__tests__/domain-policies.test.ts`

Last verified state:

- `cd backend && bun test` passes
- `cd backend && bun run check` passes

At the last verification point:

- `89` tests passed
- `tsc --noEmit` was clean

## What Is Not Done Yet

### 1. The new architecture is not wired into the server

Missing:

- new route module
- new composition root
- new runtime bootstrap
- parallel vnext API endpoints
- live server usage of the new services

Current reality:

- production requests still use legacy `workmux`-backed flows

### 2. There is no reconciliation layer yet

Missing:

- build `ProjectRuntime` from actual Git worktrees
- read `meta.json` for each managed worktree
- detect unmanaged worktrees
- derive session state from tmux
- derive service state from allocated ports
- remove stale runtime entries when worktrees disappear

This is the next important missing layer.

### 3. The new create flow is not exposed via HTTP yet

Missing:

- `POST` route using `createManagedWorktree`
- request validation on the new path
- config-to-domain translation
- branch naming/path derivation on the new path
- startup env resolution from config and request overrides
- tmux layout realization via real route input

### 4. Open/remove/merge are not cut over yet

Even though service primitives exist, the live server still uses legacy implementations for:

- open
- remove
- merge

What still needs to be built:

- HTTP routes for the new lifecycle path
- tmux-aware open behavior
- correct cleanup sequencing
- removal of legacy lifecycle calls after cutover

### 5. Runtime event transport is not wired

Missing:

- `POST /api/runtime/events` style endpoint
- authentication/validation for runtime events
- bridge from runtime event ingestion into:
  - `ProjectRuntime`
  - `NotificationService`

### 6. Browser terminal integration is not cut over

Current reality:

- browser terminal still depends on legacy terminal attachment logic

Still needed:

- decide how the new runtime owns terminal attach/detach
- ensure new tmux session naming and legacy terminal discovery stay compatible during cutover
- eventually move terminal transport under the new architecture as well

### 7. Health monitoring and integrations are not migrated

Missing:

- service health reconciliation
- GitHub PR projection in the new runtime
- Linear issue projection in the new runtime
- CI/check integration in the new snapshot path

### 8. Frontend cutover has not started

Missing:

- frontend use of new snapshot endpoints
- frontend use of new create/remove/merge/open endpoints
- deletion of legacy data-shape assumptions once cutover is complete

## Recommended Next Steps

Build in this order.

### Step 1. Add a reconciliation service

Add a new service, for example:

- `backend/src/services/reconciliation-service.ts`

It should:

1. list Git worktrees
2. skip the main worktree for dashboard worktree rows
3. resolve each worktree Git admin dir
4. read `meta.json` when present
5. mark missing metadata as unmanaged
6. derive tmux window state from `TmuxGateway.listWindows()`
7. derive dirty/commit state from Git
8. derive service state from allocated ports
9. populate `ProjectRuntime`
10. remove runtime entries that no longer exist

This is the missing bridge between the real machine state and the new runtime model.

### Step 2. Add a config bridge into the new domain model

Add a temporary bridge so the new runtime can operate before the final config rewrite lands.

For example:

- `backend/src/services/config-bridge.ts`

It should translate current `.webmux.yaml` loading into `ProjectConfig`, including:

- project name
- main branch
- worktree root
- services
- startup envs
- default profile
- sandbox profile if present
- temporary default pane templates for the new session model

This keeps the new runtime moving without blocking on the final config format.

### Step 3. Add parallel vnext API routes

Add a new route module, for example:

- `backend/src/api/vnext.ts`

First endpoints should be:

- `GET /api/vnext/project`
- `POST /api/vnext/worktrees`
- `POST /api/vnext/runtime/events`

These are enough to exercise the new stack end-to-end without replacing the legacy API yet.

### Step 4. Wire a minimal composition root into `server.ts`

Instantiate:

- `BunGitGateway`
- `BunTmuxGateway`
- `ProjectRuntime`
- `NotificationService`
- reconciliation service
- config bridge

Then expose only the additive vnext routes.

Do not remove legacy routes yet.

### Step 5. Cut over lifecycle routes one by one

Order:

1. create
2. open
3. remove
4. merge

Create should move first because it validates the whole model:

- config
- metadata
- runtime env
- tmux layout
- snapshot update

### Step 6. Cut over snapshot and notification flow

Once reconciliation and events are solid:

- switch frontend polling to the new snapshot path
- switch notification flow to the new runtime event path

### Step 7. Move integrations and delete legacy code

After the new lifecycle and snapshot paths fully replace legacy behavior:

- migrate service health
- migrate PR/CI integration
- migrate Linear integration
- delete `backend/src/workmux.ts`
- delete `/rpc/workmux`
- delete `.workmux.yaml` assumptions

## Concrete Immediate Next Task

If work resumes now, the best next implementation step is:

1. add `backend/src/services/reconciliation-service.ts`
2. add `backend/src/services/config-bridge.ts`
3. add `backend/src/api/vnext.ts`
4. wire `GET /api/vnext/project` into `backend/src/server.ts`

That is the smallest useful slice that makes the new architecture observable through the running app.

## Fresh Chat Guidance

If you want to continue in a fresh chat, use this document as the source of truth and ask for:

"Continue the `webmux` full-lifecycle refactor from `docs/full-lifecycle-status.md`, starting with the reconciliation service and vnext API routes."

## Local Workspace Note

There is an unrelated untracked file in the workspace:

- `Dockerfile.test-init`

It should be ignored and left untouched.
