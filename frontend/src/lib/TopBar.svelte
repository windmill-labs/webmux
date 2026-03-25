<script lang="ts">
  import type {
    WorktreeInfo,
    AppNotification,
    PrEntry,
    LinkedRepoInfo,
  } from "./types";
  import LinearBadge from "./LinearBadge.svelte";
  import RepoGroup from "./RepoGroup.svelte";
  import Btn from "./Btn.svelte";
  import NotificationItem from "./NotificationItem.svelte";
  import { makeCursorUrl } from "./utils";

  let {
    name,
    worktree,
    sshHost,
    linkedRepos = [],
    isMobile = false,
    notificationHistory = [],
    unreadCount = 0,
    ontogglesidebar,
    onclose,
    onmerge,
    onremove,
    onsettings,
    onCiClick,
    onReviewsClick,
    ondirtyclick,
    onbellopen,
    onnotificationselect,
  }: {
    name: string | null;
    worktree: WorktreeInfo | undefined;
    sshHost: string;
    linkedRepos?: LinkedRepoInfo[];
    isMobile?: boolean;
    notificationHistory?: AppNotification[];
    unreadCount?: number;
    ontogglesidebar?: () => void;
    onclose: () => void;
    onmerge: () => void;
    onremove: () => void;
    onsettings: () => void;
    onCiClick: (pr: PrEntry) => void;
    onReviewsClick: (pr: PrEntry) => void;
    ondirtyclick?: () => void;
    onbellopen?: () => void;
    onnotificationselect?: (branch: string) => void;
  } = $props();

  let bellOpen = $state(false);
  let moreOpen = $state(false);

  function toggleBell(): void {
    bellOpen = !bellOpen;
    if (bellOpen) onbellopen?.();
  }

  function handleClickOutside(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    if (!target.closest(".bell-container")) {
      bellOpen = false;
    }
    if (!target.closest(".more-container")) {
      moreOpen = false;
    }
  }

  function truncateWorktreeName(
    value: string | null,
    maxLength: number,
  ): string | null {
    if (!value || value.length <= maxLength) return value;
    return `${value.slice(0, maxLength - 3)}...`;
  }

  let cursorUrl = $derived(makeCursorUrl(worktree?.dir, sshHost));
  let displayName = $derived(truncateWorktreeName(name, 30));

  // Split PRs into main repo vs linked repo groups
  let mainPrs = $derived(
    (worktree?.prs ?? []).filter(
      (pr) => !pr.repo || !linkedRepos.some((lr) => lr.alias === pr.repo),
    ),
  );

  let linkedRepoGroups = $derived(
    linkedRepos
      .map((lr) => ({
        alias: lr.alias,
        dir: lr.dir,
        cursorUrl: makeCursorUrl(lr.dir && name ? `${lr.dir}/${name}` : null, sshHost),
        prs: (worktree?.prs ?? []).filter((pr) => pr.repo === lr.alias),
      }))
      .filter((g) => g.prs.length > 0 || g.cursorUrl),
  );

  let hasMoreContent = $derived(
    mainPrs.length > 0 || linkedRepoGroups.length > 0,
  );
</script>

