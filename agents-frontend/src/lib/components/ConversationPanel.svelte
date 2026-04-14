<script lang="ts">
  import type { AgentsUiConversationState, AgentsUiWorktreeSummary } from "../types";

  interface Props {
    worktree: AgentsUiWorktreeSummary;
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

  const canSend = $derived(
    worktree.agentName === "codex"
      && conversation !== null
      && !conversationLoading
      && composerText.trim().length > 0
      && !isSending
      && !(conversation?.running ?? false),
  );

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
</script>

{#if worktree.agentName !== "codex"}
  <article class="rounded-[1.6rem] border border-[var(--color-line)] bg-[var(--color-paper)] p-4">
    <div class="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-muted)]">Conversation lane</div>
    <p class="mt-4 max-w-xl text-sm text-[var(--color-muted)]">
      This worktree is not backed by Codex yet, so the non-terminal conversation lane is unavailable.
    </p>
  </article>
{:else}
  <article class="rounded-[1.6rem] border border-[var(--color-line)] bg-[var(--color-paper)] p-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <div class="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-muted)]">Conversation lane</div>
        <div class="mt-1 text-sm text-[var(--color-muted)]">
          {conversation?.threadId ?? worktree.conversation?.threadId ?? "Unattached"}
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <button
          class="rounded-full border border-[var(--color-line)] bg-[var(--color-panel)] px-4 py-2 text-sm font-medium transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
          onclick={onRefresh}
          disabled={conversationLoading || isSending}
        >
          Refresh
        </button>

        {#if conversation?.running}
          <button
            class="rounded-full border border-[var(--color-accent)] bg-[var(--color-accent-soft)] px-4 py-2 text-sm font-medium text-[var(--color-ink)] transition hover:border-[var(--color-accent)]"
            onclick={onInterrupt}
          >
            Interrupt
          </button>
        {:else}
          <button
            class="rounded-full border border-[var(--color-line)] bg-[var(--color-paper)] px-4 py-2 text-sm font-medium transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
            onclick={onAttach}
            disabled={conversationLoading || isSending}
          >
            {conversation ? "Reattach" : "Attach"}
          </button>
        {/if}
      </div>
    </div>

    {#if conversationError}
      <div class="mt-4 rounded-[1.2rem] border border-[var(--color-accent)]/30 bg-[var(--color-accent-soft)] px-4 py-3 text-sm text-[var(--color-ink)]">
        {conversationError}
      </div>
    {/if}

    <div class="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div class="rounded-[1.3rem] border border-[var(--color-line)] bg-[var(--color-panel)] p-3">
        <div class="mb-3 flex items-center justify-between gap-3">
          <div class="text-sm font-medium">Transcript</div>
          <div class="text-xs uppercase tracking-[0.16em] text-[var(--color-muted)]">
            {conversation?.running ? "Running" : "Idle"}
          </div>
        </div>

        <div class="flex max-h-[30rem] min-h-[18rem] flex-col gap-3 overflow-y-auto pr-1">
          {#if conversationLoading && !conversation}
            <div class="rounded-[1.1rem] border border-dashed border-[var(--color-line)] bg-[var(--color-paper)] px-4 py-5 text-sm text-[var(--color-muted)]">
              Connecting to the Codex thread…
            </div>
          {:else if !conversation || conversation.messages.length === 0}
            <div class="rounded-[1.1rem] border border-dashed border-[var(--color-line)] bg-[var(--color-paper)] px-4 py-5 text-sm text-[var(--color-muted)]">
              No messages yet. Attach the worktree, then send the first prompt from this panel.
            </div>
          {:else}
            {#each conversation.messages as message (message.id)}
              <div
                class={`max-w-[85%] rounded-[1.25rem] px-4 py-3 text-sm ${
                  message.role === "user"
                    ? "self-end bg-[var(--color-accent)] text-[var(--color-paper)]"
                    : "self-start border border-[var(--color-line)] bg-[var(--color-paper)] text-[var(--color-ink)]"
                }`}
              >
                <div class="whitespace-pre-wrap break-words">{message.text}</div>
                <div
                  class={`mt-2 text-[0.7rem] uppercase tracking-[0.14em] ${
                    message.role === "user" ? "text-[var(--color-paper)]/75" : "text-[var(--color-muted)]"
                  }`}
                >
                  {message.role} / {formatTimestamp(message.createdAt)} / {message.status}
                </div>
              </div>
            {/each}
          {/if}
        </div>
      </div>

      <div class="flex flex-col gap-4">
        <div class="rounded-[1.3rem] border border-[var(--color-line)] bg-[var(--color-panel)] px-4 py-4 text-sm">
          <div class="font-medium">Session</div>
          <div class="mt-3 space-y-3 text-[var(--color-muted)]">
            <div>
              <div class="font-medium text-[var(--color-ink)]">Provider</div>
              <div>{conversation?.provider ?? worktree.conversation?.provider ?? "codexAppServer"}</div>
            </div>
            <div>
              <div class="font-medium text-[var(--color-ink)]">Active turn</div>
              <div class="break-all">{conversation?.activeTurnId ?? "None"}</div>
            </div>
            <div>
              <div class="font-medium text-[var(--color-ink)]">cwd</div>
              <div class="break-all">{conversation?.cwd ?? worktree.path}</div>
            </div>
          </div>
        </div>

        <div class="rounded-[1.3rem] border border-[var(--color-line)] bg-[var(--color-panel)] p-4">
          <label class="text-sm font-medium" for="conversation-composer">Message</label>
          <textarea
            id="conversation-composer"
            class="mt-3 min-h-[10rem] w-full rounded-[1.1rem] border border-[var(--color-line)] bg-[var(--color-paper)] px-4 py-3 text-sm text-[var(--color-ink)] outline-none transition focus:border-[var(--color-accent)]"
            placeholder="Ask Codex to inspect or modify the selected worktree…"
            value={composerText}
            oninput={handleComposerInput}
            disabled={isSending}
          ></textarea>

          <div class="mt-3 flex items-center justify-between gap-3">
            <div class="text-xs uppercase tracking-[0.16em] text-[var(--color-muted)]">
              {conversation?.running ? "Turn in progress" : "Ready"}
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
    </div>
  </article>
{/if}
