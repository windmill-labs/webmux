# Why `webmux` Should Own Full Lifecycle Internally

This note argues for moving `webmux` to full ownership of worktree lifecycle and pane/session behavior instead of relying on `workmux` internally.

The argument is architectural first, not just about removing one dependency.

## Thesis

`webmux` should own the full default-path lifecycle:

- worktree creation
- worktree discovery
- open/reopen behavior
- merge
- remove
- tmux window and pane bootstrap
- window status updates
- sandbox RPC integration

The main reason is not "one less binary". The main reason is that `webmux` is already the product surface, but its actual behavior is split across two systems. That split leaks complexity into the code, configuration model, onboarding flow, and runtime behavior.

## The Real Problem Today

The current architecture has a split-brain model:

- `.webmux.yaml` defines dashboard-oriented behavior
- `.workmux.yaml` defines lifecycle and pane behavior
- backend logic adapts itself to `workmux` semantics and CLI behavior
- sandbox and hook integration still pretend `workmux` exists even when `webmux` is doing the actual orchestration

This creates unnecessary complexity in the exact places where `webmux` should be simplest: setup, lifecycle, and runtime coordination.

## Argument 1: One Product Should Have One Source of Truth

Right now the user has to understand two configuration layers:

- `.webmux.yaml`
- `.workmux.yaml`

That split is visible in setup:

- `bin/src/init.ts` requires `workmux`
- `bin/src/init.ts` generates both config files
- users are explicitly told to edit both

Relevant code:

- `bin/src/init.ts`
- `README.md`

Why this matters:

- it increases onboarding friction
- it makes the mental model harder to explain
- it makes support harder because failures may come from either config
- it makes the product feel less cohesive

If `webmux` owns lifecycle, then the default path can have one config model and one owner.

## Argument 2: Current Backend Logic Is Distorted by `workmux`

The current backend is not merely calling `workmux` as a clean abstraction. It is compensating for it.

Examples:

- `backend/src/workmux.ts` parses `workmux list` and `workmux status` text output
- `backend/src/workmux.ts` has branching logic around `workmux add` flags such as `-C` and `-A`
- `backend/src/workmux.ts` initializes env, hooks, and pane behavior after `workmux` has already done part of the lifecycle
- `backend/src/server.ts` merges `workmux`-derived data with local git/tmux/env-derived data

This is a sign that the abstraction boundary is not clean.

Instead of:

- "call lower-level engine and get stable structured behavior"

the code is doing:

- "call lower-level engine, parse its CLI output, infer state, then patch over behavior differences"

That is inherently harder to reason about and test.

## Argument 3: The Tmux Model Already Belongs to `webmux`

`webmux` already owns a meaningful part of terminal behavior:

- browser attach/detach
- grouped tmux viewer sessions
- pane selection and resize
- scrollback capture
- session cleanup

Relevant code:

- `backend/src/terminal.ts`

At the same time, `workmux` still owns the initial window lifecycle and some pane semantics.

That means tmux ownership is split in half:

- `workmux` creates part of the topology
- `webmux` operates and presents the topology

This is the worst of both worlds:

- `webmux` has enough responsibility to inherit complexity
- but not enough ownership to make the model simple

If `webmux` already owns the browser-facing terminal model, it should also own the underlying session/window lifecycle for the default path.

## Argument 4: Container Integration Already Proves `webmux` Is the Real Orchestrator

The sandbox path is especially revealing.

Current behavior:

- `webmux` launches and manages Docker containers directly
- then injects a fake `workmux` command inside the container
- that fake command proxies RPC back to the host

Relevant code:

- `backend/src/docker.ts`
- `backend/src/rpc.ts`

This means the system is already architecturally inverted:

- `workmux` looks like the orchestrator
- but `webmux` is actually orchestrating
- a compatibility stub exists only to preserve the old boundary

This is a strong signal that the dependency has become accidental rather than essential.

## Argument 5: Full Ownership Produces Cleaner Domain Logic

If `webmux` owns lifecycle end-to-end, then the internal model can become straightforward:

- Git worktree state comes from Git
- tmux state comes from tmux
- runtime metadata comes from `webmux`
- service health comes from `webmux`
- profile and pane layout come from `webmux`

That is a cleaner architecture than:

- Git state from Git
- worktree/session intent from `workmux`
- pane behavior split between `workmux` and `webmux`
- runtime status partially inferred through `workmux`
- special logic to patch mismatches

A cleaner model has direct engineering benefits:

- fewer hidden couplings
- fewer post-hoc fixes
- easier debugging
- easier testing
- easier onboarding for contributors

## Argument 6: The Current Dependency Creates Product Friction, Not Just Engineering Friction

The dual-system model leaks to users:

- they must install `workmux`
- they must understand `workmux` concepts
- they may need to debug `workmux` behavior even though they are using `webmux`
- advanced behavior may differ depending on whether it is controlled by `.webmux.yaml` or `.workmux.yaml`

This weakens the product story.

