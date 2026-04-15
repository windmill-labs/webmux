<script lang="ts">
  import type { PrEntry } from "@webmux/api-contract";
  import type { AgentsUiConversationState, AgentsUiWorktreeSummary, ServiceStatus } from "../types";

  interface Props {
    projectName: string;
    worktree: AgentsUiWorktreeSummary | null;
    conversation: AgentsUiConversationState | null;
    conversationError: string | null;
    conversationLoading: boolean;
    isSending: boolean;
    isMobile: boolean;
    onPrimaryAction: () => void;
    onToggleSidebar: () => void;
  }

  const {
    projectName,
    worktree,
    conversation,
    conversationError,
    conversationLoading,
    isSending,
    isMobile,
    onPrimaryAction,
    onToggleSidebar,
  }: Props = $props();

  function truncateLabel(value: string | null, maxLength: number): string | null {
    if (!value || value.length <= maxLength) return value;
    return `${value.slice(0, maxLength - 3)}...`;
  }

  function serviceHref(service: ServiceStatus): string | null {
    if (service.url) return service.url;
    if (service.port === null) return null;
    return `${window.location.protocol}//${window.location.hostname}:${service.port}`;
  }

  function prLabel(pr: Pick<PrEntry, "repo" | "number">): string {
    return pr.repo ? `${pr.repo} #${pr.number}` : `PR #${pr.number}`;
  }

  function prBadgeClass(state: PrEntry["state"]): string {
    if (state === "merged") return "bg-merged/20 text-merged";
    if (state === "closed") return "bg-danger/20 text-danger";
    return "bg-success/20 text-success";
  }

  const chatAvailable = $derived(worktree?.agentName === "codex" || worktree?.agentName === "claude");
  const title = $derived(truncateLabel(worktree?.branch ?? null, 30) ?? "Select a worktree");
  const subtitle = $derived(
    worktree
      ? `${worktree.agentName ?? "unassigned"} · ${
        conversation?.running ? "turn in progress" : conversationLoading ? "connecting" : "ready"
      }`
      : projectName,
  );
  const primaryActionLabel = $derived(
    !chatAvailable
      ? null
      : conversation?.running
        ? "Interrupt"
        : conversationError || !conversation
          ? conversation ? "Reconnect" : "Attach"
          : null,
  );
  const primaryActionClass = $derived(
    conversation?.running
      ? "border-danger text-danger bg-surface hover:bg-danger/10"
      : "border-edge text-primary bg-surface hover:bg-hover",
  );
  const primaryActionDisabled = $derived(
    conversationLoading || isSending || !chatAvailable,
  );
  const visibleServices = $derived(
    (worktree?.services ?? []).filter((service) => service.port !== null),
  );
  const visiblePrs = $derived(worktree?.prs ?? []);
</script>

<div class="flex min-h-12 items-stretch border-b border-edge bg-topbar">
  <div class="flex min-w-0 flex-1 flex-col justify-center gap-1 px-4 py-2.5">
    <div class="flex min-w-0 items-center gap-3">
      {#if isMobile}
        <button
          type="button"
          class="-ml-1 border-none bg-transparent p-1 text-muted hover:text-primary"
          onclick={onToggleSidebar}
          title="Toggle sidebar"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
      {/if}

      <span class="truncate text-sm font-semibold" title={worktree?.branch ?? undefined}>
        {title}
      </span>
    </div>

    <div class="truncate text-[11px] text-muted">{subtitle}</div>

    {#if visibleServices.length > 0}
      <div class="flex flex-wrap items-center gap-1.5 pt-1">
        {#each visiblePrs as pr (`${pr.repo}#${pr.number}`)}
          <a
            href={pr.url}
            target="_blank"
            rel="noopener"
            class={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium no-underline hover:opacity-80 ${prBadgeClass(pr.state)}`}
          >
            {prLabel(pr)}
          </a>
        {/each}

        {#each visibleServices as service (`${service.name}:${service.port}`)}
          {@const href = serviceHref(service)}
          <a
            href={href ?? undefined}
            target="_blank"
            rel="noopener"
            class={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-mono no-underline transition ${
              service.running && href
                ? "border-success/40 text-success hover:opacity-80"
                : "pointer-events-none border-edge text-muted"
            }`}
          >
            {service.name}:{service.port}
          </a>
        {/each}
      </div>
    {:else if visiblePrs.length > 0}
      <div class="flex flex-wrap items-center gap-1.5 pt-1">
        {#each visiblePrs as pr (`${pr.repo}#${pr.number}`)}
          <a
            href={pr.url}
            target="_blank"
            rel="noopener"
            class={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium no-underline hover:opacity-80 ${prBadgeClass(pr.state)}`}
          >
            {prLabel(pr)}
          </a>
        {/each}
      </div>
    {/if}
  </div>

  <div class="flex shrink-0 items-center gap-2 px-4">
    {#if primaryActionLabel}
      <button
        type="button"
        class={`rounded-md border px-3 py-1.5 text-xs font-medium transition ${primaryActionClass}`}
        onclick={onPrimaryAction}
        disabled={primaryActionDisabled}
      >
        {primaryActionLabel}
      </button>
    {/if}
  </div>
</div>
