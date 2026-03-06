# `webmux` Full-Lifecycle Refactor Plan

This plan assumes a clean rewrite of the lifecycle layer.

Constraints for this plan:

- `webmux` owns the full lifecycle
- `workmux` is removed entirely from the architecture
- backward compatibility is not a goal
- reuse of current code is optional, not required
- all current product features must remain
- the result must be simpler and more coherent than the current codebase

## Goals

The refactor should produce a system where:

- one product owns one coherent lifecycle model
- one config file defines the default behavior
- Git, tmux, Docker, GitHub, and Linear are adapters, not product owners
- there is a clean separation between domain logic, infrastructure, and presentation
- state is explicit and typed
- read models are derived from a single runtime model
- generated artifacts are not mistaken for source of truth

## Non-Goals

This refactor does not aim to:

- preserve `.workmux.yaml`
- preserve `workmux` CLI behavior
- preserve `/rpc/workmux`
- preserve container-side `workmux` shims
- preserve the exact internal module layout of the current codebase

## Product Surface To Preserve

The rewritten system must preserve all current user-facing features:

1. Create, open, merge, and remove worktrees
2. Embedded browser terminals with multi-pane support
3. Send prompts into the agent pane
4. Service health monitoring with port allocation
5. PR, CI, and comment visibility
6. Linear issue matching and display
7. Startup environment variable inputs
8. Notifications for agent stop and PR creation
9. Docker sandbox profiles
10. Keyboard-driven worktree switching and management

## Design Principles

## 1. One source of truth per concern

- Git is the source of truth for worktree existence and branch state
- tmux is the source of truth for terminal topology and live panes
- `webmux` metadata is the source of truth for profile, agent, runtime mode, and worktree-local settings
- `webmux` config is the source of truth for project defaults, pane templates, services, and integrations

No generated file should be treated as canonical state.

## 2. Declarative config, imperative runtime

Config describes intent.

Runtime services execute that intent against Git, tmux, Docker, and integrations.

This keeps configuration stable while allowing runtime behavior to be explicit and testable.

## 3. Derived read model

The frontend should read a single derived project snapshot.

That snapshot should be assembled from explicit sources:

- config
- worktree metadata
- Git state
- tmux state
- integration state
- health state

The frontend should not need to reconstruct product state from unrelated APIs.

## 4. Greenfield module boundaries

Do not preserve the current boundaries just because they exist.

The new system should have modules aligned to responsibilities, not to legacy dependencies.

## 5. Generated artifacts are outputs, not inputs

Examples:

- `.env.local` is an optional compatibility output for app processes
- tmux window names are runtime outputs
- hook scripts are generated outputs

They are not the canonical model.

## 6. Keep runtime single-process and boring

The architecture should remain simple:

- one Bun server process
- in-memory runtime registry
- filesystem metadata
- direct adapter calls to Git, tmux, Docker, GitHub, Linear

No database is needed for this product.

## Target Architecture

The clean base architecture has five layers:

1. Domain
2. Application services
3. Infrastructure adapters
4. Presentation layer
5. Generated artifacts

## 1. Domain Layer

The domain layer defines all product types and rules.

It contains no subprocess execution, HTTP calls, or filesystem side effects.

Files:

- `domain/config.ts`
- `domain/model.ts`
- `domain/events.ts`
- `domain/policies.ts`

Responsibilities:

- typed config schema
- typed runtime model
- worktree naming rules
- port allocation policy
- pane layout validation
- merge/remove safety rules
- event type definitions

## 2. Application Services Layer

This layer owns business workflows.

Files:

- `services/project-runtime.ts`
- `services/worktree-service.ts`
- `services/session-service.ts`
- `services/agent-service.ts`
- `services/health-service.ts`
- `services/integration-service.ts`
- `services/notification-service.ts`
- `services/snapshot-service.ts`

Responsibilities:

- create/open/merge/remove workflows
- reconciliation of Git, tmux, metadata, and integrations
- maintaining in-memory runtime state
- triggering health and integration refreshes
- constructing the frontend snapshot

## 3. Infrastructure Adapters Layer

This layer talks to the outside world.

Files:

