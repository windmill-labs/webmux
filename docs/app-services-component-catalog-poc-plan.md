# App Services Component Catalog POC

## Goal

Deliver a narrow vertical slice in which a developer can select `app-services`
components while creating a worktree, launch every selection in its own correctly
arranged tmux pane, and see process and readiness status.

The POC must support both the frontend and CLI and must reconstruct the selected
components after a worktree or Webmux restart.

## Scope

### Included

- A repository-generated component catalog based on `services/*/package.json`.
- A searchable checkbox selector in the worktree creation dialog.
- A repeatable CLI `--component` option.
- Persisted component selection and allocated ports.
- Host-runtime `componentGroup` panes.
- An agent pane on the left and equally stacked component panes on the right.
- One direct tmux process per component, retaining logs after process exit.
- Process and TCP readiness monitoring.
- Component status badges and meaningful mobile pane labels.
- Reconstruction when a worktree is reopened or Webmux restarts.

### Excluded

- Adding or removing components after creation.
- Start, stop, and restart controls.
- Dependency ordering and component lifecycle hooks.
- HTTP health checks.
- Service-to-service local URL rewriting.
- `CSQ_CONFIG_OVERRIDES_FILE` and structured runtime manifests.
- Docker component groups.
- App Frontends.
- Presets, kind filters, static components, and alternate group layouts.
- A persistent cross-project machine-wide lease registry.

## Contracts

### Repository configuration

`.webmux.yaml` gains:

```yaml
componentCatalog:
  command: node --experimental-strip-types scripts/webmux/catalog.ts

profiles:
  host:
    runtime: host
    panes:
      - id: agent
        kind: agent
        focus: true
      - id: components
        kind: componentGroup
        split: right
        layout: tiled
```

The POC supports one final `componentGroup` after one fixed agent pane.

### Catalog definition

```ts
interface ComponentDefinition {
  id: string;
  label: string;
  kind: string;
  workingDir: string;
  command: string;
  environment: Record<string, string>;
  ports: ComponentPortDefinition[];
}

interface ComponentPortDefinition {
  name: string;
  processEnv: string;
  protocol: "http" | "https" | "tcp";
  health: { type: "tcp" } | null;
}
```

### API

- The config response exposes catalog state and available component summaries.
- Each profile reports whether component selection is enabled.
- The create request accepts `components: string[]`.
- Each worktree snapshot exposes component runtime statuses.

```ts
interface ComponentRuntimeStatus {
  id: string;
  label: string;
  kind: string;
  paneIndex: number | null;
  processStatus: "running" | "exited" | "stopped";
  healthStatus: "starting" | "ready" | "unhealthy" | "unavailable";
  ports: Record<string, number>;
  urls: Record<string, string>;
  exitCode: number | null;
}
```

### Persistence

Worktree metadata gains:

```ts
selectedComponents: string[];
componentPorts: Record<string, Record<string, number>>;
```

Old metadata normalizes both fields to empty values.

## Implementation stages

### 1. Types and API contract

- Add component domain types.
- Extend project configuration, pane definitions, worktree metadata, and runtime
  snapshot types.
- Extend the shared API schemas before implementing handlers or UI.
- Keep the existing create response unchanged.

### 2. Catalog loading

- Execute `componentCatalog.command` from the repository root.
- Capture stdout, stderr, exit status, and enforce a timeout.
- Validate the entire JSON result atomically.
- Reject duplicate or unsafe IDs, escaping working directories, invalid
  environment keys, and malformed ports.
- Sort catalog definitions deterministically and cache them for the project
  runtime lifetime.
- Keep the project usable when catalog loading fails.

### 3. Selection and ports

- Validate selected IDs against the catalog and profile.
- Canonicalize selections into catalog order.
- Allocate ports from a dedicated range while skipping persisted reservations
  and ports that are already listening.
- Persist the selection and allocation before pane startup.
- Add namespaced port values to `runtime.env`.
- Give each component its conventional `processEnv` only in that component pane.
- Reuse persisted ports on reopen, reallocating an externally occupied port
  before launch.

### 4. Pane expansion and layout

- Expand `componentGroup` into direct process panes.
- Source `runtime.env`, overlay component environment and ports, then run the
  catalog command from its component directory.
- Enable `remain-on-exit` for component panes.
- Tag panes with a stable component ID and set their pane titles.
- Set `main-pane-width` to `50%` and apply tmux's `main-vertical` layout.
- Keep the zero-component case as a single agent pane.

### 5. Monitoring

- Extend tmux inspection with pane ID, index, PID, dead state, exit status, and
  component tag.
- Reconcile component panes alongside the existing worktree state.
- Use TCP probing for readiness.
- Report `starting` for a 60-second initial grace period, then `unhealthy`.
- Report dead panes as `exited / unavailable` and closed worktrees as
  `stopped / unavailable`.
- Reuse the dashboard's existing polling cadence.

### 6. Minimal frontend

- Add a focused `ComponentSelector` with search, checkboxes, selected count, and
  a scrollable result list.
- Show it only for profiles containing `componentGroup`.
- Display catalog errors inline.
- Submit selected component IDs in the typed create request.
- Add a compact component status strip.
- Use real component pane indices for mobile pane labels.

### 7. CLI parity

- Add repeatable `--component <id>` handling to `webmux add` and `oneshot`.
- Update help, completions, parsers, runtime handlers, and tests.
- Add compact component status summaries to `webmux list`.
- Do not add component management subcommands in the POC.

### 8. App Services integration

- Make a valid positive `PORT` override `server.port` in
  `packages/common-nest`.
- Add unit tests for valid, missing, and invalid values.
- Add `scripts/webmux/catalog.ts`, scanning packages with `scripts.dev`.
- Classify `gateway-*` as gateways and `service-*`/`core-*` as services.
- Emit `workingDir`, `yarn dev`, and one TCP `http` port using `PORT`.
- Add `.webmux.yaml` with the host component profile and `yarn install`
  post-create hook.

Selected services continue to use staging URLs for dependencies in this POC.

## Verification

### Automated

- Catalog success and failure validation.
- Duplicate IDs and unsafe path rejection.
- Port uniqueness, occupied-port skipping, and metadata compatibility.
- Layout planning for zero, one, and three components.
- Monitoring transitions through starting, ready, unhealthy, exited, and
  stopped.
- API schema and snapshot coverage.
- Frontend selector, profile, submission, status, and pane label tests.
- CLI parser, help, handler, completion, and list tests.
- App Services `PORT` override and generator tests.

### Manual

All tmux checks run through `scripts/run-with-isolated-tmux.sh`.

- Create an App Services worktree with three components.
- Verify four panes, approximately equal columns, and equal right-side heights.
- Verify each process starts in its declared directory.
- Verify unique allocated ports and readiness transitions.
- Terminate one command and verify retained logs and exited status.
- Close/reopen the worktree and restart Webmux to verify reconstruction.
- Create another worktree with the same component and verify a different port.
- Confirm no tracked `conf/env-dev.json` file becomes dirty.

## Delivery order

The Webmux changes land first. The App Services integration follows in a
separate repository change after the Webmux contract is available.
