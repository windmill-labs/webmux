<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    onclose,
    wide = false,
    className = "",
    children,
  }: {
    onclose: () => void;
    wide?: boolean;
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
  class="bg-sidebar text-primary border border-edge rounded-xl p-6 w-[90%] {wide
    ? 'max-w-[560px]'
    : 'max-w-[380px]'} {className}"
>
  {@render children()}
</dialog>
