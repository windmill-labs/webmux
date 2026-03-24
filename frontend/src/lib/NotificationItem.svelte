<script lang="ts">
  import type { AppNotification } from "./types";

  let {
    notification,
    showTimestamp = false,
    large = false,
    wrap = false,
  }: {
    notification: AppNotification;
    showTimestamp?: boolean;
    large?: boolean;
    wrap?: boolean;
  } = $props();
</script>

<span class="shrink-0 {large ? 'text-base' : 'text-sm'}">
  {#if notification.type === "agent_stopped" || notification.type === "worktree_auto_removed"}
    <span class="text-success">&#10003;</span>
  {:else}
    <span class="text-accent">&#9741;</span>
  {/if}
</span>
<span class="flex flex-col gap-0.5 min-w-0">
  <span
    class="{large ? 'text-sm' : 'text-xs'} text-primary {wrap
      ? 'whitespace-normal break-words'
      : 'truncate'}"
  >
    {notification.message}
  </span>
  {#if showTimestamp}
    <span class="text-[10px] text-muted">{new Date(notification.timestamp).toLocaleTimeString()}</span>
  {:else if notification.url}
    <span class="text-xs text-accent {wrap ? 'whitespace-normal break-all' : 'truncate'}">
      {notification.url}
    </span>
  {/if}
</span>
