# Codex Streaming Architecture

This document records the cleaned-up Codex in-app chat streaming model.

## Source Of Truth

Codex app-server thread data is the transcript source of truth.

- `backend/src/adapters/codex-app-server.ts` owns the JSON-RPC process boundary.
- `backend/src/services/worktree-conversation-service.ts` projects app-server turns/items into UI conversation messages.
- The old Codex session-log transcript fallback was removed, so the app-server thread is no longer merged with a second transcript source.

## Message Identity

Every app-server-owned message uses the app-server item id as its identity.

- Assistant text/thinking messages use the app-server item id.
- Command executions use the app-server command item id for the tool call.
- Command output uses the derived id `${item.id}:result`.
- Optimistic frontend user messages use `pending-user:${turnId}` and are reconciled only with the server user message for the same turn id.

Text content is not used for assistant identity. Prefix matching and "same-looking" message reconciliation are intentionally absent.

## Message Order

`AgentsUiConversationMessage.order` is the single transcript ordering field.

- Snapshots assign order from app-server turn/item order.
- Streamed items reserve order when the backend first sees the app-server item id.
- Tool results use the command item's reserved order plus one.
- The frontend sorts by `order` after deltas, upserts, and snapshots.

Visibility never changes order. Empty streamed assistant items can remain hidden in rendering, but becoming non-empty does not move them.

## Stream Events

The websocket contract is:

- `snapshot`: full conversation state.
- `messageDelta`: assistant text delta for one item id, with its order.
- `messageUpsert`: full item projection for one item id, with its order.
- `error`: stream error.

The backend emits deltas/upserts by exact item id. It refreshes snapshots on turn status changes and on completion of user, assistant, and command-execution items.

## Snapshot Reconciliation

Snapshots are authoritative once they contain completed data.

While a snapshot is still running, the backend can merge live messages by exact id so recent deltas are not lost. When a completed snapshot arrives, snapshot content wins even if it is shorter than streamed content.

The frontend snapshot reducer is intentionally mechanical:

- replace server-owned messages with the snapshot;
- preserve only unmatched optimistic user messages;
- sort by `order`.

## Removed Heuristics

The cleanup removed:

- assistant text-prefix matching;
- "longer text wins";
- visibility-based assistant message movement;
- current-array-order preservation over explicit order;
- Codex session-log transcript merging.
