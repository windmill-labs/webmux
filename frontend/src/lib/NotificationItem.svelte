<script lang="ts">
  import type { AppNotification } from "./types";

  let {
    notification,
    showTimestamp = false,
  }: {
    notification: AppNotification;
    showTimestamp?: boolean;
  } = $props();
</script>

<span class="shrink-0 text-sm">
  {#if notification.type === "agent_stopped"}
    <span class="text-success">&#10003;</span>
  {:else}
    <span class="text-accent">&#9741;</span>
  {/if}
</span>
<span class="flex flex-col gap-0.5 min-w-0">
  <span class="text-xs text-primary truncate">{notification.message}</span>
  {#if showTimestamp}
    <span class="text-[10px] text-muted">{new Date(notification.timestamp).toLocaleTimeString()}</span>
  {:else if notification.url}
    <span class="text-xs text-accent truncate">{notification.url}</span>
  {/if}
</span>
