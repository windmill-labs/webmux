<script lang="ts">
  import { tick } from "svelte";
  import type { AgentsUiConversationMessage, AgentsUiConversationState, WorktreeInfo } from "./types";

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

  type TranscriptItem =
    | { type: "message"; key: string; message: AgentsUiConversationMessage }
    | {
      type: "tool";
      key: string;
      tool: AgentsUiConversationMessage;
      result: AgentsUiConversationMessage | null;
    };

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

  const agentLabel = $derived(worktree.agentLabel ?? (worktree.agentName === "claude" ? "Claude" : "Codex"));
  const supportsAgentChat = $derived(worktree.agentName === "codex" || worktree.agentName === "claude");
  const chatAvailable = $derived(supportsAgentChat && worktree.mux === "✓");
  const showInterrupt = $derived(chatAvailable && (conversation?.running ?? false));
  const showProcessingIndicator = $derived(
    (conversation?.running ?? false)
      && !(conversation?.messages.some((message) => message.status === "inProgress" && isVisibleTranscriptMessage(message)) ?? false),
  );
  const transcriptItems = $derived(buildTranscriptItems((conversation?.messages ?? []).filter(isVisibleTranscriptMessage)));
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

  function toolStatusLabel(message: AgentsUiConversationMessage): string {
    if (message.status === "inProgress") return "Running";
    if (message.status === "failed") return "Failed";
    return "Completed";
  }

  function exitCodeLabel(message: AgentsUiConversationMessage): string | null {
    return message.exitCode === null || message.exitCode === undefined ? null : `exit ${message.exitCode}`;
  }

  function formatDuration(durationMs: number | null | undefined): string | null {
    if (durationMs === null || durationMs === undefined) return null;
    if (durationMs < 1000) return `${durationMs}ms`;
    return `${(durationMs / 1000).toFixed(1)}s`;
  }

  function messageKind(message: AgentsUiConversationMessage): NonNullable<AgentsUiConversationMessage["kind"]> {
    return message.kind ?? "text";
  }

  function isVisibleTranscriptMessage(message: AgentsUiConversationMessage): boolean {
    const kind = messageKind(message);
    if ((kind === "text" || kind === "thinking") && message.text.trim().length === 0) {
      return false;
    }
    return true;
  }

  function buildTranscriptItems(messages: AgentsUiConversationMessage[]): TranscriptItem[] {
    const toolUseCallIds = new Set(
      messages
        .filter((message) => messageKind(message) === "toolUse" && message.toolCallId)
        .map((message) => message.toolCallId as string),
    );
    const resultByCallId = new Map<string, AgentsUiConversationMessage>();

    for (const message of messages) {
      if (messageKind(message) === "toolResult" && message.toolCallId && !resultByCallId.has(message.toolCallId)) {
        resultByCallId.set(message.toolCallId, message);
      }
    }

    return messages.flatMap((message): TranscriptItem[] => {
      const kind = messageKind(message);
      if (kind === "toolUse") {
        return [{
          type: "tool",
          key: message.id,
          tool: message,
          result: message.toolCallId ? resultByCallId.get(message.toolCallId) ?? null : null,
        }];
      }

      if (kind === "toolResult" && message.toolCallId && toolUseCallIds.has(message.toolCallId)) {
        return [];
      }

      return [{ type: "message", key: message.id, message }];
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

{#snippet processingIndicator()}
  <div class="self-start max-w-[88%] rounded-md border border-edge bg-topbar px-3 py-2 text-xs text-muted">
    {agentLabel} is processing
  </div>
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
        {:else if !conversation}
          <div class="rounded-md border border-edge bg-topbar px-4 py-5 text-sm text-muted">
            No messages yet. Send the first prompt to start this chat.
          </div>
        {:else if conversation.messages.length === 0}
          {#if showProcessingIndicator}
            {@render processingIndicator()}
          {:else}
            <div class="rounded-md border border-edge bg-topbar px-4 py-5 text-sm text-muted">
              No messages yet. Send the first prompt to start this chat.
            </div>
          {/if}
        {:else}
          {#each transcriptItems as item (item.key)}
            {#if item.type === "message" && messageKind(item.message) === "thinking"}
              {@const message = item.message}
              <div class="self-start max-w-[88%] min-w-0 rounded-md border border-edge bg-topbar/60 px-3 py-2 text-xs text-muted">
                <div class="mb-1 uppercase tracking-[0.12em]">Thinking</div>
                <div class="whitespace-pre-wrap break-words text-primary/85">{message.text}</div>
                {#if message.status === "inProgress"}
                  <div class="mt-2 uppercase tracking-[0.12em]">working</div>
                {/if}
              </div>
            {:else if item.type === "tool"}
              {@const message = item.tool}
              {@const result = item.result}
              <div class={`self-start max-w-[94%] min-w-0 rounded-md border px-3 py-2 text-xs ${
                message.status === "failed" || result?.status === "failed"
                  ? "border-danger/40 bg-danger/10 text-primary"
                  : "border-edge bg-topbar/70 text-primary"
              }`}>
                <div class="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] uppercase tracking-[0.12em] text-muted">
                  <span>{toolStatusLabel(message)} {message.toolName ?? "tool"}</span>
                  {#if exitCodeLabel(message)}
                    <span>{exitCodeLabel(message)}</span>
                  {/if}
                  {#if formatDuration(message.durationMs)}
                    <span>{formatDuration(message.durationMs)}</span>
                  {/if}
                </div>
                <div class="whitespace-pre-wrap break-words font-mono">{message.text}</div>
                {#if message.status === "inProgress"}
                  <div class="mt-2 text-[10px] uppercase tracking-[0.12em] text-muted">running</div>
                {/if}
                {#if result}
                  <details
                    class="mt-2 rounded-md border border-edge/80 bg-surface/60 px-2 py-1.5 text-primary"
                    open={result.status === "failed"}
                  >
                    <summary class="cursor-pointer text-[10px] uppercase tracking-[0.12em] text-muted">
                      Output
                    </summary>
                    <pre class="mt-2 max-h-[18rem] overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">{result.text}</pre>
                  </details>
                {/if}
              </div>
            {:else}
              {@const message = item.message}
              <div
                class={`max-w-[88%] min-w-0 rounded-2xl px-4 py-3 text-sm ${
                  message.role === "user"
                    ? "self-end bg-accent text-white"
                    : "self-start border border-edge bg-topbar text-primary"
                }`}
              >
                <div class="whitespace-pre-wrap break-words">{message.text}</div>
              </div>
            {/if}
          {/each}
          {#if showProcessingIndicator}
            {@render processingIndicator()}
          {/if}
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
