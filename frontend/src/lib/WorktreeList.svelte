<script lang="ts">
  import { untrack } from "svelte";
  import type { WorktreeListRow } from "./types";
  import PrBadge from "./PrBadge.svelte";
  import LinearBadge from "./LinearBadge.svelte";
  import AgentStatusIcon, { agentIconVisible } from "./AgentStatusIcon.svelte";
  import { worktreeCreationPhaseLabel } from "./utils";
  import {
    OVERFLOW_STATUS_BAR_STATUSES,
    branchesWithAgentStatus,
    countAgentStatusesIn,
    type OverflowStatusBarStatus,
  } from "./worktree-list";

  type RowPosition = "above" | "visible" | "below";

  let openMenuBranch = $state<string | null>(null);

  let {
    rows,
    selected,
    removing,
    initializing,
    archiving,
    postingLinear,
    notifiedBranches,
    emptyMessage = "No worktrees found.",
    onselect,
    onclose,
    onarchive,
    onmerge,
    onremove,
    oncreatesubworktree,
    onposttolinear,
  }: {
    rows: WorktreeListRow[];
    selected: string | null;
    removing: Set<string>;
    initializing: Set<string>;
    archiving: Set<string>;
    postingLinear: Set<string>;
    notifiedBranches: Set<string>;
    emptyMessage?: string;
    onselect: (branch: string) => void;
    onclose: (branch: string) => void;
    onarchive: (branch: string) => void;
    onmerge: (branch: string) => void;
    onremove: (branch: string) => void;
    oncreatesubworktree: (branch: string) => void;
    onposttolinear?: (branch: string) => void;
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

  let listEl = $state<HTMLUListElement | null>(null);
  let rowPositions = $state<Map<string, RowPosition>>(new Map());
  let cycleCursor = $state<Record<string, string>>({});

  // Measure the rendered bars (each sits `top-2`/`bottom-2` = 8px off the list edge)
  // so the observer's margins occlude exactly the band each bar covers — no magic number.
  const BAR_OFFSET = 8;
  let topBarEl = $state<HTMLElement | null>(null);
  let bottomBarEl = $state<HTMLElement | null>(null);
  let topBarHeight = $state(0);
  let bottomBarHeight = $state(0);
  $effect(() => {
    topBarHeight = topBarEl?.offsetHeight ?? 0;
  });
  $effect(() => {
    bottomBarHeight = bottomBarEl?.offsetHeight ?? 0;
  });
  let rootMargin = $derived(
    `-${topBarHeight ? topBarHeight + BAR_OFFSET : 0}px 0px ` +
      `-${bottomBarHeight ? bottomBarHeight + BAR_OFFSET : 0}px 0px`,
  );

  // The identity of the rows present, independent of per-row status churn — changes
  // only when worktrees are added or removed, not on every agent-status poll.
  let branchKey = $derived(rows.map((row) => row.worktree.branch).join("\n"));

  // Track whether each row is scrolled above, into, or below the viewport so the
  // top/bottom floating bars can summarise the agent statuses hidden in each direction.
  $effect(() => {
    const root = listEl;
    if (!root) return;
    branchKey; // re-observe only when rows are added/removed
    const margin = rootMargin; // and when the measured bar band changes

    // Drop tracking for branches that have left the list (untracked so scroll
    // updates to rowPositions don't re-run this effect and rebuild the observer).
    untrack(() => {
      const present = new Set(rows.map((row) => row.worktree.branch));
      const pruned = new Map([...rowPositions].filter(([branch]) => present.has(branch)));
      if (pruned.size !== rowPositions.size) rowPositions = pruned;
    });

    const observer = new IntersectionObserver(
      (entries) => {
        const next = new Map(rowPositions);
        for (const entry of entries) {
          const target = entry.target;
          if (!(target instanceof HTMLElement)) continue;
          const branch = target.dataset.branch;
          if (!branch) continue;
          if (entry.isIntersecting) {
            next.set(branch, "visible");
          } else {
            const rootTop = entry.rootBounds?.top ?? 0;
            next.set(branch, entry.boundingClientRect.top < rootTop ? "above" : "below");
          }
        }
        rowPositions = next;
      },
      // Negative top/bottom margins keep rows tucked behind the floating bars counted as hidden.
      { root, rootMargin: margin, threshold: 0 },
    );
    for (const li of root.querySelectorAll("[data-branch]")) {
      observer.observe(li);
    }
    return () => observer.disconnect();
  });

  function branchesAt(position: RowPosition): Set<string> {
    const set = new Set<string>();
    for (const [branch, value] of rowPositions) {
      if (value === position) set.add(branch);
    }
    return set;
  }

  let aboveBranches = $derived(branchesAt("above"));
  let belowBranches = $derived(branchesAt("below"));
  let aboveCounts = $derived(countAgentStatusesIn(rows, aboveBranches, notifiedBranches));
  let belowCounts = $derived(countAgentStatusesIn(rows, belowBranches, notifiedBranches));
  let hasAbove = $derived(OVERFLOW_STATUS_BAR_STATUSES.some((s) => aboveCounts[s] > 0));
  let hasBelow = $derived(OVERFLOW_STATUS_BAR_STATUSES.some((s) => belowCounts[s] > 0));

  const statusLabels: Record<OverflowStatusBarStatus, string> = {
    waiting: "waiting",
    error: "error",
    "done-unread": "unread",
  };

  function cycleToStatus(status: OverflowStatusBarStatus, direction: "above" | "below"): void {
    const branches = branchesWithAgentStatus(
      rows,
      status,
      direction === "above" ? aboveBranches : belowBranches,
      notifiedBranches,
    );
    // Cycle nearest-to-the-fold first: below rows are already in that order, above
    // rows need reversing so the first click lands on the row just above the fold.
    if (direction === "above") branches.reverse();
    if (branches.length === 0 || !listEl) return;
    const key = `${direction}:${status}`;
    // Advance from the last branch we scrolled to; if it has since scrolled into
    // view (no longer in the list), indexOf is -1 and we restart from the first.
    const nextIndex = (branches.indexOf(cycleCursor[key] ?? "") + 1) % branches.length;
    const nextBranch = branches[nextIndex];
    cycleCursor = { ...cycleCursor, [key]: nextBranch };
    const target = Array.from(listEl.querySelectorAll<HTMLElement>("[data-branch]")).find(
      (el) => el.dataset.branch === nextBranch,
    );
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
</script>

<div class="relative flex min-h-0 flex-1 flex-col">
  <ul bind:this={listEl} class="list-none overflow-y-auto flex-1 min-h-0 p-2">
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
      {@const hasLabel = !!wt.label}
      {@const hasBadgeRow = isArchived || isCreating || isInitializing || isClosed || wt.prs.length > 0 || !!wt.linearIssue || wt.source === "oneshot"}
      <li
        data-branch={wt.branch}
        class="mb-0.5 group relative {isBusy ? 'opacity-40 pointer-events-none' : ''}"
      >
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
          <span class="flex min-w-0 items-start gap-2 pr-5">
            {#if row.depth > 0}
              <span class="shrink-0 text-muted/60">↳</span>
            {/if}
            <span class="min-w-0 flex flex-1 flex-col gap-1">
              <span class="flex min-w-0 items-center gap-1.5" data-worktree-name-row>
                <span class="min-w-0 flex flex-1 flex-col">
                  <span class="font-medium truncate">{wt.label ?? wt.branch}</span>
                  {#if hasLabel}
                    <span class="text-[10px] leading-tight text-muted truncate">{wt.branch}</span>
                  {/if}
                </span>
                {#if !isCreating && !isInitializing && !isClosed && agentIconVisible(wt.agent, notifiedBranches.has(wt.branch))}
                  <span class="shrink-0"
                    ><AgentStatusIcon
                      status={wt.agent}
                      size={14}
                      unread={notifiedBranches.has(wt.branch)}
                    /></span
                  >
                {/if}
              </span>
              {#if hasBadgeRow}
                <span class="flex min-w-0 flex-wrap items-center gap-1.5" data-worktree-badge-row>
                  {#if wt.source === "oneshot"}
                    <span
                      class="shrink-0 text-[10px] px-1.5 py-0.5 rounded border border-edge text-muted"
                      title="Autonomous run — auto-closes when done"
                    >
                      oneshot
                    </span>
                  {/if}
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
                  {/if}
                  {#each wt.prs as pr (pr.repo)}
                    <PrBadge {pr} />
                  {/each}
                  {#if wt.linearIssue}
                    <LinearBadge issue={wt.linearIssue} clickable={false} />
                  {/if}
                </span>
              {/if}
            </span>
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
              disabled={isCreating}
              class="w-full px-2 py-1.5 rounded text-left text-xs text-primary hover:bg-hover disabled:opacity-50 disabled:cursor-not-allowed"
              onclick={(event) => {
                event.stopPropagation();
                runMenuAction(wt.branch, oncreatesubworktree);
              }}
            >
              Create sub-worktree
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
            {#if onposttolinear}
              {@const isPostingLinear = postingLinear.has(wt.branch)}
              <div class="my-1 border-t border-edge"></div>
              <button
                type="button"
                disabled={isPostingLinear}
                class="w-full px-2 py-1.5 rounded text-left text-xs text-primary hover:bg-hover disabled:opacity-50 disabled:cursor-not-allowed"
                onclick={(event) => {
                  event.stopPropagation();
                  openMenuBranch = null;
                  onposttolinear(wt.branch);
                }}
              >
                {#if isPostingLinear}
                  Posting to Linear…
                {:else if wt.linearIssue}
                  Post conversation to {wt.linearIssue.identifier}
                {:else}
                  Post conversation to Linear…
                {/if}
              </button>
            {/if}
          </div>
        {/if}
      </li>
    {/each}
  </ul>
  {#if hasAbove}
    <div
      bind:this={topBarEl}
      class="pointer-events-none absolute inset-x-0 top-2 flex justify-center"
    >
      {@render statusBar(aboveCounts, "above")}
    </div>
  {/if}
  {#if hasBelow}
    <div
      bind:this={bottomBarEl}
      class="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center"
    >
      {@render statusBar(belowCounts, "below")}
    </div>
  {/if}
</div>

{#snippet statusBar(counts: Record<OverflowStatusBarStatus, number>, direction: "above" | "below")}
  <div
    class="pointer-events-auto flex items-center gap-1 rounded-full border border-edge bg-surface/90 px-1.5 py-1 shadow-lg backdrop-blur"
  >
    {#each OVERFLOW_STATUS_BAR_STATUSES as status}
      {#if counts[status] > 0}
        <button
          type="button"
          class="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] tabular-nums hover:bg-hover cursor-pointer"
          title={`Scroll to next ${statusLabels[status]} worktree ${direction}`}
          onclick={() => cycleToStatus(status, direction)}
        >
          <AgentStatusIcon
            status={status === "done-unread" ? "done" : status}
            unread={status === "done-unread"}
            size={12}
          />
          <span>{counts[status]}</span>
        </button>
      {/if}
    {/each}
  </div>
{/snippet}
