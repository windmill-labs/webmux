<script lang="ts">
  import { onMount } from "svelte";
  import { fetchInstances } from "./api";
  import type { InstanceSummary } from "./types";

  let instances = $state<InstanceSummary[]>([]);
  let open = $state(false);
  let containerEl: HTMLDivElement | undefined = $state();

  onMount(() => {
    void load();
  });

  async function load(): Promise<void> {
    try {
      instances = await fetchInstances();
    } catch {
      instances = [];
    }
  }

  function toggle(): void {
    if (open) {
      open = false;
      return;
    }
    void load();
    open = true;
  }

  function handleDocumentClick(event: MouseEvent): void {
    if (!open) return;
    if (!containerEl) return;
    if (event.target instanceof Node && containerEl.contains(event.target)) return;
    open = false;
  }
</script>

<svelte:window onclick={handleDocumentClick} />

{#if instances.length > 0}
  <div bind:this={containerEl} class="relative">
    <button
      type="button"
      class="h-7 px-2 rounded-md border border-edge bg-surface text-muted text-[11px] flex items-center gap-1 hover:bg-hover hover:text-primary"
      title="Switch project"
      onclick={toggle}
      aria-haspopup="listbox"
      aria-expanded={open}
    >
      <span>{instances.length} other{instances.length === 1 ? "" : "s"}</span>
      <span class="text-[9px]">▾</span>
    </button>
    {#if open}
      <div
        role="listbox"
        class="absolute z-40 right-0 mt-1 min-w-[220px] max-w-[320px] rounded-md border border-edge bg-surface shadow-lg overflow-hidden"
      >
        {#each instances as instance (instance.port)}
          <a
            href={`/${instance.prefix}`}
            class="block px-3 py-2 text-[12px] hover:bg-hover"
            role="option"
            aria-selected="false"
          >
            <div class="text-primary font-medium truncate">{instance.prefix}</div>
            <div class="text-muted text-[11px] truncate">{instance.projectDir}</div>
            <div class="text-muted text-[10px]">:{instance.port}</div>
          </a>
        {/each}
      </div>
    {/if}
  </div>
{/if}
