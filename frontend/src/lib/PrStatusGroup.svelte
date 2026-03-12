<script lang="ts">
  import type { PrEntry } from "./types";
  import {
    ciStatusDotClass,
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

  const segmentClass =
    "relative flex items-center gap-1.5 bg-transparent px-2.5 py-1.5 transition-colors cursor-pointer hover:bg-hover active:bg-active focus-visible:z-10 focus-visible:bg-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent";
  const dividedSegmentClass = `${segmentClass} border-l border-edge`;
</script>

<div
  class="shrink-0 inline-flex min-w-0 items-stretch overflow-hidden rounded-full border text-[10px] font-medium leading-none {prStatusShellClass(pr)}"
>
  <a
    href={pr.url}
    target="_blank"
    rel="noopener"
    class="{segmentClass} min-w-0 no-underline {prStateTextClass(pr.state)}"
    title="Open PR"
  >
    <span class="truncate">{label}</span>
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M7 17 17 7" />
      <path d="M7 7h10v10" />
    </svg>
  </a>

  {#if hasCi}
    <button
      type="button"
      class="{dividedSegmentClass} {ciStatusTextClass(pr.ciStatus)}"
      onclick={(e) => {
        e.stopPropagation();
        onciclick(pr);
      }}
      title="View CI checks"
      aria-label={`View CI checks for ${label}`}
    >
      <span class="inline-block h-1.5 w-1.5 rounded-full {ciStatusDotClass(pr.ciStatus)}"></span>
      <span class="uppercase tracking-[0.08em] text-[9px]">CI</span>
    </button>
  {/if}

  {#if hasComments}
    <button
      type="button"
      class="{dividedSegmentClass} text-accent"
      onclick={(e) => {
        e.stopPropagation();
        onreviewsclick(pr);
      }}
      title="Review PR comments"
      aria-label={`Review ${pr.comments.length} comments for ${label}`}
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
