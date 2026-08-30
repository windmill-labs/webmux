# macOS App Feature Parity

This document tracks what the native macOS app already covers and what is still missing to reach feature parity with the current web UI.

It is intentionally scoped to the current desktop web experience. Mobile-only browser affordances are called out separately when relevant.

## Current native coverage

The macOS app already has a solid core:

- saved project connections for local and remote `webmux serve` instances
- project picker plus add, edit, and remove project flows
- project connectivity validation against `GET /api/project`
- direct remote API support plus SSH-backed terminal attach
- worktree listing from `GET /api/project`
- branch selection
- create worktree for `new` and `existing` modes
- open, close, merge, and remove worktree actions
- embedded Ghostty terminal attach via `GET /api/worktrees/:name/terminal-launch`
- branch path encoding for slash-heavy branch names
- PR, Linear, and service badges in the selected worktree header
- PR badges in the worktree list
- terminal caching for recently visited worktrees
- terminal autofocus when switching worktrees

Those are the features that make the native app usable today as a daily driver for the basic worktree lifecycle.

## Parity gaps

### 1. Project config is not loaded

The web UI loads `GET /api/config` and uses it to drive a large part of the product surface. The macOS app does not fetch config yet.

Missing because of that:

- available profiles for worktree creation
- default profile selection
- auto-name behavior hints
- startup env definitions
- linked repo metadata
- project-level service config awareness
- Linear auto-create setting state

This is the biggest remaining structural gap because several UI features depend on config, not just the project snapshot.

### 2. Create worktree flow is still the POC version

The web dialog supports a much richer create flow than the native sheet.

Missing:

- prompt field
- agent selection (`claude` or `codex`)
- profile selection
- startup env override fields
- branch browser from `GET /api/branches`
- searchable existing-branch picker
- save-as-default create preferences
- Linear ticket creation toggle and optional title
- create-flow progress indicators that match web behavior

Current native create sheet only sends:

- `mode`
- optional `branch`

For full parity, the macOS app needs the same request contract as the web client for `POST /api/worktrees`.

### 3. Sidebar still shows less state than web

The native sidebar was intentionally simplified. That matches the recent UI direction you asked for, but it is not web parity.

Missing versus web:

- closed/opening/creating state labels
- agent status icon
- unread notification dot per branch
- agent name line
- profile line
- service port line
- remove shortcut button on hover
- creating/opening disabled states
- persistent selected-branch restore behavior

If the goal is exact parity, the list has to become richer again or the web UI would need to be simplified to match the native app.

### 4. Header/top bar is still a subset

The native header currently shows:

- branch name
- open or close
- merge
- remove
- PR badges
- one Linear badge
- service badges

Still missing from the web top bar:

- dirty or unpushed badge with diff entry point
- linked repo grouping
- per-repo PR grouping
- CI and review affordances from PR groups
- settings entry point in the header
- notifications bell and unread counter
- notification history popover
- "Open in Cursor" style repo shortcuts

The web top bar is not only presentation; it is also the launch point for several dialogs.

### 5. No diff workflow

The web UI exposes dirty-state investigation through `GET /api/worktrees/:name/diff` and the diff dialog.

Missing natively:

- diff fetch client
- dirty/unpushed action in the header
- uncommitted diff view
- unpushed commits view
- truncated diff handling

This is one of the most meaningful workflow gaps because the web UI lets users inspect why a worktree is dirty before acting.

### 6. No PR CI or comment-review workflows

The native app decodes PR metadata, but it only renders badges.

Missing:

- CI logs dialog via `GET /api/ci-logs/:runId`
- comment review dialog
- prompt submission back into a worktree via `POST /api/worktrees/:name/send`
- review and CI entry points from PR groups

Right now the PR badges are informational only.

### 7. No Linear side panel or issue detail flow

The web UI has a dedicated Linear workflow.

Missing:

- `GET /api/linear/issues`
- collapsible Linear panel in the sidebar
- issue search/filter
- "Implement" action from a Linear issue
- Linear issue detail dialog
- create-worktree prefill from a selected Linear issue
- `PUT /api/linear/auto-create` setting control

The macOS app only shows a linked Linear badge when the selected worktree already has one.

### 8. No notifications system

The web UI uses `GET /api/project` notifications plus `EventSource` streaming from `/api/notifications/stream`.

Missing:

- notification history model
- live notification stream client
- unread count tracking
- per-branch notification markers
- notification bell UI
- notification selection jump-to-worktree behavior
- dismiss flow via `POST /api/notifications/:id/dismiss`
- native notification delivery when the app is backgrounded

This is both a parity gap and a good candidate to replace the current manual refresh button.

### 9. No automatic refresh or background reconciliation

The web app does regular polling, faster polling during creation, and refresh on visibility changes. The native app mostly refreshes only:

- on explicit refresh
- after a user action
- on project switch

Missing:

- periodic refresh
- faster refresh while worktrees are creating or opening
- refresh on app activation or window focus
- notification-driven refresh

Without this, the native app can drift behind state changes made elsewhere.

### 10. No settings surface beyond saved project connections

The web settings dialog manages more than connection data.

Missing:

- theme selection
- persisted theme application
- Linear auto-create toggle
- SSH host preference for editor integration

The native app has a Projects dialog, but not a general Settings dialog.

### 11. No linked-repo UX

The web top bar understands linked repos from config and groups PRs by repo.

Missing:

- linked repo config consumption
- grouped PR rendering for linked repos
- linked repo editor shortcuts
- multi-row repo presentation in the header

If linked repos matter in day-to-day use, this is a meaningful gap.

### 12. No terminal adjunct workflows from the web app

The native app has the terminal itself, but not the web-side helpers around it.

Missing:

- mobile-only pane bar equivalent is not relevant on macOS
- desktop pane targeting shortcuts are also absent
- file upload flow via `POST /api/worktrees/:name/upload`
- prompt-send helpers from CI and review dialogs

The terminal core is present; the surrounding workflows are not.

### 13. No keyboard shortcut parity

The web UI supports shortcut-driven workflow:

- navigate up and down between worktrees
- create worktree
- merge
- remove
- open closed worktree with Enter

The macOS app currently relies on standard list selection and buttons.

### 14. Packaging and app-level polish are still below web-level readiness

This is not web UI parity in the strict feature sense, but it matters for product completeness.

Still missing:

- signed `.app` bundle flow
- notarization
- stable app icon and app metadata
- crash reporting or diagnostics strategy for native-only failures
- richer error surfaces than modal alerts

## Suggested implementation order

If the goal is to close parity efficiently, this is the order that makes the most sense:

1. Load `GET /api/config` in the macOS app.
2. Upgrade the create-worktree flow to match the web request contract.
3. Add automatic refresh plus notifications stream support.
4. Add diff workflow.
5. Add PR CI and comment-review flows.
6. Add Linear panel and Linear issue detail flow.
7. Add settings dialog.
8. Add linked-repo and repo-group top-bar features.
9. Add keyboard shortcut parity and remaining polish.

## What would count as "parity complete"

The macOS app should be considered at desktop web parity when a user can do all of the following natively:

- manage multiple project connections
- see the same worktree state and metadata as the web UI
- create worktrees with the same prompt, profile, agent, env, and Linear options
- inspect dirty state and unpushed commits
- act on PR CI and review information
- browse and implement Linear issues
- receive live notifications and jump to the affected worktree
- use the same core shortcuts and top-level actions
- switch projects and worktrees without losing terminal continuity

Until then, the native app should be treated as a strong worktree-and-terminal client, not a complete replacement for the web UI.
