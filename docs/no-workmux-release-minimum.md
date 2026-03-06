# No-`workmux` Release: Minimum Surface

This document defines the minimum scope required for a `webmux` release that does **not** require the `workmux` binary to be installed.

Checked against the current codebase on March 5, 2026.

## Bottom Line

A true no-`workmux` release needs more than native `add/remove/merge`.

The minimum replacement set is:

1. native worktree lifecycle for `add`, `remove`, `merge`, and `open`
2. native worktree discovery for `list`
3. native agent/window metadata for `status`
4. native window-status RPC handling for hooks and sandbox containers
5. native pane/session bootstrap owned by `webmux`
6. CLI and init changes so `workmux` is no longer required or generated

If any of those are still delegated to the `workmux` binary, the dependency is not fully gone.

## Why `add/remove/merge` Alone Is Not Enough

The current backend still depends on `workmux` for:

- `listWorktrees()` via `workmux list`
- `getStatus()` via `workmux status`
- `openWorktree()` via `workmux open`
- `addWorktree()` via `workmux add`
- `removeWorktree()` via `workmux rm`
- `mergeWorktree()` via `workmux merge`
- `/rpc/workmux` command forwarding, especially `set-window-status`

Relevant code:

- [backend/src/workmux.ts](/home/farhad/Desktop/workmux-web/backend/src/workmux.ts)
- [backend/src/server.ts](/home/farhad/Desktop/workmux-web/backend/src/server.ts)
- [backend/src/rpc.ts](/home/farhad/Desktop/workmux-web/backend/src/rpc.ts)
- [backend/src/docker.ts](/home/farhad/Desktop/workmux-web/backend/src/docker.ts)
- [bin/src/init.ts](/home/farhad/Desktop/workmux-web/bin/src/init.ts)

## Minimum Internal API Surface

This is the minimum internal backend surface `webmux` needs to own.

## 1. Worktree Runtime

Introduce a native backend module responsible for worktree lifecycle and state.

Suggested surface:

```ts
interface NativeWorktreeSummary {
  branch: string;
  path: string;
  dir: string | null;
  mux: "✓" | "";
  agent: string;
  dirty: boolean;
  profile: string | null;
  agentName: string | null;
  paneCount: number;
}

interface NativeWorktreeStatus {
  branch: string;
  status: string;
  elapsed: string;
  title: string;
}

interface AddNativeWorktreeOpts {
  branch?: string;
  prompt?: string;
  profile?: string;
  agent?: string;
  envOverrides?: Record<string, string>;
  baseBranch?: string;
  openIfExists?: boolean;
  background?: boolean;
}

interface RemoveNativeWorktreeOpts {
  force?: boolean;
  keepBranch?: boolean;
}

interface MergeNativeWorktreeOpts {
  keep?: boolean;
  into?: string;
}

interface NativeWorktreeRuntime {
  list(): Promise<NativeWorktreeSummary[]>;
  getStatus(): Promise<NativeWorktreeStatus[]>;
  add(opts: AddNativeWorktreeOpts): Promise<{ branch: string; output: string }>;
  open(branch: string): Promise<{ output: string }>;
  remove(branch: string, opts?: RemoveNativeWorktreeOpts): Promise<{ output: string }>;
  merge(branch: string, opts?: MergeNativeWorktreeOpts): Promise<{ output: string }>;
}
```

### Required behaviors

- `list()`
  - derive worktrees from `git worktree list --porcelain`
  - map branch to directory
  - detect whether the matching tmux window exists
  - recover detached-head worktrees by directory basename if needed

- `getStatus()`
  - provide the fields used by current APIs
  - minimum acceptable implementation may return conservative defaults for `elapsed` and `title`
  - must provide enough signal for the dashboard and `/api/worktrees/:name/status`

- `add()`
  - create branch/worktree with Git directly
  - ensure tmux server/session exists
  - create the `wm-{branch}` window
  - initialize `.env.local` and Claude hooks
  - apply the `webmux` pane/profile behavior
  - support sandbox launch

- `open()`
  - reopen or recreate the tmux window for an existing worktree
  - initialize env/hooks for externally-created worktrees if missing

- `remove()`
  - stop sandbox container if present
  - kill related tmux window
  - remove git worktree
  - optionally keep or delete branch

- `merge()`
  - perform plain merge
  - enforce dirty-state checks
  - clean up only after successful merge

## 2. Tmux Layout Runtime

Today `webmux` already owns terminal attachment, but not all tmux lifecycle.

Minimum native surface:

```ts
interface NativeTmuxRuntime {
  ensureServer(): void;
  ensureProjectSession(): Promise<string>;
  hasWindow(branch: string): Promise<boolean>;
  createWindow(branch: string, cwd: string): Promise<void>;
  rebuildWindow(branch: string, cwd: string, opts: { profile: string; agent: string; prompt?: string }): Promise<void>;
  killWindow(branch: string): Promise<void>;
  listPaneCounts(): Promise<Map<string, number>>;
  setWindowStatus(branch: string, statusText: string): Promise<void>;
}
```

### Why this is required

Without `workmux`, `webmux` must own:

- creation of the real tmux session/window topology
- reopening closed worktrees
- pane layout and commands
- status text updates previously delegated via `workmux set-window-status`

This is the minimum needed to preserve:

- `wm-{branch}` naming
- browser terminal attachment behavior
- sandbox/agent hooks that update window labels