- `adapters/git.ts`
- `adapters/tmux.ts`
- `adapters/docker.ts`
- `adapters/github.ts`
- `adapters/linear.ts`
- `adapters/fs.ts`
- `adapters/hooks.ts`

Responsibilities:

- execute subprocesses
- read and write files
- manage tmux windows and panes
- manage Docker containers
- fetch GitHub and Linear data
- install runtime hooks

These adapters should be dumb, focused, and easy to test with fixtures or integration tests.

## 4. Presentation Layer

This layer exposes the runtime to the frontend and CLI.

Files:

- `api/http.ts`
- `api/ws.ts`
- `cli/init.ts`
- `cli/doctor.ts`
- `cli/hooks.ts`
- `cli/server.ts`
- `agentctl/main.ts`

Responsibilities:

- HTTP routes
- WebSocket terminal transport
- setup commands
- hook installation
- agent-side event helper

## 5. Generated Artifacts Layer

These are not source code and not source of truth.

Artifacts:

- `.webmux.yaml`
- `<worktree-git-dir>/webmux/meta.json`
- `<worktree-git-dir>/webmux/runtime.env`
- `<worktree-git-dir>/webmux/control.env`
- `<worktree>/.env.local` when compatibility output is enabled
- `<repo>/.webmux/secret`
- `<repo>/.webmux/hooks/*`

## Single Config Model

The new architecture uses one project config file:

- `.webmux.yaml`

Suggested top-level schema:

```yaml
name: My Project

workspace:
  mainBranch: main
  worktreeRoot: __worktrees
  defaultAgent: claude

profiles:
  default:
    runtime: host
    systemPrompt: >
      You are working inside a project managed by webmux.
    envPassthrough:
      - GITHUB_TOKEN
    panes:
      - id: agent
        kind: agent
        focus: true
      - id: shell
        kind: shell
        split: right
        sizePct: 25

  sandbox:
    runtime: docker
    image: my-sandbox
    systemPrompt: >
      You are running inside a sandbox.
    envPassthrough:
      - AWS_ACCESS_KEY_ID
      - AWS_SECRET_ACCESS_KEY
    mounts:
      - hostPath: ~/.codex
        guestPath: /root/.codex
        writable: true
    panes:
      - id: agent
        kind: agent
        focus: true
      - id: shell
        kind: shell
        split: right
        sizePct: 25

services:
  - name: app
    portEnv: PORT
    portStart: 3000
    portStep: 10
    urlTemplate: http://127.0.0.1:${PORT}

startupEnvs:
  NODE_ENV: development

integrations:
  github:
    linkedRepos:
      - repo: org/other-repo
        alias: other
  linear:
    enabled: true
```

### Config Rules

- one file only
- pane layout belongs to profile config
- sandbox config belongs to profile config
- service monitoring belongs to project config
- startup envs belong to project config
- worktree root belongs to project config

This collapses the current split between `.webmux.yaml` and `.workmux.yaml`.

## Core Data Structures

The rewrite needs explicit domain data types.

## Project Config

```ts
export interface ProjectConfig {
  name: string;
  workspace: WorkspaceConfig;
  profiles: Record<string, ProfileConfig>;
  services: ServiceSpec[];
  startupEnvs: Record<string, string | boolean>;
  integrations: IntegrationConfig;
}

export interface WorkspaceConfig {
  mainBranch: string;
  worktreeRoot: string;
  defaultAgent: "claude" | "codex";
}

export interface ProfileConfig {
  runtime: "host" | "docker";
  systemPrompt?: string;
  envPassthrough: string[];
  panes: PaneTemplate[];
  image?: string;
  mounts?: MountSpec[];
}

export interface PaneTemplate {
  id: string;
  kind: "agent" | "shell" | "command";
  split?: "right" | "bottom";
  sizePct?: number;
  focus?: boolean;
  command?: string;
  cwd?: "worktree" | "repo";
}

export interface ServiceSpec {
  name: string;
  portEnv: string;
  portStart?: number;
  portStep?: number;
  urlTemplate?: string;
}
```

## Persisted Worktree Metadata

Persist canonical worktree metadata in the worktree Git admin dir, not in the tracked working tree.

Canonical path:

- `<worktree-git-dir>/webmux/meta.json`

