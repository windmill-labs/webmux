# Codex Streaming Architecture Audit

This document describes the current Codex in-app chat streaming path and the brittle code in that path. It focuses on message identity, ordering, completion, and snapshot reconciliation.

## Current Architecture

### 1. Codex app-server adapter

`backend/src/adapters/codex-app-server.ts` owns the process boundary to `codex app-server`.

- The adapter launches `codex app-server` with `Bun.spawn` and speaks JSON-RPC over stdout/stdin.
- It initializes the app-server with `experimentalApi: true`.
- Request/response methods include `thread/list`, `thread/read`, `thread/resume`, `thread/start`, `turn/start`, and `turn/interrupt`.
- Notifications are any JSON-RPC message without an `id`. They are exposed to listeners through `onNotification`.

Relevant code:

- `CodexAppServerThreadItem` models app-server items as `userMessage`, `agentMessage`, `commandExecution`, or generic unknown items: `backend/src/adapters/codex-app-server.ts:20`.
- `CodexAppServerNotification` is loose: `{ method: string; params?: unknown }`: `backend/src/adapters/codex-app-server.ts:166`.
- `onNotification` registers listeners: `backend/src/adapters/codex-app-server.ts:389`.
- `startStdoutLoop` parses newline-delimited JSON from app-server stdout: `backend/src/adapters/codex-app-server.ts:474`.
- `handleStdoutLine` separates responses from notifications: `backend/src/adapters/codex-app-server.ts:532`.

### 2. Backend conversation snapshot service

`backend/src/services/worktree-conversation-service.ts` builds authoritative snapshot responses from app-server thread reads.

Main responsibilities:

- Resolve the Codex thread for a worktree from saved metadata or by discovering the newest thread for the worktree cwd.
- Convert app-server thread items into UI messages.
- Start turns with `turn/start`.
- Interrupt the active turn with `turn/interrupt`.

Relevant code:

- `buildCodexItemConversationMessages` maps app-server items to `AgentsUiConversationMessage`: `backend/src/services/worktree-conversation-service.ts:160`.
- Agent messages become `kind: "thinking"` when `phase === "analysis"` and `kind: "text"` otherwise: `backend/src/services/worktree-conversation-service.ts:182`.
- `commandExecution` becomes a synthetic assistant `toolUse` plus synthetic user `toolResult` when output exists: `backend/src/services/worktree-conversation-service.ts:198`.
- Snapshot message merge with additional session-log messages happens in `mergeConversationMessages`: `backend/src/services/worktree-conversation-service.ts:303`.
- `sendWorktreeConversationMessage` calls `turn/start` and returns `{ conversationId, turnId, running: true }`: `backend/src/services/worktree-conversation-service.ts:430`.

### 3. Backend websocket stream service

`backend/src/server.ts` opens the websocket and `backend/src/services/agents-ui-stream-service.ts` converts app-server notifications into UI stream events.

Flow:

1. The websocket subscribes to all app-server notifications.
2. Notifications are buffered while the initial snapshot loads.
3. A per-socket `AgentsConversationStreamSession` is created for the resolved conversation id.
4. The initial snapshot is sent.
5. Buffered notifications are replayed through the stream session.
6. Later notifications are filtered by conversation id and passed to the stream session.

Relevant code:

- `openAgentsSocket` owns websocket setup, initial snapshot load, notification buffering, and replay: `backend/src/server.ts:843`.
- The stream session stores `liveMessages` in a `Map<string, AgentsUiConversationMessage>` keyed by message id: `backend/src/services/agents-ui-stream-service.ts:264`.
- `item/agentMessage/delta` becomes a `messageDelta` event with `itemId` and `delta`: `backend/src/services/agents-ui-stream-service.ts:70`.
- `item/started` and `item/completed` become `messageUpsert` events with full/partial item state: `backend/src/services/agents-ui-stream-service.ts:94`.
- `turn/completed` and idle/completed/interrupted status changes complete remaining live messages and queue a snapshot refresh: `backend/src/services/agents-ui-stream-service.ts:257`.

### 4. API event contract

The UI event contract is in `backend/src/domain/agents-ui.ts`.

