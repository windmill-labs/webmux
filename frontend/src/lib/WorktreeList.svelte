<script lang="ts">
  import type { WorktreeInfo } from "./types";
  import PrBadge from "./PrBadge.svelte";
  import LinearBadge from "./LinearBadge.svelte";
  import AgentStatusIcon from "./AgentStatusIcon.svelte";

  let {
    worktrees,
    selected,
    removing,
    initializing,
    notifiedBranches,
    onselect,
    onremove,
  }: {
    worktrees: WorktreeInfo[];
    selected: string | null;
    removing: Set<string>;
    initializing: string | null;
    notifiedBranches: Set<string>;
    onselect: (branch: string) => void;
    onremove: (branch: string) => void;
  } = $props();
</script>

<ul class="list-none overflow-y-auto flex-1 p-2">
  {#each worktrees as wt (wt.branch)}
    {@const isActive = wt.branch === selected}
    {@const isRemoving = removing.has(wt.branch)}
    {@const isClosed = wt.mux !== "✓"}
    {@const isInitializing = initializing === wt.branch}
    <li
      class="mb-0.5 group relative {isRemoving || isInitializing
        ? 'opacity-40 pointer-events-none'
        : ''}"
    >
      <button
        type="button"
        class="w-full py-2.5 px-3 rounded-md border cursor-pointer flex flex-col gap-1 text-left text-inherit text-sm bg-transparent hover:bg-hover {isActive
          ? 'bg-active border-accent'
          : 'border-transparent'} {isClosed && !isInitializing ? 'opacity-50' : ''}"
        onclick={() => onselect(wt.branch)}
      >
        <span class="flex items-center gap-1.5 pr-5 flex-wrap">
          <div class="flex items-center gap-2 max-w-[90%] min-w-0">
            <span class="font-medium truncate">{wt.branch}</span>
            {#if isInitializing}
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
            <LinearBadge issue={wt.linearIssue} />
          {/if}
        </span>
        <span class="flex gap-2 text-[11px] text-muted items-center flex-wrap">
          {#if wt.agentName}
            <span>{wt.agentName}</span>
          {/if}
          {#if wt.profile}
            <span>{wt.profile}</span>
          {/if}
        </span>
        {#if wt.services.length > 0}
          <span class="flex gap-2 text-[11px] text-muted font-mono">
            {#each wt.services as svc}
              {#if svc.port}
                <span class={svc.running ? "text-success" : ""}
                  >{svc.name}:{svc.port}</span
                >
              {/if}
            {/each}
          </span>
        {/if}
      </button>
      <button
        type="button"
        class="absolute top-2 right-2 w-5 h-5 rounded flex items-center justify-center text-muted hover:text-danger hover:bg-hover opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
        title="Remove worktree"
        onclick={(e) => {
          e.stopPropagation();
          onremove(wt.branch);
        }}>&times;</button
      >
    </li>
  {/each}
</ul>