Where:

- `<worktree-git-dir>` is resolved with `git rev-parse --git-dir` inside that worktree

This is the correct storage location because:

- it is per-worktree by construction
- it does not pollute the working tree
- it does not require `.gitignore` entries
- it is not visible as dirty Git state
- it is removed naturally with the worktree admin data

Suggested types:

```ts
export interface WorktreeMeta {
  schemaVersion: number;
  worktreeId: string;
  branch: string;
  createdAt: string;
  profile: string;
  agent: "claude" | "codex";
  runtime: "host" | "docker";
  startupEnvValues: Record<string, string>;
  allocatedPorts: Record<string, number>;
}
```

Rationale:

- metadata is durable but not tracked by the repo
- generated env files stay derived
- the system does not need a central database

### What belongs in metadata

- stable worktree identity
- selected profile
- selected agent
- selected runtime mode
- startup env values chosen for that worktree
- allocated service ports

### What does not belong in metadata

- live agent status
- tmux session ids
- PR or CI state
- Linear issue state
- secret passthrough values from the host
- notification history

## Metadata and Env Handling

The rewrite should explicitly separate:

1. durable worktree metadata
2. runtime env for panes, hooks, and agents
3. optional compatibility env files for app tooling

This is necessary to keep the architecture clean.

### Storage model

Per worktree, `webmux` should manage:

- `<worktree-git-dir>/webmux/meta.json`
- `<worktree-git-dir>/webmux/runtime.env`
- `<worktree-git-dir>/webmux/control.env`

Optional compatibility output:

- `<worktree>/.env.local`

Roles:

- `meta.json`
  - canonical durable metadata
- `runtime.env`
  - exported environment for `webmux`-managed panes, hooks, and agents
- `control.env`
  - internal control values for talking back to the `webmux` server
- `.env.local`
  - optional mirror for frameworks and tooling that auto-load it

### Why not store canonical metadata in the worktree root

If metadata or internal env lived under `<worktree>/...`, users would have to ignore those files and they would be at risk of showing up in Git status.

That is avoidable. The worktree Git admin dir is the correct location for `webmux`'s own internal files.

### Canonical env model

The canonical env model is:

1. project config defaults
2. persisted worktree metadata
3. generated runtime env

`runtime.env` is generated from config plus metadata. It is not the source of truth itself.

Suggested contents of `runtime.env`:

```bash
PORT=3010
FRONTEND_PORT=3010
BACKEND_PORT=5111
NODE_ENV=development
WEBMUX_BRANCH=feature/search-panel
WEBMUX_PROFILE=default
WEBMUX_AGENT=claude
WEBMUX_RUNTIME=host
```

Suggested contents of `control.env`:

```bash
WEBMUX_CONTROL_URL=http://127.0.0.1:5111
WEBMUX_CONTROL_TOKEN=...
WEBMUX_WORKTREE_ID=wt_01JQ8Q8QKQ0W8K5M6P2P9D4T7A
WEBMUX_BRANCH=feature/search-panel
```

### Rule: `.env.local` is not canonical

`.env.local` should exist only as an optional compatibility projection.

It must never be:

- the source of truth for allocated ports
- the source of truth for startup env selections
- the mechanism by which hooks discover lifecycle data

### How panes know the correct port

The user or agent inside a pane should know the correct port because the shell environment already contains it.

That means:

1. `webmux` allocates ports during worktree creation
2. `webmux` persists them in `meta.json`
3. `webmux` renders `runtime.env`
4. pane shells are started through a thin launcher that loads `runtime.env`
5. all commands inside that shell inherit those env vars

So if a user says "start the frontend", the pane already has:

```bash
FRONTEND_PORT=3010
```

and the agent or user can run:

```bash
npm run dev -- --port "$FRONTEND_PORT"
```

or simply `npm run dev` if the app already respects the exported env.

### `webmux-shell`

Every `webmux`-managed shell or command pane should start via a tiny launcher:

- `webmux-shell`

Responsibilities:

1. resolve the worktree Git admin dir
2. source `<worktree-git-dir>/webmux/runtime.env`
3. export those values
4. `exec` the real shell or command

This keeps env propagation deterministic without polluting the working tree.

