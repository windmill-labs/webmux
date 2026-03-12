<script lang="ts">
  import type { PrEntry, ServiceStatus } from "./types";
  import PrStatusGroup from "./PrStatusGroup.svelte";

  let {
    label,
    prs,
    services = [],
    cursorUrl = null,
    onCiClick,
    onReviewsClick,
  }: {
    label?: string;
    prs: PrEntry[];
    services?: ServiceStatus[];
    cursorUrl?: string | null;
    onCiClick: (pr: PrEntry) => void;
    onReviewsClick: (pr: PrEntry) => void;
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
  {/if}
</div>
