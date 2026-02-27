<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLButtonAttributes } from "svelte/elements";

  let {
    children,
    ...rest
  }: HTMLButtonAttributes & {
    children: Snippet;
  } = $props();
</script>

<button
  type="button"
  class="text-[11px] font-semibold text-white bg-accent border border-accent px-2.5 py-1 rounded-md cursor-pointer hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed"
  {...rest}
>
  {@render children()}
</button>
