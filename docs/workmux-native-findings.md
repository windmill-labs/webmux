# workmux Native Replacement Findings

Checked against upstream `workmux` docs on March 5, 2026.

## Summary

Replacing `workmux` entirely inside `webmux` is possible, but the scope is uneven:

- `remove` is relatively straightforward.
- `add` is manageable if the scope stays narrow.
- `merge` is the riskiest command because failure and cleanup behavior must be correct.

The right v1 target is not full `workmux` parity. The better target is a narrower `webmux-native` contract for the common UI-driven path.

## Key Findings From Upstream Docs

### Dirty state handling

`workmux` does not only error on dirty state.

- `add` supports moving local changes into a new worktree with `--with-changes`
- `add` also supports `--patch` and `--include-untracked`
- `merge` errors on uncommitted changes by default, unless `--ignore-uncommitted` is used
- `remove` supports `--force`, and bulk remove skips dirty or unmerged worktrees unless forced

This means `add` is more complex than "create worktree + tmux window".

### Merge conflicts

The docs explicitly describe manual conflict handling for `merge --rebase`.

- If conflicts occur during rebase, resolve them manually and run `git rebase --continue`

For the default merge-commit path, the docs do not explicitly spell out the conflict flow. My inference is:

- cleanup happens after a successful merge step
- on conflict, the worktree should remain so the user can resolve it manually

That inference is based on the documented command flow, not an explicit statement in the docs.

## Feature Matrix

### `add`

| Capability | `workmux` today | `webmux-native` MVP | Recommendation |
|---|---|---|---|
| Local branch/worktree creation | Yes | Yes | Keep |
| Create matching tmux window | Yes | Yes | Keep |
| Pane setup | Yes | Yes | Own this in `webmux` |
| Background create | Yes | Yes | Keep |
| Open existing if already created | Yes | Yes | Keep |
| Base branch selection | Yes | Yes | Keep |
| Prompt injection into agent pane | Yes | Yes | Keep |
| Auto-name via LLM | Yes | Optional | Defer if needed |
| Remote branch checkout | Yes | No | Defer |
| GitHub PR checkout | Yes | No | Defer |
| Fork checkout (`user:branch`) | Yes | No | Defer |
| Move dirty changes to new worktree | Yes | No | Defer |
| Patch mode for change transfer | Yes | No | Defer |
| Include untracked files in transfer | Yes | No | Defer |
| Session mode | Yes | No | Defer |
| Skip hooks/file ops/pane cmds flags | Yes | No | Defer |

### `remove`

| Capability | `workmux` today | `webmux-native` MVP | Recommendation |
|---|---|---|---|
| Remove specific/current worktree | Yes | Yes | Keep |
| Keep branch | Yes | Yes | Keep |
| Force dirty removal | Yes | Yes | Keep |
| Remove tmux window/session state | Yes | Yes | Keep |
| Remove sandbox/container resources | Partly in `webmux` today | Yes | Keep |
| Remove multiple worktrees | Yes | No | Defer |
| Remove all | Yes | No | Defer |
| Remove gone/pruned branches | Yes | No | Defer |

### `merge`

| Capability | `workmux` today | `webmux-native` MVP | Recommendation |
|---|---|---|---|
| Plain merge into main/default target | Yes | Yes | Keep |
| Merge current branch automatically | Yes | Yes | Keep |
| Merge into explicit target branch | Yes | Maybe | Optional for v1 |
| Error on dirty state by default | Yes | Yes | Keep |
| Ignore uncommitted by auto-committing/staging flow | Yes | No | Defer |
| Keep worktree after merge | Yes | Yes | Keep |
| Rebase strategy | Yes | No | Defer |
| Squash strategy | Yes | No | Defer |
| Notifications | Yes | No | Defer |

## Recommended `webmux-native` v1 Scope

### Implement

1. `add`
   - Create branch and git worktree
   - Create or reuse the tmux window
   - Apply `webmux` pane and profile setup
   - Support idempotent open behavior
   - Support base branch selection

2. `remove`
   - Kill related tmux window/session state
   - Stop sandbox container if present
   - Remove git worktree
   - Optionally keep branch
   - Support force

3. `merge`
   - Plain merge only
   - Dirty check before merge
   - Optional keep-worktree behavior
   - Cleanup only after successful merge

### Defer

1. Dirty-change transfer on `add`
2. Patch-mode change transfer
3. PR and fork checkout flows
4. Rebase and squash merge modes
5. Bulk cleanup modes
6. Session-mode behavior

## Complexity Estimate

These estimates assume a narrow MVP, not full `workmux` parity.

| Command | Difficulty | Notes |
|---|---|---|
| `remove` | Low to moderate | Mostly lifecycle cleanup and safety checks |
| `add` | Moderate | Feasible because `webmux` already owns env setup and some pane behavior |
| `merge` | Moderate to high | Highest risk due to correctness around conflicts, dirty state, and cleanup |

Overall estimate for a trustworthy MVP:

- 1 to 2 weeks for initial implementation
- another 1 to 2 weeks for edge cases, testing, and migration hardening

Approximate total: 2 to 4 weeks

## Why Full Parity Is Expensive

The main cost driver is `add`, not `remove`.

At first glance, `add` looks simple. The docs show it already includes:

- dirty-change transfer
- patch-mode transfer
- untracked file handling
- PR checkout
- remote and fork branch checkout
- auto naming
- session behavior
- hooks and pane/file-operation controls

If `webmux` tries to clone all of that immediately, the project stops being "a tighter UI around worktrees" and starts becoming a partial fork of `workmux`.

## Recommendation

Do not target full `workmux` parity in a first pass.

Instead:

- implement `webmux-native add/remove/plain-merge`
- own pane/profile behavior in `webmux`
- preserve a narrow, explicit contract for the UI path
- defer advanced Git UX until there is clear demand

That gives `webmux` a simpler user experience without taking on the entire `workmux` surface area at once.

## Sources

- Guide: <https://workmux.raine.dev/guide/>
- Add command: <https://workmux.raine.dev/reference/commands/add>
- Merge command: <https://workmux.raine.dev/reference/commands/merge>
- Remove command: <https://workmux.raine.dev/reference/commands/remove>
- Git worktree caveats: <https://workmux.raine.dev/guide/git-worktree-caveats>
