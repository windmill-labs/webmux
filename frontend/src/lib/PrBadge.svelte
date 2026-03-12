<script lang="ts">
  import type { PrEntry } from "./types";
  import { prBadgeClass, prLabel } from "./utils";

  let { pr, clickable = false }: {
    pr: PrEntry;
    clickable?: boolean;
  } = $props();

  let label = $derived(prLabel(pr));
</script>

{#if clickable && pr.url}
  <a
    href={pr.url}
    target="_blank"
    rel="noopener"
    class="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full no-underline hover:opacity-80 {prBadgeClass(pr.state)}"
  >{label}</a>
{:else}
  <span class="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full {prBadgeClass(pr.state)}">{label}</span>
{/if}
