<script lang="ts">
  import type { PrEntry } from "./types";
  import { prLabel } from "./utils";

  let { pr, clickable = false }: {
    pr: PrEntry;
    clickable?: boolean;
  } = $props();

  function badgeColor(state: string): string {
    if (state === "merged") return "bg-[#8b5cf6]/20 text-[#a78bfa]";
    if (state === "closed") return "bg-danger/20 text-danger";
    if (state === "open") return "bg-success/20 text-success";
    return "bg-muted/20 text-muted";
  }

  let label = $derived(prLabel(pr));
</script>

{#if clickable && pr.url}
  <a
    href={pr.url}
    target="_blank"
    rel="noopener"
    class="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full no-underline hover:opacity-80 {badgeColor(pr.state)}"
  >{label}</a>
{:else}
  <span class="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full {badgeColor(pr.state)}">{label}</span>
{/if}
