# Full Lifecycle Implementation Steps

This is the concrete implementation order for moving `webmux` to full lifecycle ownership.

For the current hard-cutover direction, follow `docs/full-lifecycle-cutover-plan.md`.
This document still describes a parallel-build sequencing and includes compatibility-oriented steps that should not drive the current cutover plan.

It assumes:

- greenfield architecture
- no need to preserve old internal boundaries
- no need to preserve `workmux` compatibility
- all current product features must remain by the end

The goal is to build the new system in clean vertical slices, with each phase leaving the codebase in a coherent state.

## Guiding Strategy

Do not incrementally mutate the existing `workmux`-shaped backend.

Instead:

1. build the new architecture in parallel under new module boundaries
2. route a minimal new backend slice through the app as soon as possible
3. expand feature coverage in the new runtime
4. cut over the frontend
5. delete the old architecture completely

This avoids carrying legacy assumptions into the new design.

## Target Build Order

Implement in this order:

1. Domain model and config
2. Filesystem and Git storage model
3. tmux ownership layer
4. Worktree lifecycle service
5. Runtime snapshot service
6. Terminal transport
7. Agent event model
8. Health monitoring
9. GitHub and Linear integrations
10. Frontend cutover
11. Deletion of old code

That order matters. It builds the system from core ownership outward.

## Phase 0: Freeze the New Shape

Before writing runtime code, finalize the new structure.

Create the following directories:

```text
backend/src/
  domain/
  services/
  adapters/
  api/
  cli/
  agentctl/
```

Add empty or initial files:

```text
backend/src/domain/config.ts
backend/src/domain/model.ts
backend/src/domain/events.ts
backend/src/domain/policies.ts
backend/src/adapters/fs.ts
backend/src/adapters/git.ts
backend/src/adapters/tmux.ts
backend/src/adapters/docker.ts
backend/src/adapters/hooks.ts
backend/src/services/project-runtime.ts
backend/src/services/worktree-service.ts
backend/src/services/session-service.ts
backend/src/services/agent-service.ts
backend/src/services/snapshot-service.ts
backend/src/services/notification-service.ts
backend/src/services/health-service.ts
backend/src/services/integration-service.ts
backend/src/api/routes.ts
backend/src/api/ws.ts
backend/src/cli/init.ts
backend/src/agentctl/main.ts
```

### Deliverables

- final file layout exists
- legacy files are untouched for now
- new architecture has a place to live

### Done when

- every new responsibility has an obvious home
- no implementation work still depends on the old file boundaries

## Phase 1: Implement Domain and Config

Build the new canonical types first.

Files:

- `domain/config.ts`
- `domain/model.ts`
- `domain/events.ts`
- `domain/policies.ts`

### Implement

1. `ProjectConfig`
2. `WorkspaceConfig`
3. `ProfileConfig`
4. `PaneTemplate`
5. `ServiceSpec`
6. `WorktreeMeta`
7. `WorktreeRuntimeState`
8. `ProjectSnapshot`
9. runtime event types
10. policies for branch validation, pane validation, and remove/merge safety

### Also do here

- define the final `.webmux.yaml` schema
- remove all references to `.workmux.yaml` from the new config layer
- define explicit service env names like `FRONTEND_PORT`, `BACKEND_PORT`

### Tests

- config parsing
- schema defaults
- invalid profile layouts
- invalid branch names
- port allocation policy

### Done when

- all new runtime services can depend on these types
- no service needs to invent its own shape

## Phase 2: Implement Filesystem and Metadata Storage

Build the storage model around the worktree Git admin dir.

Files:

- `adapters/fs.ts`
- `adapters/git.ts`

### Implement

1. Resolve repo root
2. Resolve worktree Git admin dir with `git rev-parse --git-dir`
3. Compute internal paths:
   - `meta.json`
   - `runtime.env`
   - `control.env`
4. Read/write `WorktreeMeta`
5. Render `runtime.env`
6. Render `control.env`
7. Optional `.env.local` compatibility rendering
8. Enumerate worktrees from `git worktree list --porcelain`

### Rules

- `meta.json` is canonical
- `runtime.env` is generated from config + metadata
- `.env.local` is optional and never canonical

### Tests

- Git admin dir resolution
- metadata read/write
- runtime env rendering
- external worktree discovery
- unmanaged worktree detection

### Done when

- the system can discover worktrees and their metadata without touching tmux

## Phase 3: Implement the tmux Adapter and Session Ownership