### Hooks should receive env directly

Lifecycle hooks should not have to parse `.env.local`.

For both pre-create and post-create hooks, `webmux` should pass env directly to the hook subprocess.

That env should include:

- allocated ports
- startup env values
- `WEBMUX_BRANCH`
- `WEBMUX_PROFILE`
- `WEBMUX_AGENT`
- `WEBMUX_RUNTIME`
- `WEBMUX_WORKTREE_PATH`

This makes hook behavior independent of file layout and timing.

### Agent processes should also receive env directly

The agent pane and sandbox runtime should receive runtime env directly from `webmux`, not by discovering files ad hoc.

That means:

- local agent commands are launched with `runtime.env` loaded
- sandbox containers receive the same effective env set
- optional `.env.local` generation is a compatibility output, not a dependency

### External and unmanaged worktrees

If `webmux` discovers a worktree with no `meta.json`, it should treat it as unmanaged.

Behavior:

- show it in the UI
- derive minimal state from Git and tmux
- on first `open` or explicit initialize, create metadata and runtime env

This preserves current external-worktree support without making metadata discovery messy.

## Runtime State

```ts
export interface WorktreeRuntimeState {
  branch: string;
  path: string;
  git: GitWorktreeState;
  session: SessionState;
  agent: AgentState;
  services: ServiceRuntimeState[];
  integrations: IntegrationRuntimeState;
}

export interface GitWorktreeState {
  exists: boolean;
  branch: string;
  dirty: boolean;
  aheadCount: number;
  currentCommit: string;
}

export interface SessionState {
  exists: boolean;
  sessionName: string | null;
  windowName: string;
  paneCount: number;
  panes: PaneState[];
}

export interface PaneState {
  id: string;
  index: number;
  kind: "agent" | "shell" | "command";
  cwd: string;
  command: string;
  active: boolean;
}

export interface AgentState {
  runtime: "host" | "docker";
  lifecycle: "closed" | "starting" | "running" | "idle" | "stopped" | "error";
  title: string;
  lastStartedAt: string | null;
  lastEventAt: string | null;
}

export interface ServiceRuntimeState {
  name: string;
  port: number | null;
  running: boolean;
  url: string | null;
}
```

## Project Snapshot

The frontend should consume a single read model built from the runtime state.

```ts
export interface ProjectSnapshot {
  project: {
    name: string;
    mainBranch: string;
  };
  worktrees: WorktreeView[];
  notifications: NotificationView[];
  integrations: IntegrationOverview;
}

export interface WorktreeView {
  branch: string;
  path: string;
  dir: string;
  profile: string;
  agentName: string;
  mux: boolean;
  dirty: boolean;
  paneCount: number;
  agent: AgentView;
  services: ServiceView[];
  prs: PrView[];
  linearIssue: LinearIssueView | null;
}
```

This gives the frontend one coherent contract instead of multiple partially-overlapping sources.

## Separation of Concern by Module

## `worktree-service`

Owns:

- create
- open
- merge
- remove
- metadata initialization
- port allocation
- runtime env generation
- optional `.env.local` compatibility generation

Does not own:

- tmux command details
- Docker command details
- HTTP
- GitHub or Linear fetching

## `session-service`

Owns:

- tmux server bootstrapping
- project session management
- window creation and deletion
- pane layout realization
- pane selection
- pane resize
- attach metadata lookup
- window status/title updates

Does not own:

- Git operations
- worktree metadata
- PR or Linear logic

## `agent-service`

Owns:

- agent command construction
- local agent startup
- sandbox agent startup
- agent status events
- prompt injection into the agent pane

Does not own:

- worktree creation
- tmux topology
- GitHub polling

## `health-service`

Owns:

- service port health probes
- service URL derivation
- poll scheduling

Does not own:

- port allocation rules
- config loading
- tmux state

## `integration-service`

Owns:

- GitHub PR fetch
- CI fetch
- review comment fetch
- Linear issue fetch
- branch-to-issue matching

Does not own:

- worktree lifecycle
- tmux
- agent runtime

## `notification-service`

Owns:

- notification creation
- in-memory history
- SSE broadcast
- unread state policy

Does not own:

- agent runtime
- PR fetch logic

