<script lang="ts">
  import ToastStack from "./ToastStack.svelte";
  import type { AppNotification, ToastItem } from "./types";

  let {
    notifications,
    ondismiss,
    onselect,
  }: {
    notifications: AppNotification[];
    ondismiss: (id: number) => void;
    onselect: (branch: string) => void;
  } = $props();

  let toasts = $derived(
    notifications.map(
      (notification): ToastItem => ({
        id: String(notification.id),
        tone: notification.type === "runtime_error"
          ? "error"
          : notification.type === "agent_stopped" || notification.type === "worktree_auto_removed"
            ? "success"
            : "info",
        message: notification.message,
        ...(notification.url ? { detail: notification.url } : {}),
        branch: notification.branch,
      }),
    ),
  );
</script>

<ToastStack
  {toasts}
  ondismiss={(id) => ondismiss(Number(id))}
  onselect={(id) => {
    const toast = toasts.find((item) => item.id === id);
    if (toast?.branch) {
      ondismiss(Number(id));
      onselect(toast.branch);
    }
  }}
/>
