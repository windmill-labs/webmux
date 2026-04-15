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
    markConversationTurnStarted,
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
  }

  const { worktree }: Props = $props();

  let conversation = $state<AgentsUiConversationState | null>(null);
  let conversationError = $state<string | null>(null);
  let conversationLoading = $state(false);
  let composerText = $state("");
  let isSending = $state(false);
  let refreshPollingToken = $state(0);
  let streamConnection: {
    conversationId: string;
    disconnect: () => void;
  } | null = null;

  function closeConversationStream(): void {
    streamConnection?.disconnect();
    streamConnection = null;
  }

  function supportsStreaming(nextConversation: AgentsUiConversationState | null): boolean {
    return nextConversation?.provider === "codexAppServer";
  }

  function hasActiveConversationStream(conversationId: string): boolean {
    return streamConnection?.conversationId === conversationId;
  }

  function applyConversationResponse(response: AgentsUiWorktreeConversationResponse): void {
    conversation = response.conversation;
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

    switch (event.type) {
      case "snapshot":
        applyConversationResponse(event.data);
        break;
      case "messageDelta":
        conversation = applyConversationMessageDelta(conversation, event);
        break;
      case "error":
        conversationError = event.message;
        break;
    }
  }

  function syncConversationStream(): void {
    if (!supportsStreaming(conversation)) {
      closeConversationStream();
      return;
    }

    const conversationId = conversation?.conversationId ?? null;
    if (!conversationId) {
      closeConversationStream();
      return;
    }

    if (hasActiveConversationStream(conversationId)) {
      return;
    }

    closeConversationStream();
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

  async function loadConversation(mode: "attach" | "history"): Promise<void> {
    conversationLoading = true;
    conversationError = null;

    try {
      const response = mode === "attach"
        ? await attachWorktreeConversation(worktree.branch)
        : await fetchWorktreeConversationHistory(worktree.branch);

      applyConversationResponse(response);
      if (!response.conversation.running) {
        refreshPollingToken = 0;
      }
    } catch (error) {
      conversationError = error instanceof Error ? error.message : String(error);
    } finally {
      conversationLoading = false;
    }
  }

  function startRefreshPolling(): void {
    refreshPollingToken += 1;
  }

  async function sendSelectedConversationMessage(): Promise<void> {
    if (!conversation) return;
    const text = composerText.trim();
    if (text.length === 0) return;

    isSending = true;
    conversationError = null;
    try {
      const response = await sendWorktreeConversationMessage(worktree.branch, { text });
      composerText = "";
      if (conversation.conversationId !== response.conversationId) {
        conversation = {
          ...conversation,
          conversationId: response.conversationId,
        };
      }
      conversation = markConversationTurnStarted(conversation, response.turnId, text);
      syncConversationStream();
      startRefreshPolling();
    } catch (error) {
      conversationError = error instanceof Error ? error.message : String(error);
    } finally {
      isSending = false;
    }
  }

  async function interruptSelectedConversation(): Promise<void> {
    conversationError = null;
    try {
      await interruptWorktreeConversation(worktree.branch);
      startRefreshPolling();
    } catch (error) {
      conversationError = error instanceof Error ? error.message : String(error);
    }
  }

  onMount(() => {
    void loadConversation("attach");
    return () => {
      closeConversationStream();
    };
  });

  $effect(() => {
    const token = refreshPollingToken;
    if (token === 0) return;

    let refreshCount = 0;
    const interval = window.setInterval(() => {
      if (refreshPollingToken !== token) return;
      refreshCount += 1;
      void loadConversation("history");
      if (refreshCount >= 30) {
        refreshPollingToken = 0;
      }
    }, 1000);

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
/>
