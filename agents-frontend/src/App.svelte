<script lang="ts">
  import { onMount } from "svelte";
  import ConversationPanel from "./lib/components/ConversationPanel.svelte";
  import AgentsSidebar from "./lib/components/AgentsSidebar.svelte";
  import AgentsTopBar from "./lib/components/AgentsTopBar.svelte";
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
  let searchQuery = $state("");
  let isMobile = $state(false);
  let sidebarOpen = $state(false);
  let refreshPollingBranch = $state<string | null>(null);
  let refreshPollingToken = 0;
  let streamConnection: {
    branch: string;
    conversationId: string;
    disconnect: () => void;
  } | null = null;

  function isChatWorktree(worktree: AgentsUiWorktreeSummary | null): worktree is AgentsUiWorktreeSummary {
    return (worktree?.agentName === "codex" || worktree?.agentName === "claude") && worktree.mux;
  }

  function matchesWorktreeSearch(worktree: AgentsUiWorktreeSummary, query: string): boolean {
    const trimmedQuery = query.trim().toLowerCase();
    if (trimmedQuery.length === 0) return true;

    return [
      worktree.branch,
      worktree.agentName ?? "",
      worktree.status,
      worktree.profile ?? "",
    ].some((value) => value.toLowerCase().includes(trimmedQuery));
  }

  const selectedWorktree = $derived(
    bootstrap?.worktrees.find((worktree) => worktree.branch === selectedBranch) ?? null,
  );
  const listedWorktrees = $derived(bootstrap?.worktrees ?? []);
  const filteredWorktrees = $derived(
    listedWorktrees.filter((worktree) => matchesWorktreeSearch(worktree, searchQuery)),
  );

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
    refreshPollingBranch = null;
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
    if (!isChatWorktree(selectedWorktree)) {
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
    if (isMobile) {
      sidebarOpen = false;
    }
  }

  function describeEmptyState(): string {
    if (!bootstrap) return "Loading worktrees…";
    if (searchQuery.trim().length > 0) return "No worktrees match that search.";
    return "No worktrees found.";
  }

  async function refreshSelectedConversation(): Promise<void> {
    if (!isChatWorktree(selectedWorktree)) return;
    const mode = conversation || selectedWorktree.conversation ? "history" : "attach";
    await loadConversation(selectedWorktree.branch, mode);
  }

  async function sendSelectedConversationMessage(): Promise<void> {
    if (!isChatWorktree(selectedWorktree) || !conversation) return;
    const text = composerText.trim();
    if (text.length === 0) return;

    isSending = true;
    conversationError = null;
    try {
      const response = await sendWorktreeConversationMessage(selectedWorktree.branch, { text });
      composerText = "";
      if (conversation.conversationId !== response.conversationId) {
        conversation = {
          ...conversation,
          conversationId: response.conversationId,
        };
      }
      conversation = markConversationTurnStarted(conversation, response.turnId, text);
      syncConversationStream();
      startRefreshPolling(selectedWorktree.branch);
    } catch (error) {
      conversationError = error instanceof Error ? error.message : String(error);
    } finally {
      isSending = false;
    }
  }

  async function interruptSelectedConversation(): Promise<void> {
    if (!isChatWorktree(selectedWorktree)) return;

    conversationError = null;
    try {
      await interruptWorktreeConversation(selectedWorktree.branch);
      startRefreshPolling(selectedWorktree.branch);
    } catch (error) {
      conversationError = error instanceof Error ? error.message : String(error);
    }
  }

  function startRefreshPolling(branch: string): void {
    refreshPollingBranch = branch;
    refreshPollingToken += 1;
  }

  async function handleTopBarPrimaryAction(): Promise<void> {
    if (!isChatWorktree(selectedWorktree)) return;

    if (conversation?.running) {
      await interruptSelectedConversation();
      return;
    }

    if (conversation || conversationError) {
      await refreshSelectedConversation();
      return;
    }

    await loadConversation(selectedWorktree.branch, "attach");
  }

  $effect(() => {
    if (hasRequestedBootstrap) return;
    hasRequestedBootstrap = true;
    void loadBootstrap();
  });

  $effect(() => {
    const worktree = selectedWorktree;
    if (!isChatWorktree(worktree)) return;
    if (attachedBranch === worktree.branch) return;
    void loadConversation(worktree.branch, "attach");
  });

  $effect(() => {
    const branch = refreshPollingBranch;
    const token = refreshPollingToken;
    if (!branch || token === 0) return;

    let refreshCount = 0;
    const interval = window.setInterval(() => {
      if (refreshPollingBranch !== branch || refreshPollingToken !== token) return;
      refreshCount += 1;
      void loadConversation(branch, "history");
      if (refreshCount >= 30) {
        refreshPollingBranch = null;
      }
    }, 1000);

    return () => {
      window.clearInterval(interval);
    };
  });

  $effect(() => {
    return () => {
      closeConversationStream();
    };
  });

  onMount(() => {
    const mediaQuery = window.matchMedia("(max-width: 768px)");
    isMobile = mediaQuery.matches;
    sidebarOpen = mediaQuery.matches;

    function handleChange(event: MediaQueryListEvent): void {
      isMobile = event.matches;
      if (event.matches) {
        sidebarOpen = true;
      }
    }

    mediaQuery.addEventListener("change", handleChange);
    return () => {
      mediaQuery.removeEventListener("change", handleChange);
    };
  });
