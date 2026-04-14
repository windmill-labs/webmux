<script lang="ts">
  import ConversationPanel from "./lib/components/ConversationPanel.svelte";
  import {
    attachWorktreeConversation,
    connectWorktreeConversationStream,
    fetchBootstrap,
    fetchWorktreeConversationHistory,
    interruptWorktreeConversation,
    sendWorktreeConversationMessage,
  } from "./lib/api";
  import { applyConversationMessageDelta, markConversationTurnStarted } from "./lib/conversation";
  import type {
    AgentsUiBootstrapResponse,
    AgentsUiConversationEvent,
    AgentsUiConversationState,
    AgentsUiWorktreeConversationResponse,
    AgentsUiWorktreeSummary,
  } from "./lib/types";

  let bootstrap = $state<AgentsUiBootstrapResponse | null>(null);
  let errorMessage = $state<string | null>(null);
  let isLoading = $state(true);
  let selectedBranch = $state<string | null>(null);
  let conversation = $state<AgentsUiConversationState | null>(null);
  let conversationError = $state<string | null>(null);
  let conversationLoading = $state(false);
  let composerText = $state("");
  let isSending = $state(false);
  let hasRequestedBootstrap = false;
  let attachedBranch = $state<string | null>(null);
  let conversationRequestToken = 0;
  let mobileListOpen = $state(true);
  let streamConnection: {
    branch: string;
    conversationId: string;
    disconnect: () => void;
  } | null = null;

  const selectedWorktree = $derived(
    bootstrap?.worktrees.find((worktree) => worktree.branch === selectedBranch) ?? null,
  );
  const listedWorktrees = $derived(bootstrap?.worktrees ?? []);

  function updateWorktreeSummary(nextWorktree: AgentsUiWorktreeSummary): void {
    if (!bootstrap) return;

    bootstrap = {
      ...bootstrap,
      worktrees: bootstrap.worktrees.map((worktree) =>
        worktree.branch === nextWorktree.branch ? nextWorktree : worktree
      ),
    };
  }

  function applyConversationResponse(response: AgentsUiWorktreeConversationResponse): void {
    updateWorktreeSummary(response.worktree);
    conversation = response.conversation;
    attachedBranch = response.worktree.branch;
    syncConversationStream();
  }

  function resetConversation(branch: string | null): void {
    closeConversationStream();
    attachedBranch = branch;
    conversation = null;
    conversationError = null;
    composerText = "";
  }

  function closeConversationStream(): void {
    streamConnection?.disconnect();
    streamConnection = null;
  }

  function hasActiveConversationStream(branch: string, conversationId: string): boolean {
    return streamConnection?.branch === branch && streamConnection.conversationId === conversationId;
  }

  function handleConversationStreamFailure(branch: string, conversationId: string, message: string): void {
    if (!hasActiveConversationStream(branch, conversationId) || !streamConnection) return;
    const currentConnection = streamConnection;
    streamConnection = null;
    currentConnection.disconnect();
    conversationError = message;
  }

  function handleConversationStreamEvent(branch: string, conversationId: string, event: AgentsUiConversationEvent): void {
    if (!hasActiveConversationStream(branch, conversationId)) return;

    switch (event.type) {
      case "snapshot":
        conversationError = null;
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
    if (selectedWorktree?.agentName !== "codex") {
      closeConversationStream();
      return;
    }

    const branch = selectedWorktree.branch;
    const conversationId = conversation?.conversationId ?? selectedWorktree.conversation?.conversationId ?? null;
    if (!conversationId) {
      closeConversationStream();
      return;
    }

    if (hasActiveConversationStream(branch, conversationId)) {
      return;
    }

    closeConversationStream();
    const disconnect = connectWorktreeConversationStream(branch, {
      onEvent: (event) => {
        handleConversationStreamEvent(branch, conversationId, event);
      },
      onError: (message) => {
        handleConversationStreamFailure(branch, conversationId, message);
      },
      onClose: () => {
        handleConversationStreamFailure(branch, conversationId, "Agents stream disconnected");
      },
    });
    streamConnection = { branch, conversationId, disconnect };
  }

  async function loadBootstrap(): Promise<void> {
    isLoading = true;
    errorMessage = null;

    try {
      const nextBootstrap = await fetchBootstrap();
      bootstrap = nextBootstrap;

      if (!selectedBranch || !nextBootstrap.worktrees.some((worktree) => worktree.branch === selectedBranch)) {
        const nextBranch = nextBootstrap.worktrees[0]?.branch ?? null;
        if (nextBranch !== selectedBranch) {
          selectedBranch = nextBranch;
          resetConversation(null);
        }
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    } finally {
      isLoading = false;
    }
  }

  async function loadConversation(branch: string, mode: "attach" | "history"): Promise<void> {
    const requestToken = conversationRequestToken + 1;
    conversationRequestToken = requestToken;
    conversationLoading = true;
    conversationError = null;

    try {
      const response = mode === "attach"
        ? await attachWorktreeConversation(branch)
        : await fetchWorktreeConversationHistory(branch);

      if (selectedBranch !== branch || conversationRequestToken !== requestToken) {
        return;
      }

      applyConversationResponse(response);
    } catch (error) {
      if (selectedBranch !== branch || conversationRequestToken !== requestToken) {
        return;
      }

      conversationError = error instanceof Error ? error.message : String(error);
    } finally {
      if (conversationRequestToken === requestToken) {
        conversationLoading = false;
      }
    }
  }

  function selectWorktree(branch: string): void {
    if (branch !== selectedBranch) {
      selectedBranch = branch;
      resetConversation(null);
    }
    mobileListOpen = false;
  }

  function showWorktreeList(): void {
    mobileListOpen = true;
  }

  function describeWorktree(worktree: AgentsUiWorktreeSummary): string {
    if (worktree.creating && worktree.creationPhase) return `Creating: ${worktree.creationPhase}`;
    if (worktree.agentName === "codex" && worktree.conversation) return "Chat ready";
    if (worktree.agentName === "codex") return "Attach on open";
    return "Terminal only";
  }

  async function refreshSelectedConversation(): Promise<void> {
    if (!selectedWorktree || selectedWorktree.agentName !== "codex") return;
    const mode = conversation || selectedWorktree.conversation ? "history" : "attach";
    await loadConversation(selectedWorktree.branch, mode);
  }

  async function sendSelectedConversationMessage(): Promise<void> {
    if (!selectedWorktree || selectedWorktree.agentName !== "codex") return;
    const text = composerText.trim();
    if (text.length === 0) return;

    isSending = true;
    conversationError = null;
    try {
      const response = await sendWorktreeConversationMessage(selectedWorktree.branch, { text });
      composerText = "";
      conversation = markConversationTurnStarted(conversation, response.turnId, text);
      syncConversationStream();
    } catch (error) {
      conversationError = error instanceof Error ? error.message : String(error);
    } finally {
      isSending = false;
    }
  }

  async function interruptSelectedConversation(): Promise<void> {
    if (!selectedWorktree || selectedWorktree.agentName !== "codex") return;

    conversationError = null;
    try {
      await interruptWorktreeConversation(selectedWorktree.branch);
    } catch (error) {
      conversationError = error instanceof Error ? error.message : String(error);
    }
  }

  $effect(() => {
    if (hasRequestedBootstrap) return;
    hasRequestedBootstrap = true;
    void loadBootstrap();
  });

  $effect(() => {
    const worktree = selectedWorktree;
    if (!worktree || worktree.agentName !== "codex") return;
    if (attachedBranch === worktree.branch) return;
    void loadConversation(worktree.branch, "attach");
  });

  $effect(() => {
    return () => {
      closeConversationStream();
    };
  });
</script>

<svelte:head>
  <title>Webmux Worktree Chat</title>
</svelte:head>

<div class="h-[100dvh] overflow-hidden text-[var(--color-ink)]">
  <div class="mx-auto flex h-full min-h-0 max-w-[84rem] flex-col px-3 py-3 md:px-5 md:py-5">
    <header class="mb-3 rounded-[1.6rem] border border-[var(--color-line)] bg-[var(--color-panel)]/92 px-4 py-4 shadow-[0_12px_40px_rgba(66,40,18,0.08)] backdrop-blur md:mb-4 md:px-5">
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0">
          <div class="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-[var(--color-muted)]">
            {bootstrap?.project.name ?? "Project"}
          </div>
          <h1 class="mt-1 font-serif text-2xl leading-none md:text-4xl">Worktree Chat</h1>
        </div>

        <button
          class="rounded-full border border-[var(--color-line)] bg-[var(--color-paper)] px-4 py-2 text-sm font-medium transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
          onclick={() => void loadBootstrap()}
          disabled={isLoading}
        >
          {isLoading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {#if errorMessage}
        <div class="mt-3 rounded-[1.1rem] border border-[var(--color-accent)]/30 bg-[var(--color-accent-soft)] px-4 py-3 text-sm text-[var(--color-ink)]">
          {errorMessage}
        </div>
      {/if}
    </header>

    <main class="grid min-h-0 flex-1 gap-3 md:grid-cols-[20rem_minmax(0,1fr)] md:gap-4">
      <section class={`${mobileListOpen ? "flex" : "hidden"} min-h-0 min-w-0 flex-col overflow-hidden rounded-[1.6rem] border border-[var(--color-line)] bg-[var(--color-panel)]/95 p-3 shadow-[0_12px_40px_rgba(66,40,18,0.06)] md:flex md:p-4`}>
        <div class="mb-3 flex items-center justify-between gap-3">
          <div class="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-muted)]">Worktrees</div>
          <div class="text-sm text-[var(--color-muted)]">{listedWorktrees.length}</div>
        </div>

        {#if !bootstrap}
          <div class="rounded-[1.1rem] border border-dashed border-[var(--color-line)] bg-[var(--color-paper)] px-4 py-6 text-sm text-[var(--color-muted)]">
            Loading worktrees…
          </div>
        {:else if listedWorktrees.length === 0}
          <div class="rounded-[1.1rem] border border-dashed border-[var(--color-line)] bg-[var(--color-paper)] px-4 py-6 text-sm text-[var(--color-muted)]">
            No worktrees found.
          </div>
        {:else}
          <div class="min-h-0 space-y-2 overflow-y-auto pr-1">
            {#each listedWorktrees as worktree (worktree.branch)}
              <button
                class={`block w-full rounded-[1.2rem] border px-4 py-4 text-left transition ${
                  selectedBranch === worktree.branch
                    ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]/55"
                    : "border-[var(--color-line)] bg-[var(--color-paper)] hover:border-[var(--color-accent)]/40"
                }`}
                onclick={() => selectWorktree(worktree.branch)}
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="truncate text-sm font-semibold">{worktree.branch}</div>
                    <div class="mt-1 text-xs uppercase tracking-[0.16em] text-[var(--color-muted)]">
                      {worktree.agentName ?? "unassigned"}
                    </div>
                  </div>
                  <span class="rounded-full border border-[var(--color-line)] px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-[var(--color-muted)]">
                    {worktree.status}
                  </span>
                </div>
                <p class="mt-2 text-sm text-[var(--color-muted)]">{describeWorktree(worktree)}</p>
              </button>
            {/each}
          </div>
        {/if}
      </section>

      <section class={`${mobileListOpen ? "hidden" : "block"} min-h-0 min-w-0 overflow-hidden rounded-[1.6rem] border border-[var(--color-line)] bg-[var(--color-panel)]/95 p-3 shadow-[0_12px_40px_rgba(66,40,18,0.06)] md:block md:p-4`}>
        {#if selectedWorktree}
          <ConversationPanel
            worktree={selectedWorktree}
            conversation={conversation}
            conversationError={conversationError}
            conversationLoading={conversationLoading}
            composerText={composerText}
            isSending={isSending}
            showBackButton={mobileListOpen === false}
            onAttach={() => void loadConversation(selectedWorktree.branch, "attach")}
            onBack={showWorktreeList}
            onComposerInput={(value) => {
              composerText = value;
            }}
            onInterrupt={() => void interruptSelectedConversation()}
            onRefresh={() => void refreshSelectedConversation()}
            onSend={() => void sendSelectedConversationMessage()}
          />
        {:else}
          <div class="flex h-full min-h-[24rem] items-center justify-center rounded-[1.4rem] border border-dashed border-[var(--color-line)] bg-[var(--color-paper)] p-6 text-center text-[var(--color-muted)]">
            Select a worktree to open chat.
          </div>
        {/if}
      </section>
    </main>
  </div>
</div>