The event model is:

- `snapshot`: full `AgentsUiWorktreeConversationResponse`.
- `messageDelta`: `{ conversationId, turnId, itemId, delta }`.
- `messageUpsert`: `{ conversationId, message }`.
- `error`: `{ message }`.

Relevant code:

- `AgentsUiConversationMessage` shape: `backend/src/domain/agents-ui.ts:34`.
- `AgentsUiConversationState` shape: `backend/src/domain/agents-ui.ts:51`.
- Stream event union: `backend/src/domain/agents-ui.ts:81`.

Important limitation: there is no explicit client event for "item started", "item completed", "item order index", or "replace this item with this authoritative item". Those concepts are folded into `messageUpsert` and `snapshot`.

### 5. Frontend websocket client

`frontend/src/lib/api.ts` opens the websocket and validates events with the shared schema.

Relevant code:

- `connectWorktreeConversationStream` opens the websocket: `frontend/src/lib/api.ts:130`.
- Incoming messages are parsed as `AgentsUiConversationEventSchema`: `frontend/src/lib/api.ts:145`.
- Malformed data becomes a generic client error: `frontend/src/lib/api.ts:147`.

### 6. Frontend chat state owner

`frontend/src/lib/MobileChatSurface.svelte` owns the live conversation state.

Main responsibilities:

- Attach/read the initial conversation.
- Open the websocket for Codex conversations.
- Drop old websocket events by revision.
- Apply snapshots, deltas, and upserts through helper reducers.
- Create optimistic user messages after `send`.
- Keep a polling fallback for non-streaming conversations.

Relevant code:

- All snapshots go through `mergeConversationSnapshot`: `frontend/src/lib/MobileChatSurface.svelte:71`.
- Stream event dispatch applies delta/upsert/snapshot reducers: `frontend/src/lib/MobileChatSurface.svelte:91`.
- Websocket connection lifecycle is keyed by conversation id: `frontend/src/lib/MobileChatSurface.svelte:114`.
- Sending a message creates an optimistic user message after `turn/start`: `frontend/src/lib/MobileChatSurface.svelte:206`.

### 7. Frontend conversation reducers

`frontend/src/lib/worktree-conversation.ts` is the main client-side reducer layer.

Main responsibilities:

- Apply token deltas by appending `delta` to the message with `event.itemId`.
- Apply full message upserts.
- Merge snapshots into current state while preserving optimistic user messages and recent live order.
- Create optimistic user messages.

Relevant code:

- `applyConversationMessageDelta`: `frontend/src/lib/worktree-conversation.ts:19`.
- `replaceConversationMessage` can move newly visible assistant messages to the end: `frontend/src/lib/worktree-conversation.ts:100`.
- `isSameLogicalConversationMessage` performs fuzzy identity matching: `frontend/src/lib/worktree-conversation.ts:137`.
- `applyConversationMessageUpsert`: `frontend/src/lib/worktree-conversation.ts:159`.
- `mergeConversationSnapshot`: `frontend/src/lib/worktree-conversation.ts:189`.

### 8. Frontend rendering

`frontend/src/lib/WorktreeConversationPanel.svelte` renders the transcript.

Relevant code:

- Empty text/thinking messages are hidden: `frontend/src/lib/WorktreeConversationPanel.svelte:106`.
- Tool results are grouped with matching tool calls by `toolCallId`: `frontend/src/lib/WorktreeConversationPanel.svelte:114`.
- Transcript items render in the array order produced by the reducer: `frontend/src/lib/WorktreeConversationPanel.svelte:261`.
- The processing indicator follows the same state as the composer stop button: `frontend/src/lib/WorktreeConversationPanel.svelte:45`.

## Brittle Code And Failure Modes

### 1. Frontend assistant identity uses text-prefix matching

Location: `frontend/src/lib/worktree-conversation.ts:121` and `frontend/src/lib/worktree-conversation.ts:137`.

Current behavior:

- `textOverlaps(left, right)` returns true when either text is a prefix of the other.
- `isSameLogicalConversationMessage` uses that for assistant `text` and `thinking` messages when role, kind, turn id, and phase match.
- `applyConversationMessageUpsert` then updates the matched existing message instead of adding a new one.

