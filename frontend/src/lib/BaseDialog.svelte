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
  let pressStartedOnBackdrop = false;

  $effect(() => {
    dialogEl?.showModal();
  });
</script>

<dialog
  bind:this={dialogEl}
  {onclose}
  onmousedown={(e: MouseEvent) => {
    pressStartedOnBackdrop = e.target === dialogEl;
  }}
  onclick={(e: MouseEvent) => {
    if (e.target === dialogEl && pressStartedOnBackdrop) dialogEl.close();
    pressStartedOnBackdrop = false;
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
