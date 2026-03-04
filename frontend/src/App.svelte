<script lang="ts">
  import { onMount } from "svelte";
  import WorktreeList from "./lib/WorktreeList.svelte";
  import TopBar from "./lib/TopBar.svelte";
  import Terminal from "./lib/Terminal.svelte";
  import ConfirmDialog from "./lib/ConfirmDialog.svelte";
  import CreateWorktreeDialog from "./lib/CreateWorktreeDialog.svelte";
  import SettingsDialog from "./lib/SettingsDialog.svelte";
  import CiDetailsDialog from "./lib/CiDetailsDialog.svelte";
  import CommentReviewDialog from "./lib/CommentReviewDialog.svelte";
  import PaneBar from "./lib/PaneBar.svelte";
  import NotificationToast from "./lib/NotificationToast.svelte";
  import LinearPanel from "./lib/LinearPanel.svelte";
  import LinearDetailDialog from "./lib/LinearDetailDialog.svelte";
  import type { WorktreeInfo, AppConfig, AppNotification, PrEntry, LinearIssue } from "./lib/types";
  import { SSH_STORAGE_KEY, errorMessage } from "./lib/utils";
  import * as api from "./lib/api";

  let config = $state<AppConfig>({
    services: [],
    profiles: { default: { name: "default" } },
    autoName: false,
  });
  let worktrees = $state<WorktreeInfo[]>([]);
  let selectedBranch = $state<string | null>(null);
  let removeBranch = $state<string | null>(null);
  let mergeBranch = $state<string | null>(null);
  let removingBranches = $state<Set<string>>(new Set());
  let showCreateDialog = $state(false);
  let showSettingsDialog = $state(false);
  let ciDetailsPr = $state<PrEntry | null>(null);
  let commentReviewPr = $state<PrEntry | null>(null);
  let creating = $state(false);
  let sshHost = $state(localStorage.getItem(SSH_STORAGE_KEY) ?? "");

  // Linear integration
  let linearIssues = $state<LinearIssue[]>([]);
  let assignIssue = $state<LinearIssue | null>(null);
  let detailIssue = $state<LinearIssue | null>(null);
  let linearLastFetch = 0;
  const LINEAR_THROTTLE_MS = 300_000;

  // Notifications
  let notifications = $state<AppNotification[]>([]);
  let notificationHistory = $state<AppNotification[]>([]);
  let unreadCount = $state(0);
  const AUTO_DISMISS_MS = 4000;
  const MAX_HISTORY = 10;

  let notifiedBranches = $state<Set<string>>(new Set());

  function handleNotification(n: AppNotification): void {
    notifications = [...notifications, n];
    notifiedBranches = new Set([...notifiedBranches, n.branch]);
    notificationHistory = [n, ...notificationHistory].slice(0, MAX_HISTORY);
    unreadCount++;
    // Auto-dismiss after timeout
    setTimeout(() => {
      notifications = notifications.filter((x) => x.id !== n.id);
    }, AUTO_DISMISS_MS);
    // Browser notification when tab is hidden
    if (document.hidden && Notification.permission === "granted") {
      new Notification(n.message, { body: n.url ?? n.branch, tag: `wm-${n.id}` });
    }
  }

  function handleInitialNotification(n: AppNotification): void {
    if (notificationHistory.some((x) => x.id === n.id)) return;
    notificationHistory = [n, ...notificationHistory].slice(0, MAX_HISTORY);
  }

  function handleDismissNotification(id: number): void {
    notifications = notifications.filter((n) => n.id !== id);
    api.dismissNotification(id).catch(() => {});
  }

  function handleSseDismiss(id: number): void {
    notifications = notifications.filter((n) => n.id !== id);
  }

  function handleBellOpen(): void {
    unreadCount = 0;
  }

  // Mobile state
  let isMobile = $state(false);
  let sidebarOpen = $state(false);
  let activePane = $state(0);
  let terminalRef:
    | {
        sendSelectPane: (pane: number) => void;
        sendInput: (data: string) => void;
      }
    | undefined = $state();

  // Safety buffer after backend confirms paste-buffer completion.
  // paste-buffer exits once tmux has queued the data, but the PTY write
  // may not be fully flushed yet — this small delay lets it settle.
  const ENTER_DELAY_MS = 200;

  let openingBranches = $state<Set<string>>(new Set());
  let visibleWorktrees = $derived(worktrees);
  let selectedWorktree = $derived(
    visibleWorktrees.find((w) => w.branch === selectedBranch),
  );
  let canConnect = $derived(!!selectedBranch && selectedWorktree?.mux === "✓");

  $effect(() => {
    if (!selectedBranch && visibleWorktrees.length > 0) {
      // Prefer an open worktree, fall back to the first one
      const open = visibleWorktrees.find((w) => w.mux === "✓");
      selectedBranch = (open ?? visibleWorktrees[0]).branch;
    }
  });

  $effect(() => {
    document.title = config.name ? `${config.name} - Dashboard` : "Dev Dashboard";
  });

  let paneBarPanes = $derived.by(() => {
    const count = selectedWorktree?.paneCount ?? 0;
    if (count < 2) return [];
    return Array.from({ length: count }, (_, i) => ({
      index: i,
      label: String(i + 1),
    }));
  });
  let showPaneBar = $derived(isMobile && canConnect && paneBarPanes.length > 0);

  function refreshLinear(): void {
    const now = Date.now();
    if (now - linearLastFetch < LINEAR_THROTTLE_MS) return;
    linearLastFetch = now;
    api.fetchLinearIssues().then((data) => {
      linearIssues = data;
    }).catch((err: unknown) => console.warn("[linear]", err));
  }

  async function refresh() {
    try {
      worktrees = await api.fetchWorktrees();
    } catch (err) {
      console.error("Failed to refresh:", err);
    }
    refreshLinear();
  }

  function handleAssignIssue(issue: LinearIssue): void {
    assignIssue = issue;
    showCreateDialog = true;
  }

  async function handleCreate(
    name: string,
    profile: string,
    agent: string,
    prompt: string,
    envOverrides: Record<string, string>,
  ) {
    creating = true;
    try {
      const result = await api.createWorktree(
        name || undefined,
        profile,
        agent,
        prompt || undefined,
        Object.keys(envOverrides).length > 0 ? envOverrides : undefined,
      );
      await api.openWorktree(result.branch);
      showCreateDialog = false;
      assignIssue = null;
      await refresh();
      selectedBranch = result.branch;
      if (isMobile) sidebarOpen = false;
    } catch (err) {
      alert(`Failed to create: ${errorMessage(err)}`);
    } finally {
      creating = false;
    }
  }

  function selectNeighborOf(branch: string) {
    if (selectedBranch !== branch) return;
    const idx = visibleWorktrees.findIndex((w) => w.branch === branch);
    const neighbor = visibleWorktrees[idx - 1] ?? visibleWorktrees[idx + 1];
    selectedBranch = neighbor ? neighbor.branch : null;
  }

  async function handleRemove() {
    const branch = removeBranch;
    if (!branch) return;
    removeBranch = null;
    selectNeighborOf(branch);

    removingBranches = new Set([...removingBranches, branch]);
    try {
      await api.removeWorktree(branch);
      await refresh();
    } catch (err) {
      alert(`Failed to remove: ${errorMessage(err)}`);
    } finally {
      removingBranches = new Set(
        [...removingBranches].filter((b) => b !== branch),
      );
    }
  }

  async function handleMerge() {
    const branch = mergeBranch;
    if (!branch) return;
    mergeBranch = null;
    selectNeighborOf(branch);

    removingBranches = new Set([...removingBranches, branch]);
    try {
      await api.mergeWorktree(branch);
      await refresh();
    } catch (err) {
      alert(`Failed to merge: ${errorMessage(err)}`);
    } finally {
      removingBranches = new Set(
        [...removingBranches].filter((b) => b !== branch),
      );
    }
  }

  function selectNeighborWorktree(direction: -1 | 1) {
    const selectable = visibleWorktrees.filter(
      (w) => !removingBranches.has(w.branch),
    );
    if (selectable.length === 0) return;
    if (!selectedBranch) {
      selectedBranch =
        selectable[direction === 1 ? 0 : selectable.length - 1].branch;
      return;
    }
    const idx = selectable.findIndex((w) => w.branch === selectedBranch);
    const next = idx + direction;
    if (next >= 0 && next < selectable.length) {
      selectedBranch = selectable[next].branch;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    // Ignore shortcuts when a dialog is open (let dialog handle its own keys)
    if (showCreateDialog || removeBranch || mergeBranch) return;

    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;

    if (e.key === "ArrowUp") {
      e.preventDefault();
      selectNeighborWorktree(-1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      selectNeighborWorktree(1);
    } else if (e.key === "k" || e.key === "K") {
      e.preventDefault();
      if (!creating) showCreateDialog = true;
    } else if (e.key === "m" || e.key === "M") {
      e.preventDefault();
      if (selectedBranch) mergeBranch = selectedBranch;
    } else if (e.key === "d" || e.key === "D") {
      e.preventDefault();
      if (selectedBranch) removeBranch = selectedBranch;
    }
  }

  function handlePaneSelect(pane: number) {
    activePane = pane;
    terminalRef?.sendSelectPane(pane);
  }

  onMount(() => {
    api
      .fetchConfig()
      .then((c) => {
        config = c;
      })
      .catch(() => {});
    refresh();
    refreshLinear();
    let interval = setInterval(refresh, 5000);
    window.addEventListener("keydown", handleKeydown);
    let unsubNotifications = api.subscribeNotifications(handleNotification, handleSseDismiss, handleInitialNotification);
    // Request notification permission (no-op if already granted/denied)
    if (Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }

    // Pause polling when tab is hidden to reduce server load.
    function onVisibilityChange(): void {
      if (document.hidden) {
        clearInterval(interval);
      } else {
        refresh();
        interval = setInterval(refresh, 5000);
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    const mq = window.matchMedia("(max-width: 768px)");
    isMobile = mq.matches;
    if (isMobile) sidebarOpen = true;
    function onMqChange(e: MediaQueryListEvent): void {
      isMobile = e.matches;
    }
    mq.addEventListener("change", onMqChange);

    return () => {
      clearInterval(interval);
      window.removeEventListener("keydown", handleKeydown);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      mq.removeEventListener("change", onMqChange);
      unsubNotifications();
    };
  });
</script>

<div class="flex h-dvh bg-surface text-primary">
  <!-- Sidebar: fixed overlay on mobile, static on desktop -->
  {#if !isMobile || sidebarOpen}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    {#if isMobile}
      <div
        class="fixed inset-0 bg-black/50 z-40"
        onclick={() => (sidebarOpen = false)}
        onkeydown={(e) => {
          if (e.key === "Escape") sidebarOpen = false;
        }}
      ></div>
    {/if}
    <aside
      class="{isMobile
        ? 'fixed inset-0 z-50 w-full'
        : 'w-[220px] min-w-[220px]'} bg-sidebar border-r border-edge flex flex-col overflow-hidden"
    >
      <div class="flex items-center justify-between p-4 border-b border-edge">
        <h1 class="text-base font-semibold">{config.name ?? "Dashboard"}</h1>
        <div class="flex items-center gap-2">
          <button
            class="h-8 px-2 gap-1.5 rounded-md border border-edge bg-surface text-accent text-xs flex items-center justify-center cursor-pointer hover:bg-hover disabled:opacity-50 disabled:cursor-not-allowed"
            onclick={() => (showCreateDialog = true)}
            disabled={creating}
            title="New Worktree (Cmd+K)"
            ><span class="text-lg leading-none">+</span> New</button
          >
          {#if isMobile}
            <button
              class="h-8 w-8 rounded-md border border-edge bg-surface text-muted text-sm flex items-center justify-center cursor-pointer hover:bg-hover"
              onclick={() => (sidebarOpen = false)}
              title="Close sidebar">&times;</button
            >
          {/if}
        </div>
      </div>
      <WorktreeList
        worktrees={visibleWorktrees}
        selected={selectedBranch}
        removing={removingBranches}
        initializing={openingBranches}
        {notifiedBranches}
        onselect={async (b) => {
          selectedBranch = b;
          notifiedBranches = new Set([...notifiedBranches].filter((x) => x !== b));
          if (isMobile) sidebarOpen = false;
          // Open closed worktrees on click
          const wt = worktrees.find((w) => w.branch === b);
          if (wt && wt.mux !== "✓") {
            openingBranches = new Set([...openingBranches, b]);
            try {
              await api.openWorktree(b);
              await refresh();
            } catch (err) {
              alert(`Failed to open worktree: ${errorMessage(err)}`);
            } finally {
              openingBranches = new Set([...openingBranches].filter((x) => x !== b));
            }
          }
        }}
        onremove={(b) => (removeBranch = b)}
      />
      {#if linearIssues.length > 0}
        <LinearPanel issues={linearIssues} onassign={handleAssignIssue} onselect={(issue) => (detailIssue = issue)} />
      {/if}
      {#if !isMobile}
        <div
          class="shrink-0 border-t border-edge px-4 py-3 text-[11px] text-muted flex flex-col gap-1"
        >
          <div class="flex justify-between">
            <span>Navigate</span><kbd class="opacity-60">Cmd+Up/Down</kbd>
          </div>
          <div class="flex justify-between">
            <span>New worktree</span><kbd class="opacity-60">Cmd+K</kbd>
          </div>
          <div class="flex justify-between">
            <span>Merge</span><kbd class="opacity-60">Cmd+M</kbd>
          </div>
          <div class="flex justify-between">
            <span>Remove</span><kbd class="opacity-60">Cmd+D</kbd>
          </div>
        </div>
      {/if}
    </aside>
  {/if}

  <main class="flex-1 min-w-0 flex flex-col overflow-hidden">
    <TopBar
      name={selectedBranch}
      worktree={selectedWorktree}
      {sshHost}
      {isMobile}
      {notificationHistory}
      {unreadCount}
      ontogglesidebar={() => (sidebarOpen = !sidebarOpen)}
      onmerge={() => {
        if (selectedBranch) mergeBranch = selectedBranch;
      }}
      onremove={() => {
        if (selectedBranch) removeBranch = selectedBranch;
      }}
      onsettings={() => (showSettingsDialog = true)}
      onciclick={(pr) => (ciDetailsPr = pr)}
      onreviewsclick={(pr) => (commentReviewPr = pr)}
      onbellopen={handleBellOpen}
      onnotificationselect={(branch) => {
        selectedBranch = branch;
        notifiedBranches = new Set([...notifiedBranches].filter((x) => x !== branch));
        if (isMobile) sidebarOpen = false;
      }}
    />

    {#if canConnect}
      {#key selectedBranch}
        <Terminal
          worktree={selectedBranch!}
          {isMobile}
          initialPane={isMobile ? activePane : undefined}
          bind:this={terminalRef}
        />
      {/key}
    {:else}
      <div class="flex-1 flex items-center justify-center text-muted text-sm">
        <p>Select a worktree from the sidebar to connect</p>
      </div>
    {/if}

    {#if showPaneBar}
      <PaneBar {activePane} panes={paneBarPanes} onselect={handlePaneSelect} />
    {/if}
  </main>
</div>

{#if showCreateDialog}
  <CreateWorktreeDialog
    loading={creating}
    profiles={[
      config.profiles.default,
      ...(config.profiles.sandbox ? [config.profiles.sandbox] : []),
    ]}
    initialBranch={assignIssue?.branchName ?? ""}
    initialPrompt={assignIssue ? `${assignIssue.title}${assignIssue.description ? '\n\n' + assignIssue.description : ''}` : ""}
    startupEnvs={config.startupEnvs ?? {}}
    oncreate={handleCreate}
    oncancel={() => { showCreateDialog = false; assignIssue = null; }}
  />
{/if}

{#if removeBranch}
  <ConfirmDialog
    message={`Remove worktree "${removeBranch}"? This action cannot be undone.`}
    onconfirm={handleRemove}
    oncancel={() => (removeBranch = null)}
  />
{/if}

{#if mergeBranch}
  <ConfirmDialog
    message={`Merge worktree "${mergeBranch}" into main? The worktree will be removed after merging.`}
    confirmLabel="Merge"
    variant="accent"
    onconfirm={handleMerge}
    oncancel={() => (mergeBranch = null)}
  />
{/if}

{#if showSettingsDialog}
  <SettingsDialog
    onsave={(host) => {
      sshHost = host;
      showSettingsDialog = false;
    }}
    onclose={() => (showSettingsDialog = false)}
  />
{/if}

{#if ciDetailsPr}
  <CiDetailsDialog
    pr={ciDetailsPr}
    branch={selectedWorktree?.branch ?? ""}
    onclose={() => (ciDetailsPr = null)}
    onfixsuccess={() => {
      ciDetailsPr = null;
      setTimeout(() => terminalRef?.sendInput("\r"), ENTER_DELAY_MS);
    }}
  />
{/if}

{#if commentReviewPr}
  <CommentReviewDialog
    pr={commentReviewPr}
    branch={selectedWorktree?.branch ?? ""}
    onclose={() => (commentReviewPr = null)}
    onsendsuccess={() => {
      commentReviewPr = null;
      setTimeout(() => terminalRef?.sendInput("\r"), ENTER_DELAY_MS);
    }}
  />
{/if}

{#if detailIssue}
  <LinearDetailDialog
    issue={detailIssue}
    onassign={(issue) => { detailIssue = null; handleAssignIssue(issue); }}
    onclose={() => (detailIssue = null)}
  />
{/if}

<NotificationToast
  {notifications}
  ondismiss={handleDismissNotification}
  onselect={(branch) => {
    selectedBranch = branch;
    notifiedBranches = new Set([...notifiedBranches].filter((x) => x !== branch));
    if (isMobile) sidebarOpen = false;
  }}
/>
