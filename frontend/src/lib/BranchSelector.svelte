<script lang="ts">
  import type { AvailableBranch } from "./types";
  import { searchMatch } from "./utils";

  let {
    label,
    selected = "",
    branches = [],
    loading = false,
    error = null,
    placeholder = "Select a branch",
    initialOpen = false,
    onselect,
  }: {
    label: string;
    selected?: string;
    branches?: AvailableBranch[];
    loading?: boolean;
    error?: string | null;
    placeholder?: string;
    initialOpen?: boolean;
    onselect: (branch: string) => void;
  } = $props();

  let selectorOpen = $state(false);
  let searchQuery = $state("");
  let fieldEl = $state<HTMLDivElement | undefined>(undefined);
  let searchEl = $state<HTMLInputElement | undefined>(undefined);
  let autoOpened = $state(false);
  let autoFocused = $state(false);

  let filteredBranches = $derived(
    searchQuery.trim()
      ? branches.filter((branch) => searchMatch(searchQuery, branch.name))
      : branches,
  );

  $effect(() => {
    if (!initialOpen || autoOpened) return;
    autoOpened = true;
    selectorOpen = true;
  });

  $effect(() => {
    if (!selectorOpen || autoFocused) return;
    autoFocused = true;
    focusSearch();
  });

  function focusSearch(): void {
    queueMicrotask(() => searchEl?.focus());
  }

  function closeSelector(): void {
    selectorOpen = false;
    searchQuery = "";
    autoFocused = false;
  }

  function toggleSelector(): void {
    if (selectorOpen) {
      closeSelector();
      return;
    }
    selectorOpen = true;
  }

  function selectBranch(name: string): void {
    onselect(name);
    closeSelector();
  }

  function handleFocusOut(event: FocusEvent): void {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && fieldEl?.contains(nextTarget)) {
      return;
    }
    closeSelector();
  }
</script>

<div bind:this={fieldEl} onfocusout={handleFocusOut}>
  <span class="block text-xs text-muted mb-1.5">{label}</span>
  <button
    type="button"
    class="flex w-full items-center justify-between gap-3 rounded-md border border-edge bg-surface px-2.5 py-1.5 text-left text-[13px] text-primary outline-none transition-colors hover:bg-hover focus:border-accent"
    aria-label={label}
    aria-expanded={selectorOpen}
    onclick={toggleSelector}
  >
    <span class={selected ? "font-mono" : "text-muted/50"}>
      {selected || placeholder}
    </span>
    <span class="text-[11px] text-muted">{selectorOpen ? "▴" : "▾"}</span>
  </button>
  {#if selectorOpen}
    <div class="mt-2 rounded-lg border border-edge bg-surface/60">
      <div class="border-b border-edge p-2">
        <input
          bind:this={searchEl}
          type="text"
          class="w-full rounded-md border border-edge bg-surface px-2.5 py-1.5 text-[12px] text-primary placeholder:text-muted/50 outline-none focus:border-accent"
          aria-label={`${label} search`}
          placeholder="Search branches..."
          bind:value={searchQuery}
          onkeydown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (filteredBranches[0]) {
                selectBranch(filteredBranches[0].name);
              }
            }
            if (event.key === "Escape") {
              event.preventDefault();
              closeSelector();
            }
          }}
        />
      </div>
      {#if loading}
        <p class="px-3 py-2 text-xs text-muted">Loading branches...</p>
      {:else if error}
        <p class="px-3 py-2 text-xs text-muted">Failed to load branches: {error}</p>
      {:else if filteredBranches.length === 0}
        <p class="px-3 py-2 text-xs text-muted">No matching branches</p>
      {:else}
        <div class="border-b border-edge px-3 py-2 text-[11px] text-muted">
          {filteredBranches.length !== branches.length
            ? `${filteredBranches.length}/${branches.length}`
            : branches.length}
          {" "}available
        </div>
        <ul class="max-h-48 overflow-y-auto py-1">
          {#each filteredBranches as branch (branch.name)}
            <li>
              <button
                type="button"
                class="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[12px] transition-colors hover:bg-hover
                  {selected === branch.name ? 'bg-accent/10' : ''}"
                onclick={() => selectBranch(branch.name)}
              >
                <span class="font-mono text-primary">{branch.name}</span>
                {#if selected === branch.name}
                  <span class="text-[10px] text-accent">Selected</span>
                {/if}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</div>