The clean product story should be:

- install `webmux`
- configure `webmux`
- `webmux` manages worktrees, panes, services, terminals, and sandbox integration

That is materially easier to explain and easier to adopt.

## Argument 7: Full Ownership Improves Testability

Today a significant part of lifecycle correctness depends on an external binary's behavior.

That leads to weaker tests because:

- the real logic is split across processes
- CLI parsing becomes part of correctness
- some behavior is only observable indirectly

Relevant code:

- `backend/src/workmux.ts`
- `backend/src/__tests__/workmux.test.ts`

The current tests do not deeply exercise lifecycle behavior because a lot of that behavior is delegated.

With full ownership, the code can be structured around testable modules:

- native worktree lifecycle
- native tmux runtime
- native merge/remove safety logic
- native RPC/window-status handling

That is a better long-term engineering position.

## Argument 8: Upstream Changes Are Currently a Hidden Risk

When `webmux` parses `workmux` CLI output or relies on specific behavioral details, the project inherits breakage risk from upstream changes.

Examples:

- command output format changes
- flag behavior changes
- assumptions around pane/session creation
- merge/open semantics changes

Even if upstream is stable, this is still an unnecessary source of volatility for core product behavior.

Owning the lifecycle removes that category of risk from the critical path.

## Argument 9: A Native Model Lets `webmux` Be Opinionated in the Right Places

`webmux` is not just a thin wrapper around worktrees. It already has strong product opinions:

- browser-based terminal UX
- service health monitoring
- PR/CI visibility
- Linear integration
- sandbox orchestration
- startup env controls

Once the product is already opinionated, deferring lifecycle semantics to another tool becomes less coherent.

Owning lifecycle lets `webmux` make the default path intentionally opinionated:

- one config model
- one pane layout model
- one sandbox model
- one lifecycle model
- one place to add future features

That is better than continually negotiating behavior at the boundary with `workmux`.

## Argument 10: Full Ownership Reduces “Compatibility Code”

There is a difference between real product logic and glue code.

Current glue includes:

- parsing `workmux` CLI tables
- handling `workmux`-specific add flags and edge cases
- injecting a fake `workmux` binary into containers
- maintaining `/rpc/workmux`
- generating `.workmux.yaml`
- adapting user behavior to two config systems

That code exists mostly to preserve compatibility with the current architecture.

If `webmux` owns lifecycle, much of that code can either disappear or become a thin isolated compatibility layer during migration.

That is a quality improvement by itself.

## Argument 11: The Dependency Boundary Is Already Leaking, So Keeping It No Longer Buys Simplicity

There are only two defensible dependency shapes:

1. a clean lower-level engine with a stable interface
2. full ownership in the higher-level product

The current shape is neither.

It is not a clean engine boundary because:

- `webmux` compensates for `workmux` behavior
- state is reconstructed from multiple sources
- ownership of tmux behavior is mixed
- container integration already routes around `workmux`

At that point, keeping the dependency does not buy architectural simplicity anymore.

## Argument 12: The Rewrite Can Be Used to Collapse the Model, Not Just Reimplement It

If `webmux` removes `workmux`, the project should not treat it as a literal command-for-command rewrite.

The real opportunity is to simplify:

- collapse two configs into one default model
- collapse lifecycle and pane logic into one owner
- replace compatibility workarounds with direct logic
- define a narrow, explicit internal runtime API

That makes the codebase more maintainable than it is today, not merely equivalent.

This is the strongest strategic reason to do the rewrite.

## Expected Benefits

If done well, full ownership should produce:

- one coherent product model
- one default config surface
- cleaner setup and documentation
- simpler backend architecture
- fewer compatibility hacks
- easier testability
- easier debugging
- better contributor ergonomics
- lower long-term maintenance cost
- more freedom to evolve lifecycle behavior intentionally

## Risks and Costs

The case for full ownership is strong, but the costs are real.

Main risks:

- reimplementing lifecycle incorrectly
- introducing regressions in merge/remove behavior
- partial migration creating more complexity instead of less
- underestimating tmux edge cases

Main cost:

- the work is not "remove one dependency"
- it is an architecture simplification project with migration work

This does not weaken the argument. It only means the project should be approached deliberately.

## Conditions For Success

Removing `workmux` is only worth it if these rules are followed:

1. `webmux` must fully own the default path
2. compatibility shims must be temporary and isolated
3. the config model must be simplified, not duplicated
4. tmux lifecycle must be treated as a first-class internal runtime
5. the rewrite should target a cleaner model, not full parity on day one

If those conditions are met, the resulting codebase should be substantially cleaner than the current one.

## Recommendation

`webmux` should move to full ownership of worktree lifecycle and session behavior for the default path.

This should be framed as:

- an architecture simplification
- a product model simplification
- a configuration simplification

and only secondarily as:

- dependency removal

That framing matters because the real value is not "we no longer call `workmux`".

The real value is:

- `webmux` becomes the single, coherent owner of the behavior it already presents as its product.
