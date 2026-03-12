<script lang="ts">
  import type { PrEntry, ServiceStatus } from "./types";
  import PrStatusGroup from "./PrStatusGroup.svelte";

  let {
    label,
    prs,
    services = [],
    cursorUrl = null,
    showSettings = false,
    onCiClick,
    onReviewsClick,
    onsettings,
  }: {
    label?: string;
    prs: PrEntry[];
    services?: ServiceStatus[];
    cursorUrl?: string | null;
    showSettings?: boolean;
    onCiClick: (pr: PrEntry) => void;
    onReviewsClick: (pr: PrEntry) => void;
    onsettings?: () => void;
  } = $props();
</script>

<div class="flex items-center gap-2 min-w-0">
  {#if label}
    <span class="shrink-0 text-[10px] font-medium text-muted">{label}:</span>
  {/if}
  {#each prs as pr (`${pr.repo}#${pr.number}`)}
    <PrStatusGroup {pr} {onCiClick} {onReviewsClick} />
  {/each}
  {#each services as svc}
    {#if svc.port}
      <a
        href="{window.location.protocol}//{window.location.hostname}:{svc.port}"
        target="_blank"
        rel="noopener"
        class="shrink-0 text-[11px] px-1.5 py-0.5 rounded border font-mono no-underline hover:opacity-80 {svc.running
          ? 'text-success border-success/40'
          : 'text-muted border-edge pointer-events-none'}"
      >{svc.name} :{svc.port}</a>
    {/if}
  {/each}
  {#if cursorUrl}
    <a
      href={cursorUrl}
      class="shrink-0 text-[9px] px-1.5 py-0.5 rounded border border-accent/40 text-accent font-medium no-underline hover:opacity-80"
      title="Open in Cursor"
    >Cursor</a>
    {#if showSettings && onsettings}
      <button
        type="button"
        class="shrink-0 text-[11px] px-1 py-0.5 rounded border border-accent/40 text-accent cursor-pointer bg-transparent hover:opacity-80 flex items-center"
        title="Cursor SSH settings"
        onclick={onsettings}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>
    {/if}
  {/if}
</div>
