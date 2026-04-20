<script lang="ts">
  import { tick } from "svelte";
  import type { AgentsUiConversationState, WorktreeInfo } from "./types";

  interface Props {
    worktree: WorktreeInfo;
    conversation: AgentsUiConversationState | null;
    conversationError: string | null;
    conversationLoading: boolean;
    composerText: string;
    isSending: boolean;
    onAttach: () => void;
    onComposerInput: (value: string) => void;
    onInterrupt: () => void;
    onRefresh: () => void;
    onSend: () => void;
  }

  const {
    worktree,
    conversation,
    conversationError,
    conversationLoading,
    composerText,
    isSending,
    onAttach,
    onComposerInput,
    onInterrupt,
    onRefresh,
    onSend,
  }: Props = $props();

  const agentLabel = $derived(worktree.agentName === "claude" ? "Claude" : "Codex");
  const supportsAgentChat = $derived(worktree.agentName === "codex" || worktree.agentName === "claude");
  const chatAvailable = $derived(supportsAgentChat && worktree.mux === "✓");
  const showInterrupt = $derived(chatAvailable && (conversation?.running ?? false));
  const canSend = $derived(
    chatAvailable
      && conversation !== null
      && !conversationLoading
      && composerText.trim().length > 0
      && !isSending
      && !(conversation?.running ?? false),
  );

  let transcriptViewport = $state<HTMLDivElement | null>(null);

  function handleComposerInput(event: Event): void {
    const target = event.currentTarget;
    if (!(target instanceof HTMLTextAreaElement)) return;
    onComposerInput(target.value);
  }

  function handleComposerKeydown(event: KeyboardEvent): void {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    if (canSend) {
      onSend();
    }
  }

  async function scrollTranscriptToBottom(): Promise<void> {
    await tick();
    transcriptViewport?.scrollTo({
      top: transcriptViewport.scrollHeight,
      behavior: "auto",
    });
  }

  $effect(() => {
    const conversationId = conversation?.conversationId ?? null;
    const messageCount = conversation?.messages.length ?? 0;
    const lastMessageId = messageCount > 0 ? conversation?.messages[messageCount - 1]?.id ?? null : null;
    const lastMessageTextLength = messageCount > 0 ? conversation?.messages[messageCount - 1]?.text.length ?? 0 : 0;
    if (!conversationId || !transcriptViewport) return;
    void scrollTranscriptToBottom();
    void conversationId;
    void messageCount;
    void lastMessageId;
    void lastMessageTextLength;
  });
</script>

{#snippet interruptButton()}
  <button
    type="button"
    class="rounded-md border border-danger px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/10"
    onclick={onInterrupt}
  >
    Interrupt
  </button>
{/snippet}

{#if !supportsAgentChat}
  <div class="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted">
    Chat is not available for this worktree yet.
  </div>
{:else if !chatAvailable}
  <div class="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted">
    Open this worktree first to use chat.
  </div>
{:else}
  <section class="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface">
    {#if conversationError}
      <div class="mx-4 mt-4 rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-primary">
        <div>{conversationError}</div>
        <div class="mt-3 flex items-center gap-2">
          <button
            type="button"
            class="rounded-md border border-edge bg-surface px-3 py-1.5 text-xs font-medium text-primary hover:bg-hover"
            onclick={conversation ? onRefresh : onAttach}
            disabled={conversationLoading || isSending}
          >
            {conversation ? "Reconnect" : "Attach"}
          </button>
          {#if showInterrupt}
            {@render interruptButton()}
          {/if}
        </div>
      </div>
    {/if}

    <div class="flex min-h-0 flex-1 flex-col px-4 pt-4">
      <div class="mb-3 flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.12em] text-muted">
        <div>{conversation?.running ? "Turn in progress" : "Ready"}</div>
        <div>{conversationLoading && !conversation ? `Connecting to ${agentLabel}` : agentLabel}</div>
      </div>

      <div bind:this={transcriptViewport} class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden pb-4 pr-1">
        {#if conversationLoading && !conversation}
          <div class="rounded-md border border-edge bg-topbar px-4 py-5 text-sm text-muted">
            Connecting to the {agentLabel} session...
          </div>
        {:else if !conversation || conversation.messages.length === 0}
          <div class="rounded-md border border-edge bg-topbar px-4 py-5 text-sm text-muted">
            No messages yet. Send the first prompt to start this chat.
          </div>
        {:else}
          {#each conversation.messages as message (message.id)}
            <div
              class={`max-w-[88%] min-w-0 rounded-2xl px-4 py-3 text-sm ${
                message.role === "user"
                  ? "self-end bg-accent text-white"
                  : "self-start border border-edge bg-topbar text-primary"
              }`}
            >
              <div class="whitespace-pre-wrap break-words">{message.text}</div>
              {#if message.status === "inProgress"}
                <div class="mt-2 text-[10px] uppercase tracking-[0.12em] text-muted">
                  typing
                </div>
              {/if}
            </div>
          {/each}
        {/if}
      </div>
    </div>

    <div
      class="border-t border-edge bg-topbar px-4 pb-4 pt-3"
      style="padding-bottom: max(1rem, env(safe-area-inset-bottom, 0px));"
    >
      <textarea
        id="conversation-composer"
        aria-label="Message"
        class="block min-h-[7rem] w-full max-w-full rounded-md border border-edge bg-surface px-3 py-2 text-sm text-primary outline-none transition focus:border-accent"
        placeholder="ask anything"
        value={composerText}
        oninput={handleComposerInput}
        onkeydown={handleComposerKeydown}
        disabled={isSending}
      ></textarea>

      <div class="mt-3 flex items-center justify-between gap-3">
        <div class="text-[11px] text-muted">
          {conversation?.running ? "Wait for the current turn to finish" : "Enter to send, Shift+Enter for newline"}
        </div>

        {#if showInterrupt && !conversationError}
          {@render interruptButton()}
        {:else}
          <button
            type="button"
            class="rounded-md border border-accent bg-accent px-4 py-2 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:border-edge disabled:bg-edge disabled:text-muted"
            onclick={onSend}
            disabled={!canSend}
          >
            {isSending ? "Sending..." : "Send"}
          </button>
        {/if}
      </div>
    </div>
  </section>
{/if}
