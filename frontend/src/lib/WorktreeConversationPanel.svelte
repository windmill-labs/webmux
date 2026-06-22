<script lang="ts">
  import { tick } from "svelte";
  import AskUserQuestionCard from "./AskUserQuestionCard.svelte";
  import { ASK_USER_QUESTION_TOOL_NAME, parseAskUserQuestion } from "./ask-user-question";
  import type {
    AgentsUiConversationMessage,
    AgentsUiConversationState,
    AskUserQuestionInput,
    WorktreeInfo,
  } from "./types";

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
    onAnswerQuestion: (text: string) => void;
  }

  type TranscriptItem =
    | { type: "message"; key: string; message: AgentsUiConversationMessage }
    | {
      type: "question";
      key: string;
      tool: AgentsUiConversationMessage;
      input: AskUserQuestionInput;
      answered: boolean;
    }
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
    onAnswerQuestion,
  }: Props = $props();

  const agentLabel = $derived(worktree.agentLabel ?? (worktree.agentName === "claude" ? "Claude" : "Codex"));
  const supportsAgentChat = $derived(worktree.agentName === "codex" || worktree.agentName === "claude");
  const chatAvailable = $derived(supportsAgentChat && worktree.mux === "✓");
  const showInterrupt = $derived(chatAvailable && (conversation?.running ?? false));
  const showComposerInterrupt = $derived(showInterrupt && !conversationError);
  const showProcessingIndicator = $derived(isSending || showComposerInterrupt);
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

  function showToolInputFade(text: string): boolean {
    return text.split("\n").length > 2 || text.length > 160;
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
        if (message.toolName === ASK_USER_QUESTION_TOOL_NAME) {
          const input = parseAskUserQuestion(message.text);
          if (input) {
            const answered = messages.some((other) =>
              other.role === "user" && messageKind(other) === "text" && other.order > message.order
            );
            return [{ type: "question", key: message.id, tool: message, input, answered }];
          }
        }
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

{#snippet sendIcon()}
  <svg
    aria-hidden="true"
    xmlns="http://www.w3.org/2000/svg"
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="m9 10-4 4 4 4" />
    <path d="M5 14h11a4 4 0 0 0 4-4V6" />
  </svg>
{/snippet}

{#snippet stopIcon()}
  <svg
    aria-hidden="true"
    xmlns="http://www.w3.org/2000/svg"
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2.5"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <rect x="7" y="7" width="10" height="10" rx="1.5" />
  </svg>
{/snippet}

{#snippet processingIndicator()}
  <div class="flex max-w-[88%] items-center gap-2 self-start rounded-md border border-edge bg-topbar px-3 py-2 text-xs text-muted">
    <span class="spinner"></span>
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
            {:else if item.type === "question"}
              <AskUserQuestionCard
                input={item.input}
                disabled={item.answered}
                onSubmit={onAnswerQuestion}
              />
            {:else if item.type === "tool"}
              {@const message = item.tool}
              {@const result = item.result}
              <details
                class={`group self-start max-w-[94%] min-w-0 rounded-md border text-xs ${
                  message.status === "failed" || result?.status === "failed"
                    ? "border-danger/30 bg-danger/10 text-primary"
                    : "border-edge/70 bg-topbar/40 text-primary"
                }`}
                open={message.status === "failed" || result?.status === "failed"}
              >
                <summary class="cursor-pointer px-3 py-2 text-muted">
                  <div class="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] uppercase tracking-[0.12em]">
                    <span>{toolStatusLabel(message)} {message.toolName ?? "tool"}</span>
                    {#if exitCodeLabel(message)}
                      <span>{exitCodeLabel(message)}</span>
                    {/if}
                    {#if formatDuration(message.durationMs)}
                      <span>{formatDuration(message.durationMs)}</span>
                    {/if}
                  </div>
                  <div class="group-open:hidden relative mt-1 max-h-[2.05rem] overflow-hidden">
                    <pre class="whitespace-pre-wrap break-words font-mono text-[11px] leading-[1.35] text-primary/75">{message.text}</pre>
                    {#if showToolInputFade(message.text)}
                      <div class="pointer-events-none absolute inset-x-0 bottom-0 h-5 bg-gradient-to-b from-transparent to-topbar"></div>
                    {/if}
                  </div>
                </summary>

                <div class="border-t border-edge/60 px-3 py-2">
                  <pre class="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-primary">{message.text}</pre>
                  {#if message.status === "inProgress"}
                    <div class="mt-2 text-[10px] uppercase tracking-[0.12em] text-muted">running</div>
                  {/if}
                  {#if result}
                    <div class="mt-3 border-t border-edge/60 pt-2">
                      <div class="mb-1 text-[10px] uppercase tracking-[0.12em] text-muted">Output</div>
                      <pre class="max-h-[18rem] overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-primary">{result.text}</pre>
                    </div>
                  {/if}
                </div>
              </details>
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
      class="border-t border-edge bg-topbar px-4 pb-4 pt-4"
      style="padding-bottom: max(1rem, env(safe-area-inset-bottom, 0px));"
    >
      <div class="relative">
        <textarea
          id="conversation-composer"
          aria-label="Message"
          class="block min-h-[5.25rem] w-full max-w-full resize-none rounded-2xl border border-edge bg-surface py-3 pl-4 pr-14 text-sm text-primary outline-none transition placeholder:text-muted/70 focus:border-accent"
          placeholder="ask anything"
          value={composerText}
          oninput={handleComposerInput}
          onkeydown={handleComposerKeydown}
          disabled={isSending}
        ></textarea>

        {#if showComposerInterrupt}
          <button
            type="button"
            aria-label="Interrupt"
            class="absolute right-3 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted transition hover:bg-hover hover:text-primary"
            onclick={onInterrupt}
          >
            {@render stopIcon()}
          </button>
        {:else}
          <button
            type="button"
            aria-label="Send"
            class="absolute right-3 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted transition enabled:hover:bg-hover enabled:hover:text-primary disabled:cursor-not-allowed disabled:opacity-45"
            onclick={onSend}
            disabled={!canSend}
          >
            {@render sendIcon()}
          </button>
        {/if}
      </div>
    </div>
  </section>
{/if}
