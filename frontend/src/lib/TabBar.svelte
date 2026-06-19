<script lang="ts">
  import type { WorktreeTab } from "./types";

  let { tabs, activeTabId, busy = false, oncreate, onselect, ondelete }: {
    tabs: WorktreeTab[];
    activeTabId: string | null;
    busy?: boolean;
    oncreate: () => void;
    onselect: (tabId: string) => void;
    ondelete: (tabId: string) => void;
  } = $props();
</script>

<nav class="flex items-stretch bg-topbar border-b border-edge overflow-x-auto tab-bar">
  {#each tabs as tab (tab.tabId)}
    <div
      class="flex items-center border-r border-edge {activeTabId === tab.tabId ? 'tab-active' : ''}"
    >
      <button
        type="button"
        class="px-3 py-2 text-sm font-medium whitespace-nowrap cursor-pointer border-none bg-transparent {activeTabId === tab.tabId ? 'text-accent' : 'text-muted hover:text-accent'}"
        onclick={() => onselect(tab.tabId)}
      >
        {tab.label}
      </button>
      {#if tab.kind === "fork"}
        <button
          type="button"
          aria-label={`Close ${tab.label}`}
          class="mr-1.5 flex items-center justify-center w-5 h-5 rounded text-muted cursor-pointer border-none bg-transparent hover:text-danger hover:bg-hover disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={busy}
          onclick={() => ondelete(tab.tabId)}
        >
          ×
        </button>
      {/if}
    </div>
  {/each}
  <button
    type="button"
    aria-label="New fork tab"
    title="New fork tab"
    class="px-3 py-2 text-sm text-muted cursor-pointer border-none bg-transparent hover:text-accent disabled:opacity-50 disabled:cursor-not-allowed"
    disabled={busy}
    onclick={() => oncreate()}
  >
    +
  </button>
</nav>

<style>
  .tab-active {
    box-shadow: inset 0 -2px 0 0 var(--color-accent);
  }
</style>
