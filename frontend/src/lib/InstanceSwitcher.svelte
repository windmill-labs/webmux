<script lang="ts">
  import { onMount } from "svelte";
  import { fetchInstances } from "./api";
  import type { InstanceSummary } from "./types";

  let { selfName }: { selfName: string } = $props();

  let instances = $state<InstanceSummary[]>([]);
  let open = $state(false);
  let triggerEl: HTMLButtonElement | undefined = $state();
  let menuEl: HTMLDivElement | undefined = $state();
  let menuRect = $state<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 0 });

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

  function positionMenu(): void {
    if (!triggerEl) return;
    const rect = triggerEl.getBoundingClientRect();
    const width = Math.max(rect.width + 80, 240);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    menuRect = { top: rect.bottom + 4, left, width };
  }

  function toggle(): void {
    if (open) {
      open = false;
      return;
    }
    void load();
    positionMenu();
    open = true;
  }

  function handleDocumentClick(event: MouseEvent): void {
    if (!open) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (triggerEl?.contains(target)) return;
    if (menuEl?.contains(target)) return;
    open = false;
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (open && event.key === "Escape") {
      open = false;
      triggerEl?.focus();
    }
  }
</script>

<svelte:window onclick={handleDocumentClick} onkeydown={handleKeydown} onresize={() => open && positionMenu()} onscroll={() => open && positionMenu()} />

{#if instances.length > 0}
  <button
    bind:this={triggerEl}
    type="button"
    class="shrink-0 h-6 w-6 inline-flex items-center justify-center rounded-md text-muted hover:bg-hover hover:text-primary"
    title="Switch project"
    aria-haspopup="menu"
    aria-expanded={open}
    onclick={toggle}
  >
    <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
      <path d="M2 4 L6 8 L10 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  </button>

  {#if open}
    <div
      bind:this={menuEl}
      role="menu"
      class="fixed z-50 rounded-md border border-edge bg-surface shadow-lg overflow-hidden"
      style="top: {menuRect.top}px; left: {menuRect.left}px; width: {menuRect.width}px;"
    >
      <div class="px-3 py-2 text-[11px] text-muted uppercase tracking-wide border-b border-edge">
        Projects
      </div>
      <div class="px-3 py-2 bg-hover/50">
        <div class="text-primary font-medium text-[12px] truncate">{selfName}</div>
        <div class="text-muted text-[10px]">current</div>
      </div>
      {#each instances as instance (instance.port)}
        <a
          href={`/${instance.prefix}`}
          class="block px-3 py-2 text-[12px] hover:bg-hover border-t border-edge"
          role="menuitem"
        >
          <div class="text-primary font-medium truncate">{instance.prefix}</div>
          <div class="text-muted text-[11px] truncate">{instance.projectDir}</div>
        </a>
      {/each}
    </div>
  {/if}
{/if}
