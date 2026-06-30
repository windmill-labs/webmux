<script lang="ts">
  import { onMount } from "svelte";
  import { fetchInstances } from "./api";
  import type { InstanceSummary } from "./types";

  // Other webmux servers running on this machine (migration sensor). webmux now
  // runs one multi-project server per machine, so any peer here is a leftover
  // single-project instance the user should fold in with `webmux project migrate`.
  let others = $state<InstanceSummary[]>([]);
  let dismissed = $state(false);

  const summary = $derived(others.map((other) => other.projectDir).join(", "));

  onMount(() => {
    void load();
  });

  async function load(): Promise<void> {
    try {
      others = await fetchInstances();
    } catch {
      others = [];
    }
  }
</script>

{#if others.length > 0 && !dismissed}
  <div class="flex items-start gap-3 px-4 py-2 text-[13px] bg-surface border-b border-edge text-primary">
    <div class="flex-1 min-w-0">
      <span class="text-amber-400 font-medium">
        {others.length} other webmux {others.length === 1 ? "server is" : "servers are"} running
      </span>
      <span class="text-muted">({summary}).</span>
      Consolidate {others.length === 1 ? "it" : "them"} into this dashboard — run
      <code class="text-primary">webmux project migrate</code> in your terminal.
    </div>
    <button
      type="button"
      class="shrink-0 px-1 text-muted hover:text-primary"
      aria-label="Dismiss"
      onclick={() => (dismissed = true)}
    >
      ×
    </button>
  </div>
{/if}