Why brittle:

- The app-server already gives stable `itemId`/message ids.
- Prefix matching can treat a new assistant item as the previous assistant item.
- Empty strings are especially dangerous because every string starts with `""`.
- This directly explains a "new message completes the previous one before being set in its own container" symptom.

Expected direction:

- Live assistant upserts should match by exact app-server item id only.
- Tool calls can match by exact `toolCallId` when needed.
- Text similarity should not participate in live message identity.

### 2. Backend snapshot/live reconciliation also uses text-prefix matching

Location: `backend/src/services/agents-ui-stream-service.ts:144` and `backend/src/services/agents-ui-stream-service.ts:148`.

Current behavior:

- The backend stream session merges live messages into snapshots.
- It considers two assistant text/thinking messages the same if either text prefixes the other.

Why brittle:

- A partial live assistant message can match the wrong snapshot message.
- A completed snapshot can mark the wrong live message complete.
- A snapshot can incorrectly dedupe two distinct assistant messages that share a prefix.

Expected direction:

- Snapshot/live reconciliation should match assistant messages by item id.
- If we still need duplicate protection for old app-server snapshots with changed ids, use a narrow exact non-empty text match only in snapshot reconciliation, not in live stream upsert handling.

### 3. "Longer text wins" can preserve stale or wrong content

Locations:

- Backend stream merge: `backend/src/services/agents-ui-stream-service.ts:128`.
- Frontend upsert merge: `frontend/src/lib/worktree-conversation.ts:69`.
- Backend snapshot/session merge: `backend/src/services/worktree-conversation-service.ts:285`.

Current behavior:

- When merging two messages, the code keeps whichever text is longer.

Why brittle:

- App-server completion may intentionally replace text with shorter final text.
- A snapshot may be authoritative but shorter.
- If a wrong message was matched by prefix, "longer text wins" cements the wrong content in the wrong container.

Expected direction:

- For same id, trust event lifecycle:
  - deltas append to the current in-progress item;
  - `item/completed` upsert is authoritative for that item;
  - snapshots are authoritative after turn completion unless a newer live event exists.
- Avoid content-length as a source of truth.

### 4. Frontend moves assistant messages based on visibility instead of item order

Location: `frontend/src/lib/worktree-conversation.ts:90` and `frontend/src/lib/worktree-conversation.ts:100`.

Current behavior:

- If an assistant text/thinking message was empty and later becomes non-empty, `replaceConversationMessage` removes it from its current index and appends it to the end.

Why brittle:

- This makes order depend on when text becomes visible, not on app-server item order.
- It was added to make "assistant text after tool call" look correct, but it is a heuristic.
- When snapshots arrive later, the snapshot merge tries to preserve this live order, creating more ordering complexity.

Expected direction:

- Carry explicit item order from app-server events/snapshots.
- Render in app-server item order.
- Hide empty placeholders without moving the underlying item.

### 5. Frontend snapshot merge preserves current order over authoritative snapshot order

Location: `frontend/src/lib/worktree-conversation.ts:189`.

Current behavior:

- For messages already in current state, `mergeConversationSnapshot` keeps the current array order and replaces content by id.
- New incoming snapshot messages are appended afterward.

Why brittle:

- It works around snapshots arriving in an order that looked wrong after live streaming.
- It also means a later authoritative snapshot cannot reliably correct bad live order.
- Once the frontend moves a message for visibility reasons, the bad order can persist.

Expected direction:

- Use a deterministic ordering key from app-server items.
- If live events have a newer event sequence than the snapshot, preserve live order only for unresolved live items.
- Once a final snapshot has all item ids and order, trust it.

### 6. We do not carry app-server item order in the UI contract

Location: `backend/src/domain/agents-ui.ts:34`.

Current behavior:

- UI messages have `id`, `turnId`, `role`, `text`, `status`, `createdAt`, `kind`, `phase`, and tool metadata.
- They do not carry turn index, item index, stream sequence, or app-server item type separately from UI kind.

Why brittle:

