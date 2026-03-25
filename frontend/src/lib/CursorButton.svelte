<script lang="ts">
  let { url }: { url: string } = $props();
</script>

<a
  href={url}
  class="shrink-0 text-[9px] px-1.5 py-0.5 rounded border border-accent/40 text-accent font-medium no-underline hover:opacity-80"
  title="Open in Cursor"
>Cursor</a>
