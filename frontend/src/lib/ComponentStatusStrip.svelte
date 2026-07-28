<script lang="ts">
  import type { ComponentRuntimeStatus } from "./types";

  let { components }: { components: ComponentRuntimeStatus[] } = $props();

  function statusLabel(component: ComponentRuntimeStatus): string {
    if (component.processStatus === "exited") return "Exited";
    if (component.processStatus === "stopped") return "Stopped";
    switch (component.healthStatus) {
      case "ready":
        return "Ready";
      case "starting":
        return "Starting";
      case "unhealthy":
        return "Unhealthy";
      case "unavailable":
        return "Unavailable";
    }
  }

  function statusClass(component: ComponentRuntimeStatus): string {
    if (component.healthStatus === "ready") return "text-success border-success/40";
    if (component.healthStatus === "starting") return "text-warning border-warning/40";
    if (component.healthStatus === "unhealthy" || component.processStatus === "exited") {
      return "text-danger border-danger/40";
    }
    return "text-muted border-edge";
  }

  function primaryUrl(component: ComponentRuntimeStatus): string | null {
    return Object.values(component.urls)[0] ?? null;
  }

  function primaryPort(component: ComponentRuntimeStatus): number | null {
    return Object.values(component.ports)[0] ?? null;
  }
</script>

{#if components.length > 0}
  <div
    class="flex min-h-9 items-center gap-2 overflow-x-auto border-b border-edge bg-topbar px-3 py-1.5"
    aria-label="Component status"
  >
    {#each components as component (component.id)}
      {@const url = primaryUrl(component)}
      {@const port = primaryPort(component)}
      <div
        class="flex shrink-0 items-center gap-1.5 rounded border px-2 py-1 text-[11px] {statusClass(component)}"
        title={`${component.label}: ${statusLabel(component)}`}
      >
        <span class="font-medium text-primary">{component.label}</span>
        <span>{statusLabel(component)}</span>
        {#if url && port}
          <a
            href={url}
            target="_blank"
            rel="noopener"
            class="font-mono text-inherit no-underline hover:underline"
          >:{port}</a>
        {:else if port}
          <span class="font-mono">:{port}</span>
        {/if}
      </div>
    {/each}
  </div>
{/if}