## 3. RPC Compatibility Layer

Current sandbox and hook flows still assume `/rpc/workmux` exists and that a `workmux` command can be called from inside the container.

Minimum no-`workmux` release requirement:

- keep `/rpc/workmux` for compatibility, or add `/rpc/webmux` and keep `/rpc/workmux` as an alias
- support this command subset natively:
  - `notify`
  - `set-window-status`

Suggested internal surface:

```ts
interface NativeRpcCommandHandler {
  notify(branch: string, type: "agent_stopped" | "pr_opened", url?: string): Promise<void>;
  setWindowStatus(branch: string, text: string): Promise<void>;
}
```

### Important note

The current container shim is literally named `workmux` and forwards RPC to the host:

- [backend/src/docker.ts](/home/farhad/Desktop/workmux-web/backend/src/docker.ts)

For a no-`workmux` release, you have two options:

1. keep shipping a tiny compatibility shim named `workmux` inside containers
2. move agents and prompts to a new `webmux` or `wmrpc` command

For the minimum release, option 1 is safer.

## 4. Worktree Data Model Returned to the UI

The frontend does **not** need a perfect clone of `workmux list/status`.

The dashboard currently depends most on:

- `branch`
- `mux`
- `dir`
- `dirty`
- `profile`
- `agentName`
- `services`
- `paneCount`
- PR and Linear enrichment

Relevant type:

- [frontend/src/lib/types.ts](/home/farhad/Desktop/workmux-web/frontend/src/lib/types.ts)

### Important simplification

`status`, `elapsed`, and `title` are currently much less important than the core worktree and tmux state. A no-`workmux` release can keep them as:

- real values if native tracking exists
- blank/default values if not

That means the native status system can be intentionally minimal at first.

## Minimum HTTP/API Contract

These routes can stay the same externally.

Required existing routes:

- `GET /api/worktrees`
- `POST /api/worktrees`
- `DELETE /api/worktrees/:name`
- `POST /api/worktrees/:name/open`
- `POST /api/worktrees/:name/merge`
- `POST /api/worktrees/:name/send`
- `GET /api/worktrees/:name/status`
- `POST /rpc/workmux`

What changes is the implementation behind them:

- no route may shell out to the `workmux` binary
- `/rpc/workmux` must be handled entirely in-process

## Minimum CLI / Setup Changes

To truly drop the hard dependency, these setup paths must change too.

### `webmux init`

Current state:

- requires `workmux`
- generates `.workmux.yaml`

Relevant file:

- [bin/src/init.ts](/home/farhad/Desktop/workmux-web/bin/src/init.ts)

Required change:

- remove `workmux` from required dependency checks
- stop generating `.workmux.yaml` for the default path
- move pane/profile bootstrap ownership into `.webmux.yaml` or native defaults

### README / docs / commands

Required change:

- remove `workmux` from required prerequisites
- update docs that describe `workmux` as a hard dependency
- update operational docs that use `workmux list/status`

## Minimum Config Ownership

A true no-`workmux` release needs a `webmux`-owned default for:

- worktree root location
- pane layout
- agent pane command
- shell pane command
- sandbox pane behavior

The current dual-config split is:

- `.workmux.yaml` for panes/lifecycle
- `.webmux.yaml` for dashboard concerns

For no dependency, the default path needs to collapse that into `webmux` ownership.

### Minimum approach

- preserve current window naming: `wm-{branch}`
- preserve current worktree root convention: `__worktrees`
- store pane/profile defaults in `webmux`
- keep advanced user overrides optional

## Minimum Compatibility Shims

The minimum viable compatibility shims are:

1. container-side `workmux` shim
   - keep the name `workmux`
   - forward only supported RPC commands

2. host-side `/rpc/workmux`
   - keep the route name
   - handle only `notify` and `set-window-status`

3. optional hook path compatibility
   - current hook path uses `~/.config/workmux/hooks`
   - you can keep this path initially even after removing the binary dependency

This lets you remove the binary dependency before renaming the ecosystem surface.

## Exact Minimum Release Checklist

You can claim “no `workmux` installed required” only when all of these are true:

- `webmux init` does not require `workmux`
- `webmux init` does not need `.workmux.yaml` for the default path
- `GET /api/worktrees` works with no `workmux` binary present
- `POST /api/worktrees` works with no `workmux` binary present
- `POST /api/worktrees/:name/open` works with no `workmux` binary present
- `DELETE /api/worktrees/:name` works with no `workmux` binary present
- `POST /api/worktrees/:name/merge` works with no `workmux` binary present
- sandbox agents can still notify and set window status without the binary
- browser terminal attach still works against the native tmux topology
- docs and install flow no longer mention `workmux` as required

## What Can Still Be Deferred

You do **not** need these for the first no-`workmux` release:

- dirty-change transfer on `add`
- patch-mode transfer
- untracked-file transfer
- GitHub PR checkout
- fork checkout
- rebase merge mode
- squash merge mode
- bulk remove modes
- complete parity for `status`, `elapsed`, and `title`

Those are parity features, not minimum dependency-removal features.

## Recommended Delivery Shape

The smallest coherent delivery is:

1. native `list`
2. native `open`
3. native `add`
4. native `remove`
5. native plain `merge`
6. native `set-window-status` RPC
7. `init` and docs cleanup

That is the minimum set that makes “no `workmux` installed” truthful for the default path.
