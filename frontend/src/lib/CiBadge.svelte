<script lang="ts">
  import type { PrEntry } from "./types";

  let { pr, onclick }: {
    pr: PrEntry;
    onclick: (pr: PrEntry) => void;
  } = $props();

  function badgeClass(ciStatus: string): string {
    if (ciStatus === "failed") return "bg-danger/20 text-danger";
    if (ciStatus === "success") return "bg-success/20 text-success";
    if (ciStatus === "pending") return "bg-warning/20 text-warning";
    return "bg-muted/20 text-muted";
  }

  function dotClass(ciStatus: string): string {
    if (ciStatus === "failed") return "bg-danger";
    if (ciStatus === "success") return "bg-success";
    if (ciStatus === "pending") return "bg-warning animate-pulse";
    return "bg-muted";
  }

</script>

<button
  type="button"
  class="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full flex items-center gap-1 cursor-pointer border-none hover:opacity-80 {badgeClass(pr.ciStatus)}"
  onclick={(e) => { e.stopPropagation(); onclick(pr); }}
  title="View CI checks"
>
  <span class="inline-block w-1.5 h-1.5 rounded-full {dotClass(pr.ciStatus)}"></span>
  CI
</button>