</script>

<svelte:head>
  <title>Webmux Worktree Chat</title>
</svelte:head>

<div class="flex h-dvh bg-surface text-primary">
  {#if !isMobile || sidebarOpen}
    {#if isMobile}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="fixed inset-0 z-40 bg-black/50"
        onclick={() => {
          sidebarOpen = false;
        }}
        onkeydown={(event) => {
          if (event.key === "Escape") {
            sidebarOpen = false;
          }
        }}
      ></div>
    {/if}

    <AgentsSidebar
      projectName={bootstrap?.project.name ?? "Worktree Chat"}
      worktrees={filteredWorktrees}
      totalCount={listedWorktrees.length}
      selectedBranch={selectedBranch}
      searchQuery={searchQuery}
      emptyMessage={describeEmptyState()}
      isMobile={isMobile}
      onClose={() => {
        sidebarOpen = false;
      }}
      onSearchChange={(value) => {
        searchQuery = value;
      }}
      onSelect={selectWorktree}
    />
  {/if}

  <main class="flex min-w-0 flex-1 flex-col overflow-hidden">
    <AgentsTopBar
      projectName={bootstrap?.project.name ?? "Worktree Chat"}
      worktree={selectedWorktree}
      conversation={conversation}
      conversationError={conversationError}
      conversationLoading={conversationLoading}
      isSending={isSending}
      isMobile={isMobile}
      onPrimaryAction={() => void handleTopBarPrimaryAction()}
      onToggleSidebar={() => {
        sidebarOpen = !sidebarOpen;
      }}
    />

    {#if errorMessage}
      <div class="mx-4 mt-4 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-primary">
        {errorMessage}
      </div>
    {/if}

    {#if selectedWorktree}
      <ConversationPanel
        worktree={selectedWorktree}
        conversation={conversation}
        conversationError={conversationError}
        conversationLoading={conversationLoading}
        composerText={composerText}
        isSending={isSending}
        onAttach={() => void loadConversation(selectedWorktree.branch, "attach")}
        onComposerInput={(value) => {
          composerText = value;
        }}
        onInterrupt={() => void interruptSelectedConversation()}
        onRefresh={() => void refreshSelectedConversation()}
        onSend={() => void sendSelectedConversationMessage()}
      />
    {:else}
      <div class="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted">
        Select a worktree from the sidebar to open chat.
      </div>
    {/if}
  </main>
</div>
