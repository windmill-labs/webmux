# Native Terminal POC Options

This note compares two small-scope POC paths for a `webmux` desktop experience with a real native terminal:

1. Tauri app shell with a separate native terminal window
2. macOS-native SwiftUI app with an embedded `libghostty` terminal view

The goal is not to design the final product. The goal is to prove, as quickly as possible, whether a native terminal materially improves the experience over the current browser terminal.

## Goals

- Prove that a native terminal feels meaningfully better than the current `xterm.js`-based UI
- Reuse as much of the existing `webmux` orchestration stack as possible
- Keep `tmux` for persistence and pane/session behavior
- Keep the POC small enough to complete quickly

## Non-Goals

- No Windows support in the POC
- No full native rewrite of PR, CI, review, or Linear panels
- No App Store packaging
- No updater, signing, or production distribution hardening
- No attempt to replace `tmux`

## Reusable Pieces From The Current Repo

These parts already exist and should be reused first:

- worktree lifecycle and runtime ownership in `backend/src/runtime.ts`
- terminal attach behavior in `backend/src/adapters/terminal.ts`
- current browser UI, if the Tauri shell path is chosen

For both POC paths, the fastest route is to keep the existing Bun backend as a sidecar initially rather than rewriting the orchestration layer.

## Shared Product Test

Both POCs should answer the same question:

- Does a real native terminal make `webmux` feel meaningfully better for serious terminal users?

The validation workflows should be:

- open a worktree and attach to its terminal
- run `nvim`, `lazygit`, long log streams, and AI agent CLIs
- resize the terminal repeatedly
- copy and paste
- switch focus between worktrees and reopen terminals

If the perceived benefit is weak, stop before investing in a larger native rewrite.

## Option A: Tauri POC With A Separate Native Terminal Window

### Summary

Use Tauri for the main desktop shell and keep the terminal in a separate native window managed by the app.

This is the smallest cross-platform path because it avoids the hardest problem: embedding a native terminal view into a webview-based app.

### User Experience

1. The user launches the Tauri app.
2. The main window shows the familiar `webmux` dashboard UI.
3. The user selects a worktree or clicks "Open terminal".
4. The app automatically opens or focuses a native terminal window for that worktree.
5. Closing the terminal window closes the attach session, not the worktree.

The user does not manually start the terminal app. Tauri manages the terminal windows.

### Simplest Architecture

- Tauri hosts the main application window
- The current Svelte frontend is reused with minimal changes
- The current Bun backend runs as a local sidecar
- A small platform-native terminal host binary is launched by the app
- That terminal host creates a `libghostty` window and attaches to the target `tmux` session

For the POC, the Bun backend can stay on `127.0.0.1` if that is the fastest way to reuse the current API and state model. That is acceptable for a POC even if it is not the desired final architecture.

### Why This Path Is Simple

- The current dashboard UI is reused almost as-is
- The current backend is reused almost as-is
- The native terminal is isolated in its own window
- There is no need to solve mixed webview plus native terminal layout in one window

### New Components

1. `apps/tauri-shell`
   - Tauri app
   - starts and stops the Bun sidecar
   - launches and tracks native terminal windows

2. `apps/terminal-host-macos`
   - tiny native macOS host around `libghostty`
   - opens one terminal window
   - attaches to the target `tmux` session

3. `apps/terminal-host-linux`
   - tiny native Linux host around `libghostty`
   - same contract as the macOS host

### IPC Contract

For the smallest possible POC, keep IPC simple:

- Tauri main window talks to Bun sidecar over existing HTTP and WebSocket endpoints
- Tauri launches terminal host processes with simple arguments:
  - project path
  - branch or worktree id
  - tmux session/window target
  - initial size or theme flags if needed

The terminal host does not need to know all of `webmux`. It only needs enough information to attach to the right session.

### Minimal Scope

- List worktrees
- Open existing worktree
- Create a worktree
- Open one native terminal window per worktree
- Focus an already-open terminal window when the same worktree is selected again
- Close a terminal attach session cleanly

### Out Of Scope

- Native PR, CI, review, or Linear views
- Embedded terminal panes inside the main dashboard window
- Replacing Bun HTTP/WebSocket with Tauri IPC
- Multi-window terminal tiling inside the Tauri shell

### Exit Criteria

