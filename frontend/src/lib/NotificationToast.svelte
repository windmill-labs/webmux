<script lang="ts">
  import type { AppNotification } from "./types";
  import NotificationItem from "./NotificationItem.svelte";

  let {
    notifications,
    ondismiss,
    onselect,
  }: {
    notifications: AppNotification[];
    ondismiss: (id: number) => void;
    onselect: (branch: string) => void;
  } = $props();
</script>

{#if notifications.length > 0}
  <div class="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
    {#each notifications as n (n.id)}
      <div class="toast" role="alert">
        <button
          type="button"
          class="flex-1 flex items-center gap-2 text-left bg-transparent border-none text-inherit cursor-pointer p-0"
          onclick={() => { ondismiss(n.id); onselect(n.branch); }}
        >
          <NotificationItem notification={n} />
        </button>
        <button
          type="button"
          class="shrink-0 w-6 h-6 flex items-center justify-center text-muted hover:text-primary cursor-pointer bg-transparent border-none text-sm"
          onclick={() => ondismiss(n.id)}
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
