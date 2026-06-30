<script lang="ts">
  import { onMount } from "svelte";
  import {
    attachWorktreeConversation,
    connectWorktreeConversationStream,
    fetchWorktreeConversationHistory,
    interruptWorktreeConversation,
    sendWorktreeConversationMessage,
  } from "./api";
  import {
    applyConversationMessageDelta,
    applyConversationMessageUpsert,
    applyConversationStatus,
    buildConversationProgressSignature,
    markConversationTurnStarted,
    mergeConversationSnapshot,
  } from "./worktree-conversation";
  import type {
    AgentsUiConversationEvent,
    AgentsUiConversationState,
    AgentsUiWorktreeConversationResponse,
    WorktreeInfo,
  } from "./types";
  import WorktreeConversationPanel from "./WorktreeConversationPanel.svelte";

  interface Props {
    worktree: WorktreeInfo;
    onConversationMessageSent?: () => void;
  }

  const {
    worktree,
    onConversationMessageSent = () => {},
  }: Props = $props();

  let conversation = $state<AgentsUiConversationState | null>(null);
  let conversationError = $state<string | null>(null);
  let conversationLoading = $state(false);
  let composerText = $state("");
  let isSending = $state(false);
  let isAnsweringQuestion = $state(false);
  let refreshPollingState = $state<{
    token: number;
    baselineSignature: string | null;
    lastSignature: string | null;
    sawProgress: boolean;
    unchangedTicks: number;
    stopWhenIdle: boolean;
  } | null>(null);
  let streamConnection: {
    conversationId: string;
    disconnect: () => void;
  } | null = null;
  let nextRefreshPollingToken = 1;
  let lastStreamRevision = 0;

  const REFRESH_POLL_INTERVAL_MS = 1000;
  const REFRESH_POLL_SETTLE_TICKS = 3;

  function closeConversationStream(): void {
    streamConnection?.disconnect();
    streamConnection = null;
    lastStreamRevision = 0;
  }

  function supportsStreaming(nextConversation: AgentsUiConversationState | null): boolean {
    return nextConversation?.provider === "codexAppServer" || nextConversation?.provider === "claudeCode";
  }

  function hasActiveConversationStream(conversationId: string): boolean {
    return streamConnection?.conversationId === conversationId;
  }

  function applyConversationResponse(response: AgentsUiWorktreeConversationResponse): void {
    conversation = mergeConversationSnapshot(conversation, response.conversation);
    conversationError = null;
    syncConversationStream();
  }

  function handleConversationStreamFailure(conversationId: string, message: string): void {
    if (!hasActiveConversationStream(conversationId) || !streamConnection) return;
    const currentConnection = streamConnection;
    streamConnection = null;
    currentConnection.disconnect();
    conversationError = message;
  }

  function handleConversationStreamEvent(conversationId: string, event: AgentsUiConversationEvent): void {
    if (!hasActiveConversationStream(conversationId)) return;
    if (event.type !== "error") {
      if (event.revision <= lastStreamRevision) return;
      lastStreamRevision = event.revision;
    }

    switch (event.type) {
      case "messageDelta":
        conversation = applyConversationMessageDelta(conversation, event);
        break;
      case "messageUpsert":
        conversation = applyConversationMessageUpsert(conversation, event);
        break;
      case "conversationStatus":
        conversation = applyConversationStatus(conversation, event);
        syncConversationStream();
        break;
      case "error":
        conversationError = event.message;
        break;
    }
  }

  function syncConversationStream(force = false): void {
    const conversationId = supportsStreaming(conversation) ? conversation?.conversationId ?? null : null;

    // Keep one stream open across turns (close only on conversation change) so the
    // server-side message ordering isn't reseeded per turn, which interleaves turns.
    if (streamConnection && streamConnection.conversationId !== conversationId) {
      closeConversationStream();
    }

    if (!conversationId || hasActiveConversationStream(conversationId)) {
      return;
    }

    // Not connected yet: open on a send (force) or when a run is already active.
    if (!force && conversation?.running !== true) {
      return;
    }

    lastStreamRevision = 0;
    const disconnect = connectWorktreeConversationStream(worktree.branch, {
      onEvent: (event) => {
        handleConversationStreamEvent(conversationId, event);
      },
      onError: (message) => {
        handleConversationStreamFailure(conversationId, message);
      },
      onClose: () => {
        handleConversationStreamFailure(conversationId, "Conversation stream disconnected");
      },
    });
    streamConnection = { conversationId, disconnect };
  }

  function requestConversation(mode: "attach" | "history"): Promise<AgentsUiWorktreeConversationResponse> {
    return mode === "attach"
      ? attachWorktreeConversation(worktree.branch)
      : fetchWorktreeConversationHistory(worktree.branch);
  }

  async function loadConversation(mode: "attach" | "history"): Promise<void> {
    conversationLoading = true;
    conversationError = null;

    try {
      const response = await requestConversation(mode);
      applyConversationResponse(response);
    } catch (error) {
      conversationError = error instanceof Error ? error.message : String(error);
    } finally {
      conversationLoading = false;
    }
  }

  function startRefreshPolling(
    baselineConversation: AgentsUiConversationState | null = conversation,
    stopWhenIdle = false,
  ): void {
    const baselineSignature = buildConversationProgressSignature(baselineConversation);
    refreshPollingState = {
      token: nextRefreshPollingToken,
      baselineSignature,
      lastSignature: baselineSignature,
      sawProgress: false,
      unchangedTicks: 0,
      stopWhenIdle,
    };
    nextRefreshPollingToken += 1;
  }

  function updateRefreshPollingState(
    token: number,
    nextConversation: AgentsUiConversationState,
  ): void {
    const currentState = refreshPollingState;
    if (!currentState || currentState.token !== token) return;

    // Terminal-owned turns settle when the worktree agent goes idle (handled by the
    // busy-poll effect below), not via the message-progress heuristic used for sends.
    if (currentState.stopWhenIdle) return;

    const nextSignature = buildConversationProgressSignature(nextConversation);
    const sawProgress = currentState.sawProgress || nextSignature !== currentState.baselineSignature;
    const unchangedTicks = nextSignature === currentState.lastSignature
      ? currentState.unchangedTicks + 1
      : 0;

    if (sawProgress && unchangedTicks >= REFRESH_POLL_SETTLE_TICKS) {
      refreshPollingState = null;
      return;
    }

    refreshPollingState = {
      ...currentState,
      lastSignature: nextSignature,
      sawProgress,
      unchangedTicks,
    };
  }

  async function sendConversationText(text: string): Promise<boolean> {
    if (!conversation) return false;
    const baselineConversation = conversation;
    const trimmed = text.trim();
    if (trimmed.length === 0) return false;

    isSending = true;
    conversationError = null;
    try {
      syncConversationStream(true);
      const response = await sendWorktreeConversationMessage(worktree.branch, { text: trimmed });
      if (conversation.conversationId !== response.conversationId) {
        conversation = {
          ...conversation,
          conversationId: response.conversationId,
        };
      }
      conversation = markConversationTurnStarted(conversation, response.turnId, trimmed);
      if (response.streaming) {
        syncConversationStream();
      } else {
        closeConversationStream();
        startRefreshPolling(baselineConversation);
      }
      onConversationMessageSent();
      return true;
    } catch (error) {
      conversationError = error instanceof Error ? error.message : String(error);
      return false;
    } finally {
      isSending = false;
    }
  }

  async function sendSelectedConversationMessage(): Promise<void> {
    if (composerText.trim().length === 0) return;
    const sent = await sendConversationText(composerText);
    if (sent) composerText = "";
  }

  async function interruptSelectedConversation(): Promise<void> {
    const baselineConversation = conversation;
    conversationError = null;
    try {
      const response = await interruptWorktreeConversation(worktree.branch);
      if (response.streaming) {
        syncConversationStream();
      } else {
        closeConversationStream();
        startRefreshPolling(baselineConversation);
      }
    } catch (error) {
      conversationError = error instanceof Error ? error.message : String(error);
    }
  }

  // Answering an AskUserQuestion is a new turn, so the run that asked it must end
  // first. In headless `claude -p` the question is auto-dismissed and the turn
  // keeps going, so interrupt the active run before sending the answer.
  async function answerConversationQuestion(text: string): Promise<void> {
    if (!conversation || isSending || isAnsweringQuestion) return;
    isAnsweringQuestion = true;
    try {
      if (conversation.running) {
        await interruptSelectedConversation();
      }
      await sendConversationText(text);
    } finally {
      isAnsweringQuestion = false;
    }
  }

  onMount(() => {
    void loadConversation("attach");
    return () => {
      closeConversationStream();
    };
  });

  $effect(() => {
    // A Claude turn started in the terminal (the initial worktree prompt, or anything
    // typed in the pane) is not a backend-owned run, so there is no stream to subscribe
    // to and the snapshot reports running:false. While the worktree agent is busy, poll
    // history so the terminal claude's flushed messages appear live; stop once it idles.
    const agentBusy = worktree.agent === "working";
    const isTerminalOwnedClaudeTurn =
      conversation?.provider === "claudeCode" && conversation.running !== true;

    if (agentBusy && isTerminalOwnedClaudeTurn) {
      if (refreshPollingState === null) {
        startRefreshPolling(conversation, true);
      }
      return;
    }

    if (refreshPollingState?.stopWhenIdle === true) {
      refreshPollingState = null;
    }
  });

  $effect(() => {
    const pollingState = refreshPollingState;
    if (!pollingState) return;

    const token = pollingState.token;
    let requestInFlight = false;

    // Polling is only for conversation providers that do not publish live stream events.
    const interval = window.setInterval(() => {
      if (!refreshPollingState || refreshPollingState.token !== token || requestInFlight) return;
      requestInFlight = true;
      void (async () => {
        try {
          const response = await requestConversation("history");
          applyConversationResponse(response);
          updateRefreshPollingState(token, response.conversation);
        } catch (error) {
          conversationError = error instanceof Error ? error.message : String(error);
        } finally {
          requestInFlight = false;
        }
      })();
    }, REFRESH_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
    };
  });
</script>

<WorktreeConversationPanel
  {worktree}
  {conversation}
  {conversationError}
  {conversationLoading}
  {composerText}
  {isSending}
  onAttach={() => void loadConversation("attach")}
  onComposerInput={(value) => {
    composerText = value;
  }}
  onInterrupt={() => void interruptSelectedConversation()}
  onRefresh={() => void loadConversation("history")}
  onSend={() => void sendSelectedConversationMessage()}
  onAnswerQuestion={(text) => void answerConversationQuestion(text)}
/>