- A user can create or open a worktree from the Tauri app
- The app opens a native `libghostty` terminal window automatically
- Input, resize, copy/paste, and focus work reliably
- `nvim`, `lazygit`, and an agent CLI all behave correctly enough to compare against the browser version

### Pros

- Smallest path that still proves a native terminal
- Keeps the current dashboard mostly intact
- Gives a plausible macOS and Linux story without forcing a single native UI toolkit
- Avoids the hardest embedding problem

### Cons

- Hybrid stack
- Two-window experience
- Main window and terminal window are separate concepts
- Less "cmux-like" than a single native window

### Rough Effort

- 1 to 2 weeks for a credible internal POC

## Option B: SwiftUI POC With Embedded `libghostty` Terminal View

### Summary

Build a macOS-native app where the main window contains both the sidebar and the terminal view, with `libghostty` embedded directly in the native UI.

This is the cleanest way to test the terminal-first product direction on macOS.

### User Experience

1. The user launches a native macOS app.
2. The app shows a sidebar of worktrees.
3. Selecting a worktree swaps the main terminal view to that worktree.
4. The terminal is a native `libghostty` view inside the main window.
5. Later iterations can add tabs, inspectors, and more native chrome.

### Simplest Architecture

- macOS app shell in SwiftUI
- terminal container implemented with AppKit where needed
- current Bun backend reused as a local sidecar
- SwiftUI fetches worktree state from the sidecar
- terminal view attaches to the matching `tmux` target

For the POC, the terminal does not need to know about every `webmux` feature. The Bun sidecar continues to own lifecycle, worktrees, and runtime state.

### Why This Path Is Simple

It is only simple in the macOS-only sense:

- `libghostty` lives in a native UI tree
- there is no webview in the main interaction path
- terminal focus, resize, clipboard, and view lifecycle stay native

This is the best path if the main question is "should `webmux` become a native terminal-first app on macOS?"

### New Components

1. `apps/webmux-macos`
   - SwiftUI shell
   - sidebar, toolbar, and worktree state

2. `macos/TerminalView`
   - AppKit wrapper around `libghostty`
   - owns a terminal session binding

3. `macos/BackendClient`
   - minimal client for the existing Bun sidecar
   - list, create, open, close worktrees

### IPC Contract

Keep the POC contract narrow:

- list worktrees
- create worktree
- open worktree
- close worktree
- fetch enough runtime state to map a worktree to its `tmux` session/window

That is enough to prove the core UX without rebuilding the backend.

### Minimal Scope

- Sidebar with worktree list
- One embedded terminal view
- Open or create worktree
- Switch the terminal between worktrees
- Clean close and reopen behavior

### Out Of Scope

- Full native PR and CI views
- Linux
- Native settings model
- Production polish and packaging

### Exit Criteria

- A user can do a real session of work inside one native macOS window
- The terminal feels clearly better than the browser version for serious terminal workflows
- The app can switch between worktrees without losing the expected `tmux` state

### Pros

- Cleanest terminal integration
- Closest to a future terminal-first product
- Best fidelity for macOS UX
- Fewest layers around the terminal itself

### Cons

- macOS only
- Less reuse of the current Svelte UI
- No direct Linux path from the same UI code
- More divergence from the existing product shell

### Rough Effort

- 2 to 3 weeks for a credible internal macOS POC

## Recommendation

Choose Option A if the question is:

- can `webmux` ship as a desktop app quickly?
- can we prove native terminal value on both macOS and Linux with minimal product churn?

Choose Option B if the question is:

- should `webmux` become a terminal-first native product on macOS?
- is the embedded native terminal experience strong enough to justify a larger rewrite?

If the team wants the smallest reversible experiment, start with Option A.

If the team already believes the terminal experience is the product, start with Option B.

## Suggested Sequence

The safest order is:

1. Build Option A first
2. Validate whether users care about the native terminal enough to justify more investment
3. If yes, build Option B as the stronger product-direction prototype

That sequence keeps the first POC cheap while preserving the path toward a more ambitious native terminal app later.

## Sources

- Ghostty about: <https://ghostty.org/docs/about>
- Ghostty features: <https://ghostty.org/docs/features>
- Tauri IPC: <https://v2.tauri.app/concept/inter-process-communication/>
- Tauri process model: <https://v2.tauri.app/concept/process-model/>