- The frontend cannot sort by the app-server's actual item order when live events and snapshots disagree.
- It falls back to arrival order, visibility moves, timestamps, and snapshot merge order.

Expected direction:

- Add explicit ordering metadata, for example `{ turnIndex, itemIndex }` from snapshots and a stream sequence from notifications.
- Keep app-server item id as the sole identity for app-server-owned messages.

### 7. Snapshot timestamps are too coarse for intra-turn ordering

Location: `backend/src/services/worktree-conversation-service.ts:338`.

Current behavior:

- Snapshot-created assistant/tool messages use `turn.completedAt ?? turn.startedAt`.
- Multiple items in the same turn can have the same timestamp.
- `compareMessagesByTimestamp` returns `0` when timestamps are missing: `backend/src/services/worktree-conversation-service.ts:239`.

Why brittle:

- Timestamps cannot reliably recover item order inside a turn.
- Sorting additional messages by timestamp can interleave messages unpredictably when timestamps are equal or missing.

Expected direction:

- Prefer explicit item order over timestamps.
- Use timestamps only for display metadata.

### 8. Backend live-message completion can complete too broadly

Location: `backend/src/services/agents-ui-stream-service.ts:335` and `backend/src/services/agents-ui-stream-service.ts:370`.

Current behavior:

- On `turn/completed`, all in-progress live messages for that turn are marked completed.
- On some status changes, `readNotificationTurnId` may return null, and `completeLiveMessages(null)` completes all in-progress live messages in the stream session.

Why brittle:

- A conversation-level status event without a turn id can complete unrelated live messages.
- The app-server item lifecycle already gives more precise item completion through `item/completed`.

Expected direction:

- Prefer `item/completed` to complete a specific item.
- Use turn-level completion only as a final cleanup after verifying active turn id.

### 9. Snapshot refresh triggers skip commandExecution completion

Location: `backend/src/services/agents-ui-stream-service.ts:418`.

Current behavior:

- Snapshot refresh is queued for `turn/started`, `turn/completed`, `thread/status/changed`, and `item/completed` only for `userMessage` or `agentMessage`.
- `commandExecution` completion does not trigger a snapshot refresh.

Why brittle:

- If the `item/completed` notification for a command does not include all final output metadata, the UI may rely on a later unrelated refresh.
- Tool output currently depends on the commandExecution item payload being complete enough in the notification.

Expected direction:

- Refresh on `commandExecution` completion too, or guarantee that the command completion notification carries final `aggregatedOutput`, `exitCode`, and `durationMs`.

### 10. Empty item-start messages are stateful but invisible

Locations:

- Backend includes empty text on item started: `backend/src/services/agents-ui-stream-service.ts:115`.
- Frontend hides empty text/thinking messages: `frontend/src/lib/WorktreeConversationPanel.svelte:106`.
- Frontend later moves newly visible messages: `frontend/src/lib/worktree-conversation.ts:90`.

Current behavior:

- Empty assistant placeholders exist in conversation state but do not render.
- Later deltas/upserts can make them visible, and visibility can trigger a move to the end.

Why brittle:

- Hidden state changes still affect ordering and merge behavior.
- The user sees containers appear in different places after text arrives.

Expected direction:

- Either render stable placeholders for started items, or keep placeholders invisible without changing their order.
- Do not use visibility transition as an ordering signal.

### 11. Delta before item-start defaults to final text kind

Locations:

- Backend live delta state: `backend/src/services/agents-ui-stream-service.ts:349`.
- Frontend delta reducer: `frontend/src/lib/worktree-conversation.ts:25`.

Current behavior:

- If a delta arrives before `item/started`, the item is created as `kind: "text"` with no phase.
- A later upsert can correct kind/phase if it arrives.

Why brittle:

- Analysis/thinking deltas can temporarily render as normal assistant text.
- If the corresponding `item/started` is missed, the item remains misclassified.

Expected direction:

- Ensure `item/started` is sent before deltas, or buffer deltas by item id until the item-start metadata arrives.

### 12. Generic notification parsing silently drops unknown or malformed data

Locations:

