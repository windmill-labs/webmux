<script lang="ts">
  import type { PrEntry } from "./types";
  import {
    ciStatusDotClass,
    ciStatusLabel,
    ciStatusTextClass,
    prLabel,
    prStateTextClass,
    prStatusShellClass,
  } from "./utils";

  let {
    pr,
    onciclick,
    onreviewsclick,
  }: {
    pr: PrEntry;
    onciclick: (pr: PrEntry) => void;
    onreviewsclick: (pr: PrEntry) => void;
  } = $props();

  let label = $derived(prLabel(pr));
  let hasCi = $derived(pr.ciChecks.length > 0);
  let hasComments = $derived(pr.comments.length > 0);
</script>

<div
  class="shrink-0 inline-flex min-w-0 items-stretch overflow-hidden rounded-full border text-[10px] font-medium leading-none {prStatusShellClass(pr)}"
>
  <a
    href={pr.url}
    target="_blank"
    rel="noopener"
    class="flex min-w-0 items-center gap-1.5 px-2.5 py-1.5 no-underline transition-colors hover:bg-hover/80 {prStateTextClass(pr.state)}"
    title="Open PR"
  >
    <span class="truncate">{label}</span>
  </a>

  {#if hasCi}
    <button
      type="button"
      class="flex items-center gap-1.5 border-l border-edge/80 bg-transparent px-2 py-1.5 transition-colors hover:bg-hover/80 {ciStatusTextClass(pr.ciStatus)}"
      onclick={(e) => {
        e.stopPropagation();
        onciclick(pr);
      }}
      title="View CI checks"
    >
      <span class="inline-block h-1.5 w-1.5 rounded-full {ciStatusDotClass(pr.ciStatus)}"></span>
      <span>{ciStatusLabel(pr.ciStatus)}</span>
    </button>
  {/if}

  {#if hasComments}
    <button
      type="button"
      class="flex items-center gap-1.5 border-l border-edge/80 bg-transparent px-2 py-1.5 text-accent transition-colors hover:bg-hover/80"
      onclick={(e) => {
        e.stopPropagation();
        onreviewsclick(pr);
      }}
      title="Review PR comments"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
      <span>{pr.comments.length}</span>
    </button>
  {/if}
</div>
