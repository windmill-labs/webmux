<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    onclose,
    wide = false,
    maxWidth = "",
    className = "",
    children,
  }: {
    onclose: () => void;
    wide?: boolean;
    maxWidth?: string;
    className?: string;
    children: Snippet;
  } = $props();

  let dialogEl: HTMLDialogElement;

  $effect(() => {
    dialogEl?.showModal();
  });
</script>

<dialog
  bind:this={dialogEl}
  {onclose}
  onclick={(e: MouseEvent) => {
    if (e.target === dialogEl) dialogEl.close();
  }}
  class="bg-sidebar text-primary border border-edge rounded-xl w-[90%] {maxWidth
    ? ''
    : wide
      ? 'max-w-[560px]'
      : 'max-w-[380px]'} {className}"
  style:max-width={maxWidth || undefined}
>
  <div class="p-6">
    {@render children()}
  </div>
</dialog>
