# Full Lifecycle Hard-Cutover Plan

This document replaces the migration-first next steps in the current refactor notes.

Use this plan if the goal is:

- no temporary compatibility layer
- no parallel `vnext` API
- no requirement for old code to keep working during the refactor
- the cleanest final architecture, even if cutover is abrupt on the refactor branch

## Core Decision

Treat the refactor as a hard cutover inside the refactor branch.

Do not build bridge layers to help the old architecture coexist with the new one.
Do not preserve old routes, old config assumptions, or old runtime shims once the new path is ready to replace them.

## What Is Already Done And Should Stay

The current refactor already has useful foundations:

- domain types under `backend/src/domain/`
- canonical metadata and env storage under `backend/src/adapters/fs.ts`
- Git worktree primitives under `backend/src/adapters/git.ts`
- tmux naming and layout foundations under `backend/src/adapters/tmux.ts` and `backend/src/services/session-service.ts`
- lifecycle primitives under `backend/src/services/worktree-service.ts`
- runtime, snapshot, notification, and agent command foundations under `backend/src/services/`
- passing backend tests for the new modules

These pieces are worth keeping. The main problem is the planned execution strategy, not the existence of the new modules.

## Progress Checkpoint

The first cutover slices are already complete.

Completed:

- final `.webmux.yaml` loading through `ProjectConfig`
- removal of `.workmux.yaml` from the new config path
- removal of `.env.local` compatibility from the new lifecycle path
- internal runtime identity keyed by `worktreeId`
- reconciliation of Git, metadata, and tmux-backed runtime state
- snapshot-backed `GET /api/project`
- `POST /api/runtime/events`
- runtime-backed notification stream and dismiss
- terminal websocket cutover onto deterministic runtime-owned tmux targets
- prompt send cutover onto the new terminal transport
- removal of the live `/rpc/workmux` route

Still remaining:

- lifecycle route cutover
- frontend move to `GET /api/project`
- Docker and hook event delivery through `webmux-agentctl`
- deletion of legacy backend code

## What Must Change In The Current Refactor

### 1. Stop planning migration scaffolding

Drop the following from the plan:

- temporary config bridge
- additive `/api/vnext/*` routes
- legacy/new parallel runtime paths
- compatibility-driven sequencing

Replace the old implementation in place instead.

### 2. Make `worktreeId` the primary internal identity

The refactor plan already introduced stable worktree identity in metadata. That identity needs to become the internal key everywhere.

Change:

- runtime event payloads
- `ProjectRuntime` storage
- reconciliation bookkeeping
- notification linkage
- terminal/session lookup internals

Rule:

- `worktreeId` is the internal key
- `branch` is a mutable attribute and display field

External APIs may still accept a branch name where that is the most natural user input, but the server should resolve branch to `worktreeId` immediately and use `worktreeId` internally from that point on.

### 3. Remove `.env.local` compatibility from the new architecture

The new stack should not emit or depend on `.env.local`.

Change:

- remove `emitCompatibilityEnv`
- remove compatibility env rendering from the new lifecycle path
- update pane startup, hooks, and sandbox launch flow to use `runtime.env` or direct env injection
- update project instructions and prompts to stop telling agents to source `.env.local`

Rule:

- `meta.json` is canonical durable state
- `runtime.env` and `control.env` are generated runtime artifacts
- `.env.local` is not part of the new architecture

### 4. Rewrite config loading to the final schema now

Do not add a bridge from the old config loader to the new domain model.

Instead:

- rewrite `backend/src/config.ts` to load the final `.webmux.yaml` shape into `ProjectConfig`
- remove `.workmux.yaml` reads completely
- define final pane/profile/service/startup env handling once
- move all new services to depend on `ProjectConfig`, not legacy config types

This removes one of the biggest sources of architecture drift.

### 5. Finish the lifecycle service as a real orchestrator

The new lifecycle service needs to own the full workflow, not just the happy path.

Add:

- explicit request validation using domain policies
- rollback/compensation when create fails after partially creating resources
- open semantics for unmanaged worktrees
- safe remove sequencing
- merge semantics that preserve or restore repo state on failure

Rule:

- no partially created managed worktree should be left behind without explicit recovery behavior

### 6. Pull terminal transport into the new architecture now

Terminal transport is still one of the strongest legacy anchors. It should move earlier, not later.

Change:

- replace legacy session discovery assumptions
- make terminal attach target the new deterministic session/window ownership model
- let the new `session-service` own pane targeting metadata
- make prompt sending part of the new lifecycle/session surface

This should happen before GitHub, Linear, and other enrichments.

### 7. Replace existing API routes in place

Do not add new public route families for migration purposes.

Instead:

- introduce a proper composition root for the new services
- replace the current `/api/*` handlers with the new implementations
- simplify frontend data flow around the new snapshot

Target backend surface:

- `GET /api/project`
- `POST /api/worktrees`
- `POST /api/worktrees/:branch/open`
- `DELETE /api/worktrees/:branch`
- `POST /api/worktrees/:branch/merge`
- `POST /api/worktrees/:branch/prompt`
- `POST /api/runtime/events`
- notification SSE
- terminal WS

