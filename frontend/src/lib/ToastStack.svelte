<script lang="ts">
  import type { ToastItem, ToastTone } from "./types";

  let {
    toasts,
    ondismiss,
    onselect,
  }: {
    toasts: ToastItem[];
    ondismiss: (id: string) => void;
    onselect?: (id: string) => void;
  } = $props();

  function iconForTone(tone: ToastTone): string {
    if (tone === "success") return "\u2713";
    if (tone === "error") return "\u2717";
    return "\u2611";
  }

  function toneClass(tone: ToastTone): string {
    if (tone === "success") return "text-success";
    if (tone === "error") return "text-danger";
    return "text-accent";
  }
</script>

{#if toasts.length > 0}
  <div class="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
    {#each toasts as toast (toast.id)}
      <div
        class="toast"
        role="alert"
        style="inline-size: fit-content; max-inline-size: min(48ch, calc(100vw - 2rem));"
      >
        {#if onselect && toast.branch}
          <button
            type="button"
            class="min-w-0 flex items-start gap-2 text-left bg-transparent border-none text-inherit cursor-pointer p-0"
            onclick={() => onselect(toast.id)}
          >
            <span class="shrink-0 text-base {toneClass(toast.tone)}">{iconForTone(toast.tone)}</span>
            <span class="flex flex-col gap-0.5 min-w-0">
              <span class="text-sm text-primary whitespace-normal break-words">{toast.message}</span>
              {#if toast.detail}
                <span class="text-xs text-accent whitespace-normal break-all">{toast.detail}</span>
              {/if}
            </span>
          </button>
        {:else}
          <div class="min-w-0 flex items-start gap-2 text-inherit">
            <span class="shrink-0 text-base {toneClass(toast.tone)}">{iconForTone(toast.tone)}</span>
            <span class="flex flex-col gap-0.5 min-w-0">
              <span class="text-sm text-primary whitespace-normal break-words">{toast.message}</span>
              {#if toast.detail}
                <span class="text-xs text-accent whitespace-normal break-all">{toast.detail}</span>
              {/if}
            </span>
          </div>
        {/if}
        <button
          type="button"
          class="shrink-0 w-6 h-6 flex items-center justify-center text-muted hover:text-primary cursor-pointer bg-transparent border-none text-sm"
          onclick={() => ondismiss(toast.id)}
        >&times;</button>
      </div>
    {/each}
  </div>
{/if}

<style>
  .toast {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    padding: 0.75rem;
    border-radius: 0.5rem;
    border: 1px solid var(--color-edge);
    background: var(--color-topbar);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    animation: slide-in 0.2s ease-out;
  }

  @keyframes slide-in {
    from {
      opacity: 0;
      transform: translateX(1rem);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }
</style>
