<script lang="ts">
  import type { ComponentSummary } from "./types";

  let {
    components,
    selected = $bindable(),
    error = null,
  }: {
    components: ComponentSummary[];
    selected: string[];
    error?: string | null;
  } = $props();

  let search = $state("");
  let normalizedSearch = $derived(search.trim().toLowerCase());
  let filteredComponents = $derived(
    normalizedSearch
      ? components.filter((component) =>
          component.id.toLowerCase().includes(normalizedSearch)
          || component.label.toLowerCase().includes(normalizedSearch)
        )
      : components,
  );

  function toggle(componentId: string): void {
    selected = selected.includes(componentId)
      ? selected.filter((id) => id !== componentId)
      : [...selected, componentId];
  }
</script>

<div class="mb-4">
  <div class="mb-2 flex items-center justify-between gap-2">
    <label class="text-xs text-muted" for="wt-component-search">Components</label>
    <span class="text-[11px] text-muted">{selected.length} selected</span>
  </div>

  {#if error}
    <p class="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger">
      Components unavailable: {error}
    </p>
  {:else}
    <input
      id="wt-component-search"
      type="search"
      class="w-full px-2.5 py-1.5 rounded-md border border-edge bg-surface text-primary text-[13px] placeholder:text-muted/50 outline-none focus:border-accent"
      placeholder="Search services and gateways"
      bind:value={search}
    />
    <div class="mt-2 max-h-48 overflow-y-auto rounded-lg border border-edge">
      {#if filteredComponents.length === 0}
        <p class="px-3 py-4 text-center text-[12px] text-muted">
          {components.length === 0 ? "No components available." : "No matching components."}
        </p>
      {:else}
        {#each filteredComponents as component (component.id)}
          <label
            class="flex cursor-pointer items-center gap-2.5 border-b border-edge px-3 py-2.5 text-[13px] last:border-b-0 hover:bg-hover"
          >
            <input
              type="checkbox"
              checked={selected.includes(component.id)}
              onchange={() => toggle(component.id)}
              class="accent-[var(--accent)]"
            />
            <span class="min-w-0 flex-1 truncate text-primary">{component.label}</span>
            <span class="shrink-0 text-[10px] text-muted">{component.kind}</span>
          </label>
        {/each}
      {/if}
    </div>
  {/if}
</div>