Once the frontend moves to `GET /api/project`, delete legacy split endpoints that only exist because of the old backend shape.

### 8. Replace `workmux`-style runtime messaging completely

Do not keep `rpc.ts`, `/rpc/workmux`, hook scripts that call `workmux`, or container-side `workmux` stubs in the new path.

Instead:

- add `webmux-agentctl`
- make hooks and wrapped agent commands call `webmux-agentctl`
- feed runtime events into the new runtime event endpoint
- authenticate via `control.env`

### 9. Rebuild Docker integration around `webmux`, not `workmux`

The current sandbox code still injects a fake `workmux` binary into containers. That needs to disappear.

Change:

- mount or inject only what the new runtime needs
- provide runtime and control env directly
- use `webmux-agentctl` for event delivery from inside containers
- keep Docker as an adapter, not as a compatibility host for old RPC behavior

### 10. Delete legacy code as soon as the new slice is live

Because old behavior does not need to keep working during the refactor, deletion should happen earlier than a migration plan would normally allow.

Delete once the new slice is running end to end:

- `backend/src/workmux.ts`
- `backend/src/rpc.ts`
- `backend/src/rpc-secret.ts`
- legacy notification plumbing in `backend/src/notifications.ts`
- legacy terminal ownership in `backend/src/terminal.ts`
- `.workmux.yaml` support
- container-side `workmux` shims

## Recommended Execution Order

## Phase 1: Lock The Final Shape

Status: complete

Do first:

1. rewrite config loading to final `ProjectConfig`
2. remove `.workmux.yaml` support
3. remove `.env.local` compatibility from the new code
4. switch new runtime internals from branch-keyed to `worktreeId`-keyed

Done when:

- the new architecture no longer depends on legacy config or compatibility artifacts

## Phase 2: Add Reconciliation As The New Source Of Runtime Truth

Status: complete

Implement `backend/src/services/reconciliation-service.ts`.

It should:

1. enumerate Git worktrees
2. resolve each worktree Git admin dir
3. read `meta.json` where present
4. classify managed vs unmanaged worktrees
5. derive tmux state from the new session naming model
6. derive service state from metadata/config
7. populate `ProjectRuntime` keyed by `worktreeId`
8. remove stale runtime entries

Rule:

- reconciliation is authoritative
- events improve latency only

## Phase 3: Cut Over Runtime I/O In Place

Status: in progress

Build the new composition root and replace the current handlers.

Do:

1. add the new API route module and composition root
2. replace `GET /api/worktrees` with a snapshot-backed path or move directly to `GET /api/project`
3. add `POST /api/runtime/events`
4. replace notification flow with the new runtime-backed notification service
5. replace terminal WS attach/send behavior with the new session ownership model

At the end of this phase, the running app should be using the new runtime for reads and terminal interaction.

## Phase 4: Finish Lifecycle Operations

Complete and wire:

1. create
2. open
3. remove
4. merge
5. prompt send

Add:

- request validation
- compensation logic
- cleanup sequencing
- deterministic session realization

At the end of this phase, `workmux` should no longer be needed for lifecycle or terminal behavior.

## Phase 5: Migrate Docker And Agent Event Flow

Do:

1. add `webmux-agentctl`
2. change hooks to call `webmux-agentctl`
3. change container runtime to use `webmux-agentctl`, not a fake `workmux`
4. feed events into `ProjectRuntime` and `NotificationService`

At the end of this phase, the runtime event path should be fully native to `webmux`.

## Phase 6: Add Health And Integrations On Top

Only after the core runtime is live:

1. health monitoring
2. GitHub PR and CI projection
3. Linear issue projection

Rule:

- these enrichments project onto the runtime snapshot
- they do not drive lifecycle ownership

## Phase 7: Delete Legacy Architecture

After the app is running on the new stack:

1. delete legacy backend modules
2. delete legacy route handlers
3. delete legacy docs that describe `workmux` as required
4. simplify the frontend to the new snapshot and terminal model only

## Immediate Next Steps

Do these next, in order:

1. Replace terminal attach/send with the new session ownership model.
2. Wire create/open/remove/merge/prompt through the new lifecycle service.
3. Move the frontend read path to `GET /api/project`.
4. Replace Docker and hook event delivery with `webmux-agentctl`.
5. Delete the old terminal and notification plumbing once the new slice is live.

## Non-Negotiable Rules For The Rest Of The Refactor

- No temporary compatibility layer.
- No `vnext` route family.
- No `.workmux.yaml` support in the new stack.
- No `.env.local` dependency in the new stack.
- No `workmux` subprocesses or RPC in the new stack.
- No branch-keyed internal identity where `worktreeId` is available.
- No frontend preservation work for old backend response shapes.

## Definition Of Done

The refactor is done when:

- the running app uses one runtime model
- the frontend reads one coherent project snapshot
- terminal transport is owned by the new session model
- agent events flow through `webmux-agentctl`
- Docker integration does not inject or call `workmux`
- lifecycle operations do not call legacy code
- `.workmux.yaml`, `/rpc/workmux`, and `workmux.ts` are gone
- the codebase has one architecture, not a migration architecture
