<script lang="ts">
  import { fetchMobileScrollSnapshot } from "./api";
  import type { MobileScrollSnapshot } from "./types";
  import { errorMessage } from "./utils";

  let { worktree, pane, active = true }: {
    worktree: string;
    pane: number;
    active?: boolean;
  } = $props();

  const ATTACH_WAIT_MESSAGE = "Waiting for the live terminal session...";
  const ATTACH_RETRY_DELAY_MS = 350;

  let snapshot = $state<MobileScrollSnapshot | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let retryTimer = $state<ReturnType<typeof setTimeout> | null>(null);
  let requestToken = 0;

  function clearRetry(): void {
    if (!retryTimer) return;
    clearTimeout(retryTimer);
    retryTimer = null;
  }

  function isAttachPendingError(message: string): boolean {
    return message === "Terminal session is not attached";
  }

  function sourceLabel(source: MobileScrollSnapshot["source"]): string {
    return source === "alternate" ? "Alternate screen" : "Scrollback";
  }

  async function loadSnapshot(nextWorktree: string, nextPane: number, reason: string): Promise<void> {
    const token = ++requestToken;
    clearRetry();
    if (reason !== "refresh") {
      snapshot = null;
    }
    loading = true;
    error = null;

    try {
      const nextSnapshot = await fetchMobileScrollSnapshot(nextWorktree, nextPane);
      if (token !== requestToken) return;
      snapshot = nextSnapshot;
    } catch (err: unknown) {
      if (token !== requestToken) return;
      const message = errorMessage(err);
      if (isAttachPendingError(message) && active) {
        error = ATTACH_WAIT_MESSAGE;
        retryTimer = setTimeout(() => {
          retryTimer = null;
          void loadSnapshot(nextWorktree, nextPane, "retry");
        }, ATTACH_RETRY_DELAY_MS);
      } else {
        error = message;
      }
    } finally {
      if (token === requestToken) {
        loading = false;
      }
    }
  }

  function handleRefresh(): void {
    void loadSnapshot(worktree, pane, "refresh");
  }

  $effect(() => {
    if (!active) {
      clearRetry();
      requestToken += 1;
      return;
    }

    const nextWorktree = worktree;
    const nextPane = pane;
    void loadSnapshot(nextWorktree, nextPane, "effect");

    return () => {
      requestToken += 1;
      clearRetry();
    };
  });
</script>

<div class="flex h-full min-h-0 flex-col bg-surface">
  <div class="flex items-center justify-between gap-3 border-b border-edge px-3 py-2">
    <div class="min-w-0">
      <p class="text-xs font-medium text-primary">Scroll Snapshot</p>
      <p class="truncate text-[11px] text-muted">
        {snapshot ? sourceLabel(snapshot.source) : "Read-only pane capture"}
      </p>
    </div>
    <button
      type="button"
      class="shrink-0 rounded-md border border-edge bg-sidebar px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-topbar disabled:cursor-not-allowed disabled:opacity-50"
      onclick={handleRefresh}
      disabled={loading}
    >
      {loading ? "Refreshing..." : "Refresh"}
    </button>
  </div>

  <div class="min-h-0 flex-1 overflow-auto bg-sidebar/35">
    {#if snapshot}
      <pre class="min-h-full min-w-max select-text px-3 py-3 font-mono text-[12px] leading-5 text-primary">{snapshot.content || "No terminal output yet."}</pre>
    {:else if loading}
      <div class="flex h-full items-center justify-center px-6 text-center text-sm text-muted">
        Loading terminal snapshot...
      </div>
    {:else}
      <div class="flex h-full items-center justify-center px-6 text-center text-sm text-muted">
        {error ?? "No terminal output yet."}
      </div>
    {/if}
  </div>

  <div class="border-t border-edge px-3 py-2 text-[11px] text-muted">
    Scroll mode is read-only. Switch to Interact to type into the live session.
  </div>
</div>