## `snapshot-service`

Owns:

- assembling `ProjectSnapshot`
- read-model caching
- merging domain and integration state into frontend view types

Does not own:

- side effects
- subprocesses

## Runtime Flows

## Boot Flow

1. Load `.webmux.yaml`
2. Resolve repo root and worktree root
3. Ensure `.webmux/` internal directory exists
4. Load persisted worktree metadata from each worktree Git admin dir
5. Reconcile Git worktrees
6. Reconcile tmux session/window state
7. Reconcile sandbox containers
8. Start health, PR, and Linear monitors
9. Build and cache initial `ProjectSnapshot`

## Create Worktree Flow

1. Validate request against config and naming rules
2. Allocate branch name if needed
3. Create Git worktree under configured worktree root
4. Create worktree metadata
5. Generate `runtime.env` and `control.env`
6. Optionally generate `.env.local`
7. Ensure tmux server and project session exist
8. Create the worktree window
9. Realize the pane layout from the selected profile
10. Launch local or sandbox runtime
11. Start the agent in the designated pane
12. Reconcile runtime state
13. Emit snapshot update

## Open Worktree Flow

1. Locate existing Git worktree
2. Ensure metadata exists or regenerate it
3. Ensure `runtime.env` and `control.env` exist
4. Ensure tmux server and project session exist
5. If window exists, focus or reopen it
6. If window does not exist, recreate layout from profile
7. Restore or restart agent/runtime as configured
8. Reconcile runtime state
9. Emit snapshot update

## Merge Worktree Flow

1. Validate target worktree exists
2. Validate clean-state policy
3. Switch to main repo context
4. Merge worktree branch into configured target branch
5. If merge fails, stop and preserve worktree
6. If merge succeeds, optionally keep or remove the worktree
7. Reconcile Git and tmux state
8. Emit snapshot update

## Remove Worktree Flow

1. Validate clean-state policy or `force`
2. Stop agent runtime
3. Stop sandbox container if present
4. Kill tmux window
5. Remove Git worktree
6. Delete branch if configured
7. Remove metadata
8. Emit snapshot update

## Agent Event Flow

The new architecture should not use `workmux`-style RPC names.

Introduce a small helper command:

- `webmux-agentctl`

Responsibilities:

- send `agent_stopped`
- send `pr_opened`
- send `window_status_changed`

API endpoint:

- `POST /api/runtime/events`

Event payload:

```ts
export interface RuntimeEvent {
  branch: string;
  type: "agent_stopped" | "pr_opened" | "window_status_changed";
  url?: string;
  title?: string;
}
```

This is cleaner than preserving `/rpc/workmux`.

## tmux Ownership Model

`webmux` should fully own tmux topology.

Rules:

- one project tmux session per repo
- one window per worktree
- deterministic window name: `wm-{branch}`
- pane layout materialized from profile templates
- browser viewers are separate ephemeral grouped sessions
- no implicit topology owned by another tool

This removes split ownership and simplifies reasoning about session state.

## Environment Model

Use a four-part environment model:

1. project config defaults
2. worktree metadata values
3. generated runtime env for managed processes
4. optional compatibility output for app tooling

Canonical model:

- config plus metadata

Generated outputs:

- `<worktree-git-dir>/webmux/runtime.env`
- `<worktree-git-dir>/webmux/control.env`
- optional `<worktree>/.env.local`

Rules:

- only `worktree-service` writes metadata and generated env files
- no other module mutates them directly
- service port allocation uses metadata, not ad-hoc file scanning alone
- panes and agents get env from `runtime.env` or direct process injection
- hooks get env directly from `webmux` when invoked

## Integration Model

Integrations should attach to the runtime snapshot, not control lifecycle.

GitHub responsibilities:

- discover PRs by branch
- fetch CI state
- fetch review comments

Linear responsibilities:

- fetch assigned issues
- match issues to branches

These remain orthogonal to lifecycle.

## API Design

The HTTP layer should be thin.

Suggested routes:

