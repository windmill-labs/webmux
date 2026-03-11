<script lang="ts">
  const { command }: { command: string } = $props();
</script>

<div class="rounded-xl border border-edge bg-sidebar px-4 py-3">
  <pre class="overflow-x-auto text-sm leading-relaxed text-accent"><code>{command}</code></pre>
</div>
