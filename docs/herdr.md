# Running webmux on herdr

webmux drives tmux by default. Setting `multiplexer: herdr` swaps in
[herdr](https://herdr.dev/) — a Rust terminal multiplexer built for coding agents
— as the thing that actually owns a project's panes.

```yaml
# .webmux.yaml
multiplexer: herdr
```

The key is per project and defaults to `tmux`; omitting it changes nothing.

## What you get, and what you give up

Everything that manages worktrees keeps working: `webmux add` / `open` / `close` /
`list` / `remove`, profiles and their pane layouts, forked tabs, the dashboard's
worktree list, git state, PR and Linear integration, and conversation history.

**The web terminal does not work in herdr mode.** Attaching from the browser
returns an explicit error telling you to attach from your own terminal instead.

This is a limitation of herdr's API rather than a missing feature here. webmux's
web terminal works by attaching a tmux *grouped session*
(`new-session -t <owner>` plus `window-size latest`) so every browser tab gets an
independently-sized view of one shared window, then streaming tmux's own rendered
output to xterm.js. herdr has no equivalent:

- no method in its socket API accepts rows/cols — panes are laid out on a
  server-side virtual screen with no per-client geometry;
- `pane.read` returns a snapshot (`visible` / `recent`), not an incremental byte
  stream.

If you mainly attach from your own terminal, none of this affects you. If you live
in the browser UI, stay on tmux.

## Switching an existing project

```bash
webmux multiplexer            # print the current one
webmux multiplexer herdr      # move every open worktree onto herdr
```

A pane cannot be handed between multiplexers — the PTY belongs to whichever server
spawned it — so the switch is a teardown and rebuild: each open worktree is closed
on the outgoing multiplexer, the config flips, and each is re-opened on the
incoming one.

**Survives:** which worktrees were open, and agent conversations — re-opening
relaunches the agent in resume mode (`claude --continue`).

**Does not survive:** scrollback, any in-flight agent turn, and every running
process. Profile `command` panes (dev servers, watchers) are restarted from
scratch, which on a large project can be expensive.

Closing happens strictly before the config flips. That ordering is deliberate:
once the config has flipped, webmux only talks to the new multiplexer and can no
longer reach the old one's windows, so a half-switched project would strand them
with no way to clean up. If any worktree fails to close, the switch aborts and the
config is left untouched.

The choice is written to `.webmux.local.yaml`, so it is per-machine and not
committed. A running `webmux serve` reads the config once at startup — restart it
after switching.

## Attaching

`webmux add` / `open` focus the worktree's tab through herdr's socket, then launch
herdr's client. Inside an existing herdr client webmux only focuses the tab —
spawning a second client would nest them.

The dashboard's "open in native terminal" action hands back `herdr` after focusing
the right tab, since herdr's client always opens on the focused tab.

## How the mapping works

| webmux | herdr |
|---|---|
| project session | workspace (matched by **label**) |
| worktree window | tab (matched by **label**) |
| pane | pane |

Labels are the join key rather than ids, because webmux persists names and herdr's
ids (`w1`, `w1:t2`) do not survive a server restart.

## Server lifecycle

Unlike tmux, **herdr never starts itself on demand**. `ping` reports
`detached_server_daemon: false`, and every other method answers
`server_not_running`. webmux therefore spawns and detaches `herdr server` itself
the first time it needs one, and polls until it answers.

A consequence worth knowing: the herdr server webmux starts is a normal background
process. If it dies, the panes die with it — same as killing a tmux server.

## herdr 0.8.0 quirks the adapter works around

Verified against herdr 0.8.0 / protocol 19. The adapter compensates for each of
these, but they are worth knowing if you are reading `adapters/herdr.ts`:

- **One request per connection.** herdr answers a single request and stops
  reading; reusing a socket silently hangs every later call. Only
  `events.subscribe` is long-lived.
- **`pane.list` ignores its filter params.** `tab_id`, `tab` and `workspace_id`
  are all accepted and all ignored — it always returns every pane in the session.
  The adapter filters by each pane's own `tab_id`.
- **`pane.split` ignores `pane_id`** and splits whatever pane is *focused*. The
  adapter focuses the anchor first and restores the previous focus afterwards, so
  parked panes are still built off-screen (tmux's `split-window -d` behaviour).
- **`pane.swap` needs `source_pane_id` / `target_pane_id`** — a shape the `herdr
  pane swap` CLI does not expose, so the adapter talks to the socket directly.

`pane.send_text` and `pane.read` *do* honour `pane_id`.

The adapter pins `EXPECTED_PROTOCOL` and logs a warning when the running server
reports a different protocol version, since herdr is pre-1.0.

## Choosing a herdr session

`HERDR_SOCKET_PATH` wins if set; otherwise `HERDR_SESSION` selects a named session
(`~/.config/herdr/sessions/<name>/herdr.sock`), falling back to the default socket
at `~/.config/herdr/herdr.sock`. Running webmux against a named session keeps its
panes out of your everyday herdr session.
