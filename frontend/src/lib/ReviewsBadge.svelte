<script lang="ts">
  import type { PrEntry } from "./types";

  let { pr, onclick }: {
    pr: PrEntry;
    onclick: (pr: PrEntry) => void;
  } = $props();

  let total = $derived(pr.comments.length + (pr.reviewComments?.length ?? 0));
</script>

<button
  type="button"
  class="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full flex items-center gap-1 cursor-pointer border-none hover:opacity-80 bg-accent/20 text-accent"
  onclick={(e) => { e.stopPropagation(); onclick(pr); }}
  title="Send PR comments to Claude for review"
>
  <span class="inline-block w-1.5 h-1.5 rounded-full bg-accent"></span>
  {total} {total === 1 ? 'comment' : 'comments'}
</button>