- `GET /api/project`
- `GET /api/worktrees`
- `POST /api/worktrees`
- `POST /api/worktrees/:branch/open`
- `POST /api/worktrees/:branch/merge`
- `DELETE /api/worktrees/:branch`
- `POST /api/worktrees/:branch/prompt`
- `GET /api/notifications`
- `POST /api/notifications/:id/dismiss`
- `POST /api/runtime/events`
- `WS /ws/term/:branch`

Rules:

- HTTP handlers only validate I/O and call services
- all business logic lives below the route layer

## Testing Strategy

The rewrite should be test-led around the new boundaries.

## Pure Unit Tests

- config parsing and validation
- branch naming rules
- port allocation
- pane layout planning
- snapshot projection
- merge/remove policy rules

## Adapter Integration Tests

- `git worktree` operations
- tmux window and pane creation
- Docker container lifecycle
- GitHub API parsing
- Linear API parsing

## Workflow Integration Tests

- create worktree
- reopen worktree
- send prompt to agent pane
- merge success
- merge conflict preservation
- remove worktree
- sandbox startup
- service health visibility

## End-to-End Smoke Tests

- create worktree from UI
- attach terminal
- verify PR/CI enrichment
- verify notification flow

## Recommended Repository Structure

Suggested backend structure:

```text
backend/src/
  domain/
    config.ts
    model.ts
    events.ts
    policies.ts
  services/
    project-runtime.ts
    worktree-service.ts
    session-service.ts
    agent-service.ts
    health-service.ts
    integration-service.ts
    notification-service.ts
    snapshot-service.ts
  adapters/
    git.ts
    tmux.ts
    docker.ts
    github.ts
    linear.ts
    fs.ts
    hooks.ts
  api/
    http.ts
    ws.ts
    routes.ts
  cli/
    init.ts
    doctor.ts
    hooks.ts
    server.ts
  agentctl/
    main.ts
```

This is cleaner than the current boundary between `workmux.ts`, `terminal.ts`, `rpc.ts`, and `docker.ts`.

## Implementation Phases

## Phase 1: Freeze the target model

Deliverables:

- final config schema
- final domain types
- final module boundaries
- final runtime event model

Success criteria:

- no legacy terms remain in the new design
- the architecture is internally coherent before code is written

## Phase 2: Build the domain and adapters

Deliverables:

- domain types
- config loader
- git adapter
- tmux adapter
- docker adapter
- hook installer

Success criteria:

- adapters can be integration-tested in isolation

## Phase 3: Build the lifecycle runtime

Deliverables:

- `worktree-service`
- `session-service`
- `agent-service`
- `project-runtime`

Success criteria:

- create/open/merge/remove work without frontend integration

## Phase 4: Build the read model and integrations

Deliverables:

- `snapshot-service`
- `health-service`
- `integration-service`
- `notification-service`

Success criteria:

- a complete `ProjectSnapshot` can be produced from live state

## Phase 5: Build the new presentation layer

Deliverables:

- HTTP routes
- WebSocket terminal routes
- `webmux-agentctl`
- new `init`

Success criteria:

- UI can operate entirely against the new runtime

## Phase 6: Replace frontend consumption

Deliverables:

- simplified frontend API usage
- snapshot-driven state loading
- updated dialogs and forms for the new config model

Success criteria:

- frontend no longer depends on legacy backend concepts

## Phase 7: Delete old architecture

Delete:

- `workmux` dependency
- `.workmux.yaml` support
- `workmux.ts`
- `rpc.ts` and `/rpc/workmux`
- container `workmux` stubs
- any parsing of `workmux` CLI output

Success criteria:

- the product runs with no trace of `workmux` in architecture or setup

## Definition of Done

The refactor is complete when:

- `webmux` uses one config file
- `webmux` owns all lifecycle logic
- `webmux` owns tmux topology
- `webmux` owns sandbox event flow
- `webmux` has no `workmux` dependency
- generated files are outputs only
- the frontend consumes a clean project snapshot
- the architecture is understandable by reading the module structure alone

## Final Recommendation

Treat this as a greenfield architecture simplification project, not as a dependency-removal patch.

That means:

- define the final model first
- write new modules around explicit responsibilities
- keep adapters narrow
- keep domain types central
- collapse all default-path ownership into `webmux`

If executed this way, the result should be both:

- cleaner than the current codebase
- simpler than a literal feature-parity rewrite