Build full tmux ownership before lifecycle workflows.

Files:

- `adapters/tmux.ts`
- `services/session-service.ts`

### Implement

Adapter functions:

1. ensure tmux server exists
2. ensure project session exists
3. list windows and panes
4. create window
5. kill window
6. split panes
7. send keys / paste buffer
8. select pane
9. resize pane / resize window
10. get pane cwd / pane command
11. set window title or status

Service functions:

1. materialize pane layout from `PaneTemplate[]`
2. create deterministic `wm-{branch}` windows
3. rebuild a window from metadata + profile
4. detect whether a worktree is open
5. count panes
6. attach browser viewers to real worktree windows

### Important design rule

Do not let the lifecycle service issue raw tmux commands.

Only `session-service` owns tmux topology.

### Tests

- create window
- realize multi-pane layout
- rebuild closed worktree window
- find pane counts
- preserve deterministic naming

### Done when

- tmux ownership is completely `webmux`'s

## Phase 4: Implement the Worktree Lifecycle Service

Now that Git storage and tmux ownership exist, build create/open/merge/remove.

Files:

- `services/worktree-service.ts`

### Implement

1. `createWorktree`
2. `openWorktree`
3. `removeWorktree`
4. `mergeWorktree`

### `createWorktree` should do

1. validate request
2. choose branch
3. create Git worktree
4. create metadata
5. generate runtime env files
6. run pre-create hook with env injected directly
7. ask `session-service` to build the window
8. ask `agent-service` to start the runtime
9. run post-create hook with env injected directly

### `openWorktree` should do

1. resolve worktree
2. initialize metadata if unmanaged
3. ensure runtime env files exist
4. ask `session-service` to reopen or rebuild the window
5. optionally restart agent runtime

### `removeWorktree` should do

1. validate dirty policy
2. stop agent runtime
3. stop sandbox if any
4. kill tmux window
5. remove Git worktree
6. optionally delete branch

### `mergeWorktree` should do

1. validate dirty policy
2. merge into target branch
3. on conflict, preserve worktree
4. on success, optionally remove worktree

### Tests

- create host worktree
- open unmanaged worktree
- remove clean worktree
- remove dirty worktree rejected
- merge success
- merge conflict preservation

### Done when

- `workmux` is no longer needed for lifecycle operations

## Phase 5: Implement Agent Runtime and Event Flow

Build the agent process model separately from lifecycle.

Files:

- `services/agent-service.ts`
- `domain/events.ts`
- `agentctl/main.ts`
- `adapters/hooks.ts`

### Implement

1. build local agent command from metadata + profile
2. build sandbox agent command
3. start agent pane commands with `runtime.env` loaded
4. send prompts into agent pane
5. stop agent runtime
6. define runtime events:
   - `agent_started`
   - `agent_stopped`
   - `title_changed`
   - `pr_opened`
   - `runtime_error`

### Implement `webmux-agentctl`

This is the small helper used by hooks and wrapped agent commands.

Responsibilities:

- send runtime events to the backend
- not own lifecycle logic

### Hook strategy

- `webmux` installs hook scripts
- hooks source `control.env` or receive env directly
- hooks call `webmux-agentctl`

### Tests

- prompt injection
- stop event delivery
- PR opened event delivery
- title/status event updates

### Done when

- worktrees can communicate state changes without any `workmux` RPC model

## Phase 6: Implement Runtime Registry and Snapshot Service

Build the backend read model now that core runtime ownership exists.

Files:

- `services/project-runtime.ts`
- `services/snapshot-service.ts`
- `services/notification-service.ts`

### Implement

`project-runtime`:

1. boot reconciliation
2. in-memory `Map<branch, WorktreeRuntimeState>`
3. periodic reconciliation against Git + tmux + Docker
4. event application from `webmux-agentctl`

`snapshot-service`:

1. assemble `ProjectSnapshot`
2. include metadata-derived values
3. include session-derived values
4. include service health state
5. expose worktree list and selected worktree view models

`notification-service`:

1. create notifications from selected runtime events
2. track unread state
3. provide SSE stream

### Key design rule

Status is derived by reconciliation.
Events only improve latency.

That means:

- if an event is missed, reconciliation repairs state
- if everything works, the UI updates immediately

### Tests

- snapshot construction
- runtime event application
- reconciliation after server restart
- notification creation rules

### Done when

- the frontend can get a complete coherent read model from one backend runtime

## Phase 7: Implement Health, GitHub, and Linear Integrations

