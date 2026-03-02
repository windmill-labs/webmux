<script lang="ts">
  import type { WorktreeInfo, AppNotification, PrEntry } from "./types";
  import PrBadge from "./PrBadge.svelte";
  import CiBadge from "./CiBadge.svelte";
  import ReviewsBadge from "./ReviewsBadge.svelte";
  import Btn from "./Btn.svelte";
  import NotificationItem from "./NotificationItem.svelte";

  let {
    name,
    worktree,
    sshHost,
    isMobile = false,
    notificationHistory = [],
    unreadCount = 0,
    ontogglesidebar,
    onmerge,
    onremove,
    onsettings,
    onciclick,
    onreviewsclick,
    onbellopen,
    onnotificationselect,
  }: {
    name: string | null;
    worktree: WorktreeInfo | undefined;
    sshHost: string;
    isMobile?: boolean;
    notificationHistory?: AppNotification[];
    unreadCount?: number;
    ontogglesidebar?: () => void;
    onmerge: () => void;
    onremove: () => void;
    onsettings: () => void;
    onciclick: (pr: PrEntry) => void;
    onreviewsclick: (pr: PrEntry) => void;
    onbellopen?: () => void;
    onnotificationselect?: (branch: string) => void;
  } = $props();

  let bellOpen = $state(false);

  function toggleBell(): void {
    bellOpen = !bellOpen;
    if (bellOpen) onbellopen?.();
  }

  function handleClickOutside(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    if (!target.closest(".bell-container")) {
      bellOpen = false;
    }
  }

  let cursorUrl = $derived.by(() => {
    const dir = worktree?.dir;
    if (!dir) return null;
    if (sshHost) {
      return `cursor://vscode-remote/ssh-remote+${sshHost}${dir}`;
    }
    return `cursor://file${dir}`;
  });
</script>

<div
  class="flex items-center justify-between px-4 py-2 bg-topbar border-b border-edge min-h-12"
>
  <div class="flex items-center gap-3">
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
          ><line x1="3" y1="6" x2="21" y2="6" /><line
            x1="3"
            y1="12"
            x2="21"
            y2="12"
          /><line x1="3" y1="18" x2="21" y2="18" /></svg
        >
      </button>
    {/if}
    <span class="text-sm font-semibold truncate"
      >{name ?? "Select a worktree"}</span
    >
    {#if worktree?.dirty}
      <span class="text-[10px] px-1.5 py-0.5 rounded border border-warning/40 text-warning">dirty</span>
    {/if}
    {#each worktree?.prs ?? [] as pr (pr.repo)}
      <PrBadge {pr} clickable />
      {#if pr.ciChecks && pr.ciChecks.length > 0}
        <CiBadge {pr} onclick={onciclick} />
      {/if}
      {#if pr.comments.length > 0}
        <ReviewsBadge {pr} onclick={onreviewsclick} />
      {/if}
    {/each}
    {#if !isMobile}
      {#each worktree?.services ?? [] as svc}
        {#if svc.port}
          <a
            href="{window.location.protocol}//{window.location
              .hostname}:{svc.port}"
            target="_blank"
            rel="noopener"
            class="text-[11px] px-1.5 py-0.5 rounded border font-mono no-underline hover:opacity-80 {svc.running
              ? 'text-success border-success/40'
              : 'text-muted border-edge pointer-events-none'}"
            >{svc.name} :{svc.port}</a
          >
        {/if}
      {/each}
      {#if cursorUrl}
        <div class="flex items-center gap-1">
          <a
            href={cursorUrl}
            class="text-[11px] px-1.5 py-0.5 rounded border border-accent/40 text-accent font-mono no-underline hover:opacity-80"
            title="Open in Cursor">Cursor</a
          ><button
            type="button"
            class="text-[11px] px-1 py-0.5 rounded border border-accent/40 text-accent cursor-pointer bg-transparent hover:opacity-80 flex items-center"
            title="Cursor SSH settings"
            onclick={onsettings}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              ><path
                d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
              /><circle cx="12" cy="12" r="3" /></svg
            >
          </button>
        </div>
      {/if}
    {/if}
  </div>
  <div class="flex gap-2 items-center">
    {#if name}
      <Btn
        variant="accent-outline"
        onclick={onmerge}
        title="Merge worktree">{isMobile ? "M" : "Merge"}</Btn
      >
      <Btn
        variant="danger-outline"
        onclick={onremove}
        title="Remove worktree">{isMobile ? "R" : "Remove"}</Btn
      >
    {/if}

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="bell-container relative ml-3" onkeydown={() => {}}>
      <button
        type="button"
        class="relative p-1.5 rounded-md cursor-pointer bg-transparent border border-transparent text-muted hover:text-primary hover:border-edge"
        title="Notifications"
        onclick={toggleBell}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {#if unreadCount > 0}
          <span class="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-accent text-white text-[10px] flex items-center justify-center leading-none">{unreadCount > 9 ? "9+" : unreadCount}</span>
        {/if}
      </button>

      {#if bellOpen}
        <div class="bell-dropdown">
          <div class="text-xs font-semibold text-muted px-3 py-2 border-b border-edge">Notifications</div>
          {#if notificationHistory.length === 0}
            <div class="px-3 py-4 text-xs text-muted text-center">No notifications yet</div>
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
  </div>
</div>

<svelte:window onclick={handleClickOutside} />

<style>
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