<div class="flex items-stretch bg-topbar border-b border-edge min-h-12">
  <!-- Left + middle: rows of repo groups -->
  <div class="flex-1 min-w-0 flex flex-col justify-center px-4 py-2.5 gap-1.5">
    <!-- Main row: branch name + worktree-level badges + main repo PR badges -->
    <div class="topbar-main-row flex items-start gap-3 min-w-0">
      <div class="topbar-main-meta flex items-center gap-3 min-w-0">
        {#if isMobile && ontogglesidebar}
          <button
            type="button"
            class="p-1 -ml-1 cursor-pointer bg-transparent border-none text-muted hover:text-primary"
            onclick={ontogglesidebar}
            title="Toggle sidebar"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
        {/if}
        <span class="min-w-0 text-sm font-semibold truncate" title={name ?? undefined}
          >{displayName ?? "Select a worktree"}</span
        >
        {#if worktree?.dirty || worktree?.unpushed}
          <button
            type="button"
            class="shrink-0 text-[10px] px-1.5 py-0.5 rounded border border-warning/40 text-warning bg-transparent cursor-pointer hover:bg-warning/10"
            onclick={ondirtyclick}
          >{worktree.dirty ? "dirty" : "unpushed"}</button>
        {/if}
        {#if worktree?.linearIssue}
          <LinearBadge issue={worktree.linearIssue} clickable={true} />
        {/if}
      </div>
      {#if !isMobile}
        <div class="topbar-main-prs min-w-0 flex-1">
          <RepoGroup
            prs={mainPrs}
            services={worktree?.services ?? []}
            {cursorUrl}
            {onCiClick}
            {onReviewsClick}
          />
        </div>
      {/if}
    </div>

    <!-- Linked repo rows (desktop only) -->
    {#if !isMobile}
      {#each linkedRepoGroups as group (group.alias)}
        <RepoGroup
          label={group.alias}
          prs={group.prs}
          cursorUrl={group.cursorUrl}
          {onCiClick}
          {onReviewsClick}
        />
      {/each}
    {/if}
  </div>

  <!-- Right: action buttons (pinned, vertically centered) -->
  <div class="shrink-0 flex gap-2 items-center px-4">
    {#if worktree}
      {#if worktree.mux === "✓"}
        <Btn variant="default" onclick={onclose} title="Close worktree window"
          >{isMobile ? "C" : "Close"}</Btn
        >
      {/if}
      <Btn variant="accent-outline" onclick={onmerge} title="Merge worktree"
        >{isMobile ? "M" : "Merge"}</Btn
      >
      <Btn variant="danger-outline" onclick={onremove} title="Remove worktree"
        >{isMobile ? "R" : "Remove"}</Btn
      >
    {/if}

    {#if isMobile && worktree && hasMoreContent}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="more-container relative" onkeydown={() => {}}>
        <button
          type="button"
          class="p-1.5 rounded-md cursor-pointer bg-transparent border border-transparent text-muted hover:text-primary hover:border-edge"
          title="More info"
          onclick={() => {
            moreOpen = !moreOpen;
          }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
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

        {#if moreOpen}
          <div class="more-dropdown">
            <div class="flex flex-col gap-2 p-3">
              <RepoGroup prs={mainPrs} {onCiClick} {onReviewsClick} />
              {#each linkedRepoGroups as group (group.alias)}
                <RepoGroup
                  label={group.alias}
                  prs={group.prs}
                  {onCiClick}
                  {onReviewsClick}
                />
              {/each}
            </div>
          </div>
        {/if}
      </div>
    {/if}

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="bell-container relative ml-3" onkeydown={() => {}}>
      <button
        type="button"
        class="relative p-1.5 rounded-md cursor-pointer bg-transparent border border-transparent text-muted hover:text-primary hover:border-edge"
        title="Notifications"
        onclick={toggleBell}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {#if unreadCount > 0}
          <span
            class="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-accent text-white text-[10px] flex items-center justify-center leading-none"
            >{unreadCount > 9 ? "9+" : unreadCount}</span
          >
        {/if}
      </button>

      {#if bellOpen}
        <div class="bell-dropdown">
          <div
            class="text-xs font-semibold text-muted px-3 py-2 border-b border-edge"
          >
            Notifications
          </div>
          {#if notificationHistory.length === 0}
            <div class="px-3 py-4 text-xs text-muted text-center">
              No notifications yet
            </div>
          {:else}
            <ul class="list-none max-h-64 overflow-y-auto">
              {#each notificationHistory as n (n.id)}
                <li>
                  <button
                    type="button"
                    class="w-full px-3 py-2 text-left bg-transparent border-none text-inherit cursor-pointer hover:bg-hover flex items-center gap-2"
                    onclick={() => {
                      onnotificationselect?.(n.branch);
                      bellOpen = false;
                    }}
                  >
                    <NotificationItem notification={n} showTimestamp />
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}
    </div>

    <button
      type="button"
      class="p-1.5 rounded-md cursor-pointer bg-transparent border border-transparent text-muted hover:text-primary hover:border-edge"
      title="Settings"
      onclick={onsettings}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path
          d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
        />
        <circle cx="12" cy="12" r="3" />
      </svg>
    </button>
  </div>
</div>

<svelte:window onclick={handleClickOutside} />

<style>
  .more-dropdown {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 0.25rem;
    width: max-content;
    max-width: 80vw;
    border-radius: 0.5rem;
    border: 1px solid var(--color-edge);
    background: var(--color-topbar);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    z-index: 50;
  }

  .bell-dropdown {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 0.25rem;
    width: 18rem;
    border-radius: 0.5rem;
    border: 1px solid var(--color-edge);
    background: var(--color-topbar);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    z-index: 50;
  }
</style>
