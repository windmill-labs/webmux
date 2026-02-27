<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLButtonAttributes } from "svelte/elements";

  let {
    variant = "default",
    class: extraClass = "",
    children,
    ...rest
  }: HTMLButtonAttributes & {
    variant?: "default" | "cta" | "danger" | "accent-outline" | "danger-outline";
    children: Snippet;
  } = $props();

  const variants: Record<string, string> = {
    default: "",
    cta: "!bg-accent !text-white !border-accent hover:!opacity-90 disabled:!opacity-50 disabled:!cursor-not-allowed",
    danger: "!bg-danger !text-white !border-danger hover:!opacity-90 disabled:!opacity-50 disabled:!cursor-not-allowed",
    "accent-outline": "!text-accent !border-accent hover:!bg-accent/10",
    "danger-outline": "!text-danger !border-danger hover:!bg-danger/10",
  };
</script>

<button
  class="px-3 py-1.5 rounded-md border border-edge bg-surface text-primary text-xs cursor-pointer hover:bg-hover {variants[variant]} {extraClass}"
  {...rest}
>
  {@render children()}
</button>
