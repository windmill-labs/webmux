<script lang="ts">
  import { fetchBootstrap } from "./lib/api";
  import type { AgentsUiBootstrapResponse, AgentsUiWorktreeSummary } from "./lib/types";

  let bootstrap = $state<AgentsUiBootstrapResponse | null>(null);
  let errorMessage = $state<string | null>(null);
  let isLoading = $state(true);
  let selectedBranch = $state<string | null>(null);
  let hasRequestedBootstrap = false;

  const selectedWorktree = $derived(
    bootstrap?.worktrees.find((worktree) => worktree.branch === selectedBranch) ?? null,
  );
  const activeCount = $derived(bootstrap?.worktrees.filter((worktree) => !worktree.archived).length ?? 0);
  const codexCount = $derived(
    bootstrap?.worktrees.filter((worktree) => worktree.agentName === "codex").length ?? 0,
  );

  async function loadBootstrap(): Promise<void> {
    isLoading = true;
    errorMessage = null;

    try {
      const nextBootstrap = await fetchBootstrap();
      bootstrap = nextBootstrap;
      if (!selectedBranch || !nextBootstrap.worktrees.some((worktree) => worktree.branch === selectedBranch)) {
        selectedBranch = nextBootstrap.worktrees[0]?.branch ?? null;
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    } finally {
      isLoading = false;
    }
  }

  function selectWorktree(branch: string): void {
    selectedBranch = branch;
  }

  function describeWorktree(worktree: AgentsUiWorktreeSummary): string {
    if (worktree.creating && worktree.creationPhase) return `Creating: ${worktree.creationPhase}`;
    if (worktree.agentName === "codex" && worktree.conversation) return "Conversation mapped";
    if (worktree.agentName === "codex") return "Conversation pending discovery";
    return "Terminal-only for now";
  }

  $effect(() => {
    if (hasRequestedBootstrap) return;
    hasRequestedBootstrap = true;
    void loadBootstrap();
  });
</script>

<svelte:head>
  <title>Webmux Agents</title>
</svelte:head>

<div class="min-h-screen text-[var(--color-ink)]">
  <div class="mx-auto flex min-h-screen max-w-[96rem] flex-col px-4 py-5 md:px-6">
    <header class="mb-5 rounded-[2rem] border border-[var(--color-line)] bg-[var(--color-panel)]/90 px-5 py-5 shadow-[0_18px_70px_rgba(66,40,18,0.08)] backdrop-blur">
      <div class="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div class="space-y-2">
          <p class="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--color-accent)]">Phase 1</p>
          <div>
            <h1 class="font-serif text-3xl leading-none md:text-5xl">Agents Workspace</h1>
            <p class="mt-2 max-w-2xl text-sm text-[var(--color-muted)] md:text-base">
              Separate conversation surface for worktrees. This scaffold uses the shared backend and the new
              `agents` bootstrap contract only.
            </p>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3 md:min-w-[22rem]">
          <div class="rounded-[1.4rem] border border-[var(--color-line)] bg-[var(--color-paper)] px-4 py-3">
            <div class="text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-[var(--color-muted)]">
              Active worktrees
            </div>
            <div class="mt-2 text-2xl font-semibold">{activeCount}</div>
          </div>
          <div class="rounded-[1.4rem] border border-[var(--color-line)] bg-[var(--color-paper)] px-4 py-3">
            <div class="text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-[var(--color-muted)]">
              Codex lanes
            </div>
            <div class="mt-2 text-2xl font-semibold">{codexCount}</div>
          </div>
        </div>
      </div>
    </header>

    <main class="grid flex-1 gap-4 md:grid-cols-[22rem_minmax(0,1fr)]">
      <section class="rounded-[2rem] border border-[var(--color-line)] bg-[var(--color-panel)]/95 p-4 shadow-[0_12px_40px_rgba(66,40,18,0.06)]">
        <div class="mb-4 flex items-center justify-between">
          <div>
            <div class="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-muted)]">Project</div>
            <div class="mt-1 text-lg font-semibold">{bootstrap?.project.name ?? "Loading project"}</div>
          </div>

          <button
            class="rounded-full border border-[var(--color-line)] bg-[var(--color-paper)] px-4 py-2 text-sm font-medium transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
            onclick={() => void loadBootstrap()}
            disabled={isLoading}
          >
            {isLoading ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        {#if errorMessage}
          <div class="rounded-[1.2rem] border border-[var(--color-accent)]/30 bg-[var(--color-accent-soft)] px-4 py-3 text-sm text-[var(--color-ink)]">
            {errorMessage}
          </div>
        {:else if !bootstrap}
          <div class="rounded-[1.2rem] border border-dashed border-[var(--color-line)] bg-[var(--color-paper)] px-4 py-6 text-sm text-[var(--color-muted)]">
            Loading worktrees…
          </div>
        {:else}
          <div class="space-y-2">
            {#each bootstrap.worktrees as worktree (worktree.branch)}
              <button
                class={`block w-full rounded-[1.3rem] border px-4 py-4 text-left transition ${
                  selectedBranch === worktree.branch
                    ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]/60"
                    : "border-[var(--color-line)] bg-[var(--color-paper)] hover:border-[var(--color-accent)]/40"
                }`}
                onclick={() => selectWorktree(worktree.branch)}
              >
                <div class="flex items-start justify-between gap-3">
                  <div>
                    <div class="text-sm font-semibold">{worktree.branch}</div>
                    <div class="mt-1 text-xs uppercase tracking-[0.16em] text-[var(--color-muted)]">
                      {worktree.agentName ?? "unassigned"} / {worktree.profile ?? "no-profile"}
                    </div>
                  </div>
                  <span class="rounded-full border border-[var(--color-line)] px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-[var(--color-muted)]">
                    {worktree.status}
                  </span>
                </div>
                <p class="mt-3 text-sm text-[var(--color-muted)]">{describeWorktree(worktree)}</p>
              </button>
            {/each}
          </div>
        {/if}
      </section>

      <section class="rounded-[2rem] border border-[var(--color-line)] bg-[var(--color-panel)]/95 p-5 shadow-[0_12px_40px_rgba(66,40,18,0.06)]">
        {#if selectedWorktree}
          <div class="flex h-full flex-col gap-5">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div class="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-muted)]">
                  Selected worktree
                </div>
                <h2 class="mt-1 font-serif text-3xl leading-none">{selectedWorktree.branch}</h2>
              </div>

              <div class="rounded-[1.2rem] border border-[var(--color-line)] bg-[var(--color-paper)] px-4 py-3 text-sm">
                <div class="font-medium">Main branch</div>
                <div class="text-[var(--color-muted)]">{bootstrap?.project.mainBranch ?? "main"}</div>
              </div>
            </div>

            <div class="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
              <article class="rounded-[1.6rem] border border-[var(--color-line)] bg-[var(--color-paper)] p-4">
                <div class="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-muted)]">
                  Conversation lane
                </div>
                {#if selectedWorktree.conversation}
                  <div class="mt-4 space-y-3 text-sm">
                    <div>
                      <div class="font-medium">Provider</div>
                      <div class="text-[var(--color-muted)]">{selectedWorktree.conversation.provider}</div>
                    </div>
                    <div>
                      <div class="font-medium">Thread</div>
                      <div class="break-all text-[var(--color-muted)]">{selectedWorktree.conversation.threadId}</div>
                    </div>
                    <div>
                      <div class="font-medium">Workspace cwd</div>
                      <div class="break-all text-[var(--color-muted)]">{selectedWorktree.conversation.cwd}</div>
                    </div>
                  </div>
                {:else}
                  <p class="mt-4 max-w-xl text-sm text-[var(--color-muted)]">
                    No persisted conversation is mapped yet. Phase 2 will discover or resume the Codex thread for this
                    worktree through `codex app-server`.
                  </p>
                {/if}
              </article>

              <article class="rounded-[1.6rem] border border-[var(--color-line)] bg-[var(--color-paper)] p-4">
                <div class="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-muted)]">
                  Worktree state
                </div>
                <dl class="mt-4 grid gap-3 text-sm">
                  <div class="flex items-center justify-between gap-3">
                    <dt class="text-[var(--color-muted)]">Dirty</dt>
                    <dd class={selectedWorktree.dirty ? "text-[var(--color-accent)]" : "text-[var(--color-success)]"}>
                      {selectedWorktree.dirty ? "Yes" : "No"}
                    </dd>
                  </div>
                  <div class="flex items-center justify-between gap-3">
                    <dt class="text-[var(--color-muted)]">Unpushed</dt>
                    <dd class={selectedWorktree.unpushed ? "text-[var(--color-warning)]" : "text-[var(--color-success)]"}>
                      {selectedWorktree.unpushed ? "Yes" : "No"}
                    </dd>
                  </div>
                  <div class="flex items-center justify-between gap-3">
                    <dt class="text-[var(--color-muted)]">Archived</dt>
                    <dd>{selectedWorktree.archived ? "Yes" : "No"}</dd>
                  </div>
                </dl>
              </article>
            </div>

            <article class="rounded-[1.6rem] border border-[var(--color-line)] bg-[var(--color-paper)] p-4">
              <div class="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-muted)]">
                Services
              </div>

              {#if selectedWorktree.services.length === 0}
                <p class="mt-3 text-sm text-[var(--color-muted)]">No tracked services for this worktree.</p>
              {:else}
                <div class="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {#each selectedWorktree.services as service (service.name)}
                    <div class="rounded-[1.2rem] border border-[var(--color-line)] bg-[var(--color-panel)] px-4 py-3">
                      <div class="flex items-center justify-between gap-3">
                        <div class="font-medium">{service.name}</div>
                        <span class={service.running ? "text-[var(--color-success)]" : "text-[var(--color-muted)]"}>
                          {service.running ? "running" : "stopped"}
                        </span>
                      </div>
                      <div class="mt-1 text-sm text-[var(--color-muted)]">
                        {service.port === null ? "No port" : `Port ${service.port}`}
                      </div>
                    </div>
                  {/each}
                </div>
              {/if}
            </article>
          </div>
        {:else}
          <div class="flex h-full min-h-[28rem] items-center justify-center rounded-[1.6rem] border border-dashed border-[var(--color-line)] bg-[var(--color-paper)] p-6 text-center text-[var(--color-muted)]">
            Select a worktree to inspect its future conversation lane.
          </div>
        {/if}
      </section>
    </main>
  </div>
</div>
