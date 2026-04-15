<script lang="ts">
  import type { AgentsUiWorktreeSummary } from "../types";

  interface Props {
    projectName: string;
    worktrees: AgentsUiWorktreeSummary[];
    totalCount: number;
    selectedBranch: string | null;
    searchQuery: string;
    emptyMessage: string;
    isMobile: boolean;
    onClose: () => void;
    onSearchChange: (value: string) => void;
    onSelect: (branch: string) => void;
  }

  const {
    projectName,
    worktrees,
    totalCount,
    selectedBranch,
    searchQuery,
    emptyMessage,
    isMobile,
    onClose,
    onSearchChange,
    onSelect,
  }: Props = $props();

  function describeWorktree(worktree: AgentsUiWorktreeSummary): string {
    if (worktree.creating && worktree.creationPhase) return worktree.creationPhase.replaceAll("_", " ");
    if (worktree.conversation) return "chat ready";
    if (worktree.agentName === "claude" || worktree.agentName === "codex") return "attach on open";
    return "terminal only";
  }

  function handleSearchInput(event: Event): void {
    const target = event.currentTarget;
    if (!(target instanceof HTMLInputElement)) return;
    onSearchChange(target.value);
  }
</script>

<aside
  class={`${isMobile ? "fixed inset-0 z-50 w-full" : ""} bg-sidebar border-r border-edge flex shrink-0 flex-col overflow-hidden md:w-[20rem]`}
>
  <div class="border-b border-edge p-4">
    <div class="flex items-center justify-between gap-2">
      <h1 class="truncate text-base font-semibold">{projectName}</h1>
      {#if isMobile}
        <button
          type="button"
          class="flex h-8 w-8 items-center justify-center rounded-md border border-edge bg-surface text-sm text-muted hover:bg-hover"
          onclick={onClose}
          title="Close sidebar"
        >
          &times;
        </button>
      {/if}
    </div>

    <div class="mt-2 text-[11px] text-muted">{totalCount} worktrees</div>

    <div class="relative mt-3">
      <input
        type="search"
        class="h-7 w-full rounded-md border border-edge bg-surface px-2 pr-6 text-xs text-primary placeholder:text-muted focus:border-accent focus:outline-none"
        placeholder="Search worktrees"
        aria-label="Search worktrees"
        value={searchQuery}
        oninput={handleSearchInput}
      />

      {#if searchQuery.trim().length > 0}
        <button
          type="button"
          class="absolute top-1/2 right-1 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded text-muted hover:text-primary"
          onclick={() => {
            onSearchChange("");
          }}
          aria-label="Clear worktree search"
        >
          &times;
        </button>
      {/if}
    </div>
  </div>

  <ul class="flex-1 list-none overflow-y-auto p-2">
    {#if worktrees.length === 0}
      <li class="px-3 py-4 text-center text-xs text-muted">{emptyMessage}</li>
    {/if}

    {#each worktrees as worktree (worktree.branch)}
      {@const isActive = worktree.branch === selectedBranch}
      <li class="mb-0.5">
        <button
          type="button"
          class={`w-full rounded-md border bg-transparent px-3 py-2.5 text-left text-sm transition ${
            isActive ? "border-accent bg-active" : "border-transparent hover:bg-hover"
          }`}
          onclick={() => onSelect(worktree.branch)}
        >
          <div class="flex items-start gap-3">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="truncate font-medium">{worktree.branch}</span>
                {#if worktree.archived}
                  <span class="shrink-0 rounded border border-edge px-1.5 py-0.5 text-[10px] text-muted">
                    archived
                  </span>
                {/if}
              </div>

              <div class="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted">
                {#if worktree.creating}
                  <span class="inline-flex items-center gap-1">
                    <span class="spinner"></span>
                    creating
                  </span>
                {:else}
                  <span>{worktree.agentName ?? "unassigned"}</span>
                {/if}

                <span>{describeWorktree(worktree)}</span>
              </div>
            </div>

            <span class="shrink-0 text-[10px] text-muted">{worktree.status}</span>
          </div>
        </button>
      </li>
    {/each}
  </ul>
</aside>