Build integrations on top of the snapshot model, not inside lifecycle services.

Files:

- `services/health-service.ts`
- `services/integration-service.ts`
- `adapters/github.ts`
- `adapters/linear.ts`

### Implement

`health-service`:

1. probe ports from metadata/runtime env
2. derive URLs from config templates
3. refresh health state on interval

`integration-service`:

1. fetch PRs by branch
2. fetch CI status
3. fetch review comments
4. fetch assigned Linear issues
5. match issues to worktrees
6. feed results into `snapshot-service`

### Tests

- service health projection
- GitHub PR matching
- CI and review comment mapping
- Linear issue matching

### Done when

- all existing dashboard enrichments are fed by the new runtime

## Phase 8: Implement HTTP and WebSocket Presentation

Only now wire the new backend into routes.

Files:

- `api/routes.ts`
- `api/ws.ts`

### Implement routes

1. `GET /api/project`
2. `GET /api/worktrees`
3. `POST /api/worktrees`
4. `POST /api/worktrees/:branch/open`
5. `POST /api/worktrees/:branch/merge`
6. `DELETE /api/worktrees/:branch`
7. `POST /api/worktrees/:branch/prompt`
8. `POST /api/runtime/events`
9. notification SSE routes

### Implement terminal WebSocket

1. attach to real worktree window via `session-service`
2. forward pane output
3. forward input
4. support pane selection and resize

### Design rule

Routes stay thin.

No route should contain lifecycle logic.

### Tests

- API create/open/remove/merge
- runtime event ingestion
- terminal attach and prompt send

### Done when

- the frontend can run entirely on the new presentation layer

## Phase 9: Cut the Frontend Over to Snapshot-Driven State

Now simplify frontend data flow instead of preserving old shapes.

Files:

- frontend API layer
- app state management
- worktree list/top bar/terminal integration components

### Implement

1. load project snapshot from a single primary endpoint
2. keep focused worktree in client state
3. use notifications SSE
4. use terminal WS
5. keep create/open/remove/merge actions thin

### Important

Do not preserve frontend assumptions that exist only because the old backend was split.

The frontend should consume:

- a clean snapshot
- a terminal stream
- notifications

### Tests

- initial snapshot load
- selected worktree switching
- notification handling
- terminal interaction

### Done when

- frontend no longer relies on legacy backend response assembly

## Phase 10: Replace `init` and Setup Tooling

Now remove old setup assumptions.

Files:

- `cli/init.ts`
- docs

### Implement

1. `webmux init` generates only `.webmux.yaml`
2. no `workmux` dependency check
3. optional compatibility mode for `.env.local`
4. install hook scripts for `webmux-agentctl`

### Done when

- setup reflects the new architecture honestly

## Phase 11: Delete Legacy Architecture

Delete all old architecture once the new backend is functional.

Delete:

- `backend/src/workmux.ts`
- legacy RPC model
- any `workmux` subprocess calls
- `.workmux.yaml` generation and parsing
- container-side fake `workmux` shims
- legacy docs that present `workmux` as required

### Done when

- the codebase has one architecture, not two

## Recommended First Three Commits

If starting implementation now, I would do these first:

### Commit 1

Scaffold the new structure and add domain/config/model files with tests.

Result:

- the target architecture exists in code

### Commit 2

Implement Git admin dir metadata storage plus runtime env rendering.

Result:

- worktree metadata, `runtime.env`, and `control.env` are real

### Commit 3

Implement tmux adapter plus `session-service` window creation and pane layout realization.

Result:

- `webmux` now owns tmux topology, which is the most important architectural boundary

## Recommended First End-to-End Milestone

The first real milestone should be:

- create worktree
- create metadata
- generate runtime env
- create tmux window and panes
- attach browser terminal

Do not start with PR/CI/Linear.
Do not start with sandbox.
Do not start with notifications.

Start with the core truth:

- Git worktree exists
- metadata exists
- tmux window exists
- browser can attach

Once that works, the rest of the product becomes much easier to rebuild cleanly.

## What I Would Implement First In Practice

Immediate next coding step:

1. add the new backend directories and domain types
2. implement:
   - `adapters/git.ts`
   - `adapters/fs.ts`
   - `services/worktree-service.ts` metadata subset
3. make a small test command or script that:
   - resolves repo root
   - resolves worktree Git admin dir
   - writes `meta.json`
   - writes `runtime.env`

That is the correct first slice because it fixes the storage and ownership model before touching the runtime behavior.
