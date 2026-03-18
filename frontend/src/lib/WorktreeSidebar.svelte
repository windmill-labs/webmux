<script lang="ts">
  import LinearPanel from "./LinearPanel.svelte";
  import WorktreeList from "./WorktreeList.svelte";
  import type { LinearIssue, WorktreeInfo } from "./types";

  let {
    appName,
    activeCreateCount,
    createIndicatorLabel,
    worktrees,
    selected,
    removing,
    initializing,
    notifiedBranches,
    linearIssues,
    isMobile = false,
    oncreate,
    onselect,
    onremove,
    onassignissue,
    onselectissue,
  }: {
    appName?: string;
    activeCreateCount: number;
    createIndicatorLabel: string;
    worktrees: WorktreeInfo[];
    selected: string | null;
    removing: Set<string>;
    initializing: Set<string>;
    notifiedBranches: Set<string>;
    linearIssues: LinearIssue[];
    isMobile?: boolean;
    oncreate: () => void;
    onselect: (branch: string) => void;
    onremove: (branch: string) => void;
    onassignissue: (issue: LinearIssue) => void;
    onselectissue: (issue: LinearIssue) => void;
  } = $props();
</script>

<div class="flex flex-1 min-h-0 flex-col overflow-hidden bg-sidebar">
  <div class="border-b border-edge p-4">
    <div class="flex items-center justify-between gap-3">
      <h1 class="truncate text-base font-semibold">{appName ?? "Dashboard"}</h1>
      <button
        type="button"
        class="flex h-8 items-center justify-center gap-1.5 rounded-md border border-edge bg-surface px-2 text-xs text-accent hover:bg-hover"
        onclick={oncreate}
        title="New Worktree (Cmd+K)"
      >
        <span class="text-lg leading-none">+</span>
        New
      </button>
    </div>
    {#if activeCreateCount > 0}
      <div class="mt-2 flex items-center gap-1 text-[10px] text-muted">
        <span class="spinner"></span>
        {createIndicatorLabel}
      </div>
    {/if}
  </div>

  <WorktreeList
    selected={selected}
    removing={removing}
    initializing={initializing}
    {worktrees}
    {notifiedBranches}
    onselect={onselect}
    onremove={onremove}
  />

  {#if linearIssues.length > 0}
    <LinearPanel issues={linearIssues} onassign={onassignissue} onselect={onselectissue} />
  {/if}

  {#if !isMobile}
    <div class="shrink-0 border-t border-edge px-4 py-3 text-[11px] text-muted">
      <div class="flex justify-between">
        <span>Navigate</span>
        <kbd class="opacity-60">Cmd+Up/Down</kbd>
      </div>
      <div class="mt-1 flex justify-between">
        <span>New worktree</span>
        <kbd class="opacity-60">Cmd+K</kbd>
      </div>
      <div class="mt-1 flex justify-between">
        <span>Merge</span>
        <kbd class="opacity-60">Cmd+M</kbd>
      </div>
      <div class="mt-1 flex justify-between">
        <span>Remove</span>
        <kbd class="opacity-60">Cmd+D</kbd>
      </div>
    </div>
  {/if}
</div>
