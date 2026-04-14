# Claude Support Plan For The Agents UI

## Goal

Add Claude-backed worktree chat support to the new mobile-friendly agents UI without changing the overall product shape:

- one shared backend
- one separate agents UI
- one worktree list
- one simple chat surface per selected worktree

The Claude path should preserve continuity with existing Claude CLI sessions.

## Why Claude Is Different

Claude Code CLI sessions are already interchangeable with the Claude Agents SDK through shared JSONL session files on disk.

That means Claude support does not need a separate `app-server` bridge like Codex. The backend can resolve and continue Claude sessions directly through the SDK/session APIs, as long as the `cwd` matches the worktree path.

## Architecture

### Shared backend

Keep the existing backend as the only owner of:

- worktree lifecycle
- metadata
- runtime state
- chat attach/history/send/interrupt routes
- websocket streaming

Do not add a second backend or a separate Claude runtime owner.

### Provider-specific adapters behind one contract

Keep the agents UI contract provider-agnostic.

- `codex` worktrees continue to use the existing Codex conversation service
- `claude` worktrees get a new Claude conversation service

Both services should return the same normalized UI types:

- worktree conversation summary
- transcript messages
- send response
- interrupt response
- websocket snapshot and message-delta events

## Phase plan

### Phase 1

Provider-generic scaffolding.

- write this plan
- generalize conversation metadata to support both Codex and Claude
- normalize existing stored Codex metadata so old worktrees still load
- generalize agents UI types away from Codex-only `threadId`
- keep Claude chat disabled in the UI until the backend adapter exists

### Phase 2

Claude session adapter.

- add a backend adapter around Claude session APIs
- list sessions by worktree path
- read session info and messages
- continue an existing session by `sessionId` and `cwd`
- start a new session when none exists

### Phase 3

Claude conversation service.

- resolve the right Claude session for a worktree
- prefer persisted metadata first
- otherwise discover the newest matching session by `cwd` and, when available, branch
- normalize Claude transcript items into the existing agents UI transcript shape
- persist the resolved `sessionId`

### Phase 4

Route dispatch and streaming.

- route `attach/history/messages/interrupt` by `worktree.agentName`
- keep Codex on the current service
- send Claude updates through the same websocket event contract:
  - `snapshot`
  - `messageDelta`
  - `error`

### Phase 5

UI enablement and polish.

- allow Claude worktrees to open chat in the same agents UI
- keep the same simplified mobile-first flow
- update labels/copy to be provider-neutral
- only expose interrupt when the provider supports it cleanly

## Data model changes

### Worktree metadata

Replace the current single-provider conversation record with a discriminated union.

Codex conversation metadata:

- `provider: "codexAppServer"`
- `conversationId`
- `threadId`
- `cwd`
- `lastSeenAt`

Claude conversation metadata:

- `provider: "claudeCode"`
- `conversationId`
- `sessionId`
- `cwd`
- `lastSeenAt`

`conversationId` is the shared UI-level identifier. For Codex it matches `threadId`. For Claude it matches `sessionId`.

### UI contract

Make the agents UI conversation state generic:

- `provider`
- `conversationId`
- `cwd`
- `running`
- `activeTurnId`
- `messages`

Provider-specific IDs can still exist in metadata, but the main UI should not care whether the backing provider calls it a thread or a session.

## Session resolution strategy

### Codex

No behavior change from the current implementation.

### Claude

Resolution order:

1. persisted Claude `sessionId` in metadata
2. latest discovered Claude session whose `cwd` matches the worktree path
3. prefer matching `gitBranch` when available
4. create a new session on first send if none exists

## Risks

- Bun compatibility with the Claude SDK needs to be verified early
- session discovery must be strict about `cwd`
- the UI should not expose Claude chat before the backend attach/send path exists

## First implementation slice

Start with phase 1 only:

- provider-generic metadata/types
- compatibility normalization for old Codex metadata
- no Claude adapter yet
- no route behavior change yet
