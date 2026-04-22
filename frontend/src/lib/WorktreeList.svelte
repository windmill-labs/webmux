<script lang="ts">
  import type { WorktreeListRow } from "./types";
  import PrBadge from "./PrBadge.svelte";
  import LinearBadge from "./LinearBadge.svelte";
  import AgentStatusIcon from "./AgentStatusIcon.svelte";
  import { worktreeCreationPhaseLabel } from "./utils";

  let openMenuBranch = $state<string | null>(null);

  let {
    rows,
    selected,
    removing,
    initializing,
    archiving,
    notifiedBranches,
    emptyMessage = "No worktrees found.",
    onselect,
    onclose,
    onarchive,
    onmerge,
    onremove,
  }: {
    rows: WorktreeListRow[];
    selected: string | null;
    removing: Set<string>;
    initializing: Set<string>;
    archiving: Set<string>;
    notifiedBranches: Set<string>;
    emptyMessage?: string;
    onselect: (branch: string) => void;
    onclose: (branch: string) => void;
    onarchive: (branch: string) => void;
    onmerge: (branch: string) => void;
    onremove: (branch: string) => void;
  } = $props();

  function toggleMenu(branch: string): void {
    openMenuBranch = openMenuBranch === branch ? null : branch;
  }

  function runMenuAction(branch: string, action: (branch: string) => void): void {
    openMenuBranch = null;
    action(branch);
  }

  $effect(() => {
    if (!openMenuBranch) return;

    function handleDocumentClick(event: MouseEvent): void {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.closest("[data-worktree-row-menu]")) {
        openMenuBranch = null;
      }
    }

    function handleEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        openMenuBranch = null;
      }
    }

    document.addEventListener("click", handleDocumentClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("click", handleDocumentClick);
      document.removeEventListener("keydown", handleEscape);
    };
  });
</script>

<ul class="list-none overflow-y-auto flex-1 p-2">
  {#if rows.length === 0}
    <li class="px-3 py-4 text-xs text-muted text-center">{emptyMessage}</li>
  {/if}
  {#each rows as row (row.worktree.branch)}
    {@const wt = row.worktree}
    {@const isActive = wt.branch === selected}
    {@const isRemoving = removing.has(wt.branch)}
    {@const isClosed = wt.mux !== "✓"}
    {@const isInitializing = initializing.has(wt.branch)}
    {@const isArchiving = archiving.has(wt.branch)}
    {@const isCreating = wt.creating}
    {@const isArchived = wt.archived}
    {@const isBusy = isRemoving || isInitializing}
    <li class="mb-0.5 group relative {isBusy ? 'opacity-40 pointer-events-none' : ''}">
      <button
        type="button"
        disabled={isBusy}
        class="w-full py-2.5 rounded-md border cursor-pointer flex flex-col gap-1 text-left text-inherit text-sm bg-transparent hover:bg-hover {isActive
          ? 'bg-active border-accent'
          : 'border-transparent'} {isClosed && !isInitializing && !isCreating ? 'opacity-50' : ''} {isArchived ? 'opacity-70' : ''}"
        style={`padding-left:${12 + row.depth * 18}px; padding-right:40px;`}
        onclick={() => {
          openMenuBranch = null;
          onselect(wt.branch);
        }}
      >
        <span class="flex items-center gap-1.5 pr-5 flex-wrap">
          <div class="flex items-center gap-2 max-w-[90%] min-w-0">
            {#if row.depth > 0}
              <span class="shrink-0 text-muted/60">↳</span>
            {/if}
            <span class="font-medium truncate">{wt.branch}</span>
            {#if isArchived}
              <span class="shrink-0 text-[10px] px-1.5 py-0.5 rounded border border-edge text-muted">
                archived
              </span>
            {/if}
            {#if isCreating}
              <span class="shrink-0 inline-flex items-center gap-1 text-[10px] text-muted">
                <span class="spinner"></span>
                {worktreeCreationPhaseLabel(wt.creationPhase)}...
              </span>
            {:else if isInitializing}
              <span class="shrink-0 text-[10px] text-muted">opening...</span>
            {:else if isClosed}
              <span class="shrink-0 text-[10px] text-muted">closed</span>
            {:else}
              <span class="shrink-0"><AgentStatusIcon status={wt.agent} size={14} /></span>
            {/if}
            {#if notifiedBranches.has(wt.branch)}
              <span class="shrink-0 w-2 h-2 rounded-full bg-accent"></span>
            {/if}
          </div>
          {#each wt.prs as pr (pr.repo)}
            <PrBadge {pr} />
          {/each}
          {#if wt.linearIssue}
            <LinearBadge issue={wt.linearIssue} clickable={false} />
          {/if}
        </span>
        <span class="flex gap-2 text-[11px] text-muted items-center flex-wrap">
          {#if wt.agentLabel ?? wt.agentName}
            <span>{wt.agentLabel ?? wt.agentName}</span>
          {/if}
          {#if wt.profile}
            <span>{wt.profile}</span>
          {/if}
        </span>
        {#if wt.services.length > 0}
          <span class="flex gap-2 text-[11px] text-muted font-mono">
            {#each wt.services as svc}
              {#if svc.port}
                <span class={svc.running ? "text-success" : ""}>{svc.name}:{svc.port}</span>
              {/if}
            {/each}
          </span>
        {/if}
      </button>
      <button
        type="button"
        disabled={isBusy}
        class="absolute top-2 right-2 w-6 h-6 rounded flex items-center justify-center text-muted hover:text-primary hover:bg-hover opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
        title="Worktree actions"
        aria-label={`Actions for ${wt.branch}`}
        aria-haspopup="menu"
        aria-expanded={openMenuBranch === wt.branch}
        onclick={(event) => {
          event.stopPropagation();
          toggleMenu(wt.branch);
        }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="5" r="1" />
          <circle cx="12" cy="12" r="1" />
          <circle cx="12" cy="19" r="1" />
        </svg>
      </button>
      {#if openMenuBranch === wt.branch}
        <div
          class="absolute top-9 right-2 z-10 min-w-32 rounded-md border border-edge bg-surface shadow-lg p-1"
          data-worktree-row-menu
        >
          <button
            type="button"
            disabled={isClosed || isCreating}
            class="w-full px-2 py-1.5 rounded text-left text-xs text-primary hover:bg-hover disabled:opacity-50 disabled:cursor-not-allowed"
            onclick={(event) => {
              event.stopPropagation();
              runMenuAction(wt.branch, onclose);
            }}
          >
            Close
          </button>
          <button
            type="button"
            disabled={isCreating || isArchiving}
            class="w-full px-2 py-1.5 rounded text-left text-xs text-primary hover:bg-hover disabled:opacity-50 disabled:cursor-not-allowed"
            onclick={(event) => {
              event.stopPropagation();
              runMenuAction(wt.branch, onarchive);
            }}
          >
            {wt.archived ? "Restore" : "Archive"}
          </button>
          <button
            type="button"
            class="w-full px-2 py-1.5 rounded text-left text-xs text-primary hover:bg-hover"
            onclick={(event) => {
              event.stopPropagation();
              runMenuAction(wt.branch, onmerge);
            }}
          >
            Merge
          </button>
          <button
            type="button"
            class="w-full px-2 py-1.5 rounded text-left text-xs text-danger hover:bg-hover"
            onclick={(event) => {
              event.stopPropagation();
              runMenuAction(wt.branch, onremove);
            }}
          >
            Remove
          </button>
        </div>
      {/if}
    </li>
  {/each}
</ul>