- App-server notifications are loose: `backend/src/adapters/codex-app-server.ts:166`.
- Stream event builders return null/empty arrays on missing fields: `backend/src/services/agents-ui-stream-service.ts:70` and `backend/src/services/agents-ui-stream-service.ts:94`.

Current behavior:

- Missing `threadId`, `turnId`, `itemId`, or `delta` causes events to be ignored.
- Unknown item shapes parse as generic items and produce no UI messages.

Why brittle:

- A schema drift in app-server can produce missing UI updates without an explicit failure.
- Debugging stream gaps is harder because ignored notifications are not surfaced.

Expected direction:

- Add stricter schemas for supported notification methods.
- Log ignored supported-method notifications with enough context.

### 13. Initial websocket buffering can accumulate unrelated notifications

Location: `backend/src/server.ts:847`.

Current behavior:

- While loading the initial snapshot, the socket buffers all app-server notifications globally.
- They are later passed through `streamSession.handleNotification`, which filters by conversation id.

Why brittle:

- A slow snapshot load can accumulate unrelated notifications.
- Filtering happens late.

Expected direction:

- Buffer only notifications with the relevant thread id once it is known.
- Or load the snapshot first, then subscribe with a small missed-event recovery strategy.

### 14. Optimistic user message dedupe uses text matching

Location: `frontend/src/lib/worktree-conversation.ts:125`.

Current behavior:

- A pending optimistic user message is considered the same as a server user message when the turn id matches or the trimmed text matches.

Why brittle:

- Repeated identical prompts can be merged if the wrong server user item arrives while a pending optimistic item exists.
- Current UI disables concurrent sends while running, so this is lower risk than assistant text matching, but it is still heuristic.

Expected direction:

- Prefer the `turnId` returned by `turn/start`.
- Avoid text-only replacement unless scoped to the active pending turn and a narrow time window.

### 15. Tool result pairing is frontend-derived

Location: `frontend/src/lib/WorktreeConversationPanel.svelte:114`.

Current behavior:

- Tool results are paired with tool calls by `toolCallId`.
- The backend synthesizes tool results from commandExecution output using id `${item.id}:result`.

Why brittle:

- There is no distinct app-server tool-result item in the UI contract.
- If command output updates independently from command metadata, the UI depends on synthetic pairing staying consistent.

Expected direction:

- Keep command execution as one structured message with `input`, `output`, and lifecycle fields, or expose explicit tool call and tool result item events with stable app-server ids.

## Root Cause Summary

The app-server gives us item boundaries and item ids, but the current UI stream layer does not fully trust them. It mixes deterministic event identity with heuristics:

- text-prefix matching;
- "longer text wins";
- visibility-based reordering;
- current-order-preserving snapshot merge;
- timestamp fallback for intra-turn order.

These heuristics interact. A wrong prefix match can update the wrong assistant bubble; "longer text wins" can preserve the wrong content; visibility-based movement can change order; snapshot merge can then preserve that wrong live order.

## Recommended Direction

The simplest stable model is:

1. Use app-server item id as the identity for every app-server-owned item.
2. Represent item lifecycle explicitly:
   - `itemStarted`;
   - `itemDelta`;
   - `itemCompleted`;
   - `snapshot`.
3. Carry app-server ordering metadata in the UI message model.
4. Never infer assistant message identity from text.
5. Never infer message order from visibility.
6. Treat final item completion/snapshot data as authoritative unless we can prove a newer live event supersedes it.
7. Keep optimistic user-message reconciliation separate from assistant/tool reconciliation.

## Suggested Fix Order

1. Remove frontend text-prefix matching for assistant text/thinking upserts.
2. Remove backend text-prefix matching from live stream reconciliation, or constrain it to exact non-empty final snapshot dedupe only.
3. Remove visibility-based reordering in `replaceConversationMessage`.
4. Add explicit order metadata to `AgentsUiConversationMessage`.
5. Make frontend rendering sort by that order metadata.
6. Replace "longer text wins" with lifecycle-aware merges.
7. Add regression tests for:
   - two same-turn assistant messages with shared prefixes;
   - empty assistant item started before a tool call;
   - assistant item completed before next tool item starts;
   - final snapshot arriving with a different order than live events;
   - commandExecution completed notification with output.
