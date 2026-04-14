<script lang="ts">
  import { tick } from "svelte";
  import type { AgentsUiConversationState, AgentsUiWorktreeSummary } from "../types";

  interface Props {
    worktree: AgentsUiWorktreeSummary;
    conversation: AgentsUiConversationState | null;
    conversationError: string | null;
    conversationLoading: boolean;
    composerText: string;
    isSending: boolean;
    onAttach: () => void;
    onBack: () => void;
    onComposerInput: (value: string) => void;
    onInterrupt: () => void;
    onRefresh: () => void;
    onSend: () => void;
    showBackButton: boolean;
  }

  const {
    worktree,
    conversation,
    conversationError,
    conversationLoading,
    composerText,
    isSending,
    onAttach,
    onBack,
    onComposerInput,
    onInterrupt,
    onRefresh,
    onSend,
    showBackButton,
  }: Props = $props();

  const canSend = $derived(
    worktree.agentName === "codex"
      && conversation !== null
      && !conversationLoading
      && composerText.trim().length > 0
      && !isSending
      && !(conversation?.running ?? false),
  );

  let transcriptViewport = $state<HTMLDivElement | null>(null);

  function formatTimestamp(value: string | null): string {
    if (!value) return "Pending";
    const timestamp = new Date(value);
    return timestamp.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function handleComposerInput(event: Event): void {
    const target = event.currentTarget;
    if (!(target instanceof HTMLTextAreaElement)) return;
    onComposerInput(target.value);
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

{#if worktree.agentName !== "codex"}
  <article class="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-[1.4rem] border border-[var(--color-line)] bg-[var(--color-paper)] p-4">
    <div class="flex items-center gap-3">
      {#if showBackButton}
        <button
          class="rounded-full border border-[var(--color-line)] bg-[var(--color-panel)] px-3 py-2 text-sm font-medium transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] md:hidden"
          onclick={onBack}
        >
          Back
        </button>
      {/if}

      <div>
        <div class="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-muted)]">Chat</div>
        <h2 class="mt-1 text-lg font-semibold">{worktree.branch}</h2>
      </div>
    </div>

    <div class="mt-4 rounded-[1.1rem] border border-dashed border-[var(--color-line)] bg-[var(--color-panel)] px-4 py-5 text-sm text-[var(--color-muted)]">
      Chat is not available for this worktree yet.
    </div>
  </article>
{:else}
  <article class="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-[1.4rem] border border-[var(--color-line)] bg-[var(--color-paper)]">
    <div class="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-line)] px-4 py-4">
      <div class="flex min-w-0 items-center gap-3">
        {#if showBackButton}
          <button
            class="rounded-full border border-[var(--color-line)] bg-[var(--color-panel)] px-3 py-2 text-sm font-medium transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] md:hidden"
            onclick={onBack}
          >
            Back
          </button>
        {/if}

        <div class="min-w-0">
          <div class="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-muted)]">Chat</div>
          <h2 class="mt-1 truncate text-lg font-semibold">{worktree.branch}</h2>
        </div>
      </div>

      <div class="flex min-w-0 flex-wrap items-center gap-2">
        {#if conversation?.running}
          <button
            class="rounded-full border border-[var(--color-accent)] bg-[var(--color-accent-soft)] px-4 py-2 text-sm font-medium text-[var(--color-ink)] transition hover:border-[var(--color-accent)]"
            onclick={onInterrupt}
          >
            Interrupt
          </button>
        {:else if conversationError || !conversation}
          <button
            class="rounded-full border border-[var(--color-line)] bg-[var(--color-panel)] px-4 py-2 text-sm font-medium transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
            onclick={conversation ? onRefresh : onAttach}
            disabled={conversationLoading || isSending}
          >
            {conversation ? "Reconnect" : "Attach"}
          </button>
        {/if}
      </div>
    </div>

    {#if conversationError}
      <div class="mx-4 mt-4 rounded-[1.1rem] border border-[var(--color-accent)]/30 bg-[var(--color-accent-soft)] px-4 py-3 text-sm text-[var(--color-ink)]">
        {conversationError}
      </div>
    {/if}

    <div class="flex min-h-0 min-w-0 flex-1 flex-col px-4 pb-4 pt-4">
      <div class="mb-3 flex items-center justify-between gap-3 text-xs uppercase tracking-[0.16em] text-[var(--color-muted)]">
        <div>{conversation?.running ? "Turn in progress" : "Ready"}</div>
        <div>{conversationLoading && !conversation ? "Connecting" : "Live"}</div>
      </div>

      <div bind:this={transcriptViewport} class="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden pr-1">
        {#if conversationLoading && !conversation}
          <div class="rounded-[1.1rem] border border-dashed border-[var(--color-line)] bg-[var(--color-panel)] px-4 py-5 text-sm text-[var(--color-muted)]">
            Connecting to the Codex thread…
          </div>
        {:else if !conversation || conversation.messages.length === 0}
          <div class="rounded-[1.1rem] border border-dashed border-[var(--color-line)] bg-[var(--color-panel)] px-4 py-5 text-sm text-[var(--color-muted)]">
            No messages yet. Send the first prompt to start this chat.
          </div>
        {:else}
          {#each conversation.messages as message (message.id)}
            <div
              class={`max-w-[88%] min-w-0 rounded-[1.2rem] px-4 py-3 text-sm ${
                message.role === "user"
                  ? "self-end bg-[var(--color-accent)] text-[var(--color-paper)]"
                  : "self-start border border-[var(--color-line)] bg-[var(--color-panel)] text-[var(--color-ink)]"
              }`}
            >
              <div class="min-w-0 whitespace-pre-wrap break-words">{message.text}</div>
              <div
                class={`mt-2 text-[0.7rem] uppercase tracking-[0.14em] ${
                  message.role === "user" ? "text-[var(--color-paper)]/75" : "text-[var(--color-muted)]"
                }`}
              >
                {message.role} · {formatTimestamp(message.createdAt)}{message.status === "inProgress" ? " · typing" : ""}
              </div>
            </div>
          {/each}
        {/if}
      </div>

      <div class="mt-4 border-t border-[var(--color-line)] pt-4">
        <label class="text-sm font-medium" for="conversation-composer">Message</label>
        <textarea
          id="conversation-composer"
          class="mt-3 block min-h-[8rem] w-full max-w-full rounded-[1.1rem] border border-[var(--color-line)] bg-[var(--color-panel)] px-4 py-3 text-sm text-[var(--color-ink)] outline-none transition focus:border-[var(--color-accent)]"
          placeholder="Ask Codex to inspect or modify this worktree…"
          value={composerText}
          oninput={handleComposerInput}
          disabled={isSending}
        ></textarea>

        <div class="mt-3 flex items-center justify-between gap-3">
          <div class="text-xs uppercase tracking-[0.16em] text-[var(--color-muted)]">
            {conversation?.running ? "Wait for the current turn" : "Ready to send"}
          </div>

          <button
            class="rounded-full border border-[var(--color-accent)] bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-paper)] transition disabled:cursor-not-allowed disabled:border-[var(--color-line)] disabled:bg-[var(--color-line)] disabled:text-[var(--color-muted)]"
            onclick={onSend}
            disabled={!canSend}
          >
            {isSending ? "Sending..." : "Send"}
          </button>
        </div>
      </div>
    </div>
  </article>
{/if}
