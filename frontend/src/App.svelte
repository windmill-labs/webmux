<script lang="ts">
  import { onMount } from "svelte";
  import ConfirmDialog from "./lib/ConfirmDialog.svelte";
  import CreateWorktreeDialog from "./lib/CreateWorktreeDialog.svelte";
  import SettingsDialog from "./lib/SettingsDialog.svelte";
  import CiDetailsDialog from "./lib/CiDetailsDialog.svelte";
  import CommentReviewDialog from "./lib/CommentReviewDialog.svelte";
  import DiffDialog from "./lib/DiffDialog.svelte";
  import SessionPanel from "./lib/SessionPanel.svelte";
  import NotificationToast from "./lib/NotificationToast.svelte";
  import LinearDetailDialog from "./lib/LinearDetailDialog.svelte";
  import WorktreeSidebar from "./lib/WorktreeSidebar.svelte";
  import type {
    AvailableBranch,
    AppConfig,
    AppNotification,
    LinearIssue,
    MobileAppScreen,
    PrEntry,
    TerminalController,
    TerminalInteractionMode,
    WorktreeCreateMode,
    WorktreeInfo,
  } from "./lib/types";
  import {
    SSH_STORAGE_KEY,
    applyTheme,
    errorMessage,
    loadSavedSelectedWorktree,
    loadSavedTheme,
    resolveSelectedBranch,
    saveSelectedWorktree,
    loadSavedSidebarWidth,
    saveSidebarWidth,
  } from "./lib/utils";
  import { getTheme } from "./lib/themes";
  import type { ThemeKey } from "./lib/themes";
  import * as api from "./lib/api";

  let config = $state<AppConfig>({
    services: [],
    profiles: [],
    defaultProfileName: "",
    autoName: false,
    linkedRepos: [],
  });
  let worktrees = $state<WorktreeInfo[]>([]);
  let selectedBranch = $state<string | null>(loadSavedSelectedWorktree());
  let hasLoadedWorktrees = $state(false);
  let removeBranch = $state<string | null>(null);
  let mergeBranch = $state<string | null>(null);
  let removingBranches = $state<Set<string>>(new Set());
  let showCreateDialog = $state(false);
  let showSettingsDialog = $state(false);
  let ciDetailsPr = $state<PrEntry | null>(null);
  let commentReviewPr = $state<PrEntry | null>(null);
  let showDiffDialog = $state(false);
  let pendingCreateCount = $state(0);
  let latestAutoSelectCreateId = -1;
  let nextCreateRequestId = 0;
  let nextBranchFetchId = 0;
  let sshHost = $state(localStorage.getItem(SSH_STORAGE_KEY) ?? "");
  let currentTheme = $state<ThemeKey>(loadSavedTheme());
  let terminalTheme = $derived(getTheme(currentTheme).terminal);
  let applyPollInterval: ((intervalMs: number) => void) | null = null;
  let pendingCreateBranchHint = $state<string | null>(null);
  let availableBranches = $state<AvailableBranch[]>([]);
  let availableBranchesLoading = $state(false);
  let availableBranchesError = $state<string | null>(null);

  // Linear integration
  let linearIssues = $state<LinearIssue[]>([]);
  let assignIssue = $state<LinearIssue | null>(null);
  let detailIssue = $state<LinearIssue | null>(null);
  let linearLastFetch = 0;
  const LINEAR_THROTTLE_MS = 300_000;
  const DEFAULT_POLL_INTERVAL_MS = 5000;
  const ACTIVE_CREATE_POLL_INTERVAL_MS = 1000;

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

  // Sidebar resize
  const MIN_SIDEBAR_WIDTH = 140;
  const MAX_SIDEBAR_WIDTH = 500;
  const SIDEBAR_KEYBOARD_STEP = 10;
  let sidebarWidth = $state(
    Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, loadSavedSidebarWidth())),
  );
  let isResizingSidebar = $state(false);

  function clampSidebarWidth(w: number): number {
    return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, w));
  }

  function handleResizeStart(e: PointerEvent) {
    e.preventDefault();
    isResizingSidebar = true;
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    function onPointerMove(ev: PointerEvent) {
      sidebarWidth = clampSidebarWidth(startWidth + ev.clientX - startX);
    }

    function onPointerUp() {
      isResizingSidebar = false;
      saveSidebarWidth(sidebarWidth);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }

  function handleResizeKeydown(e: KeyboardEvent) {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const delta = e.key === "ArrowRight" ? SIDEBAR_KEYBOARD_STEP : -SIDEBAR_KEYBOARD_STEP;
      sidebarWidth = clampSidebarWidth(sidebarWidth + delta);
      saveSidebarWidth(sidebarWidth);
    }
  }

  // Mobile state
  let isMobile = $state(false);
  let mobileScreen = $state<MobileAppScreen>("session");
  let terminalInteractionMode = $state<TerminalInteractionMode>("interact");
  let activePane = $state(0);
  let terminalRef = $state<TerminalController | undefined>();

  // Safety buffer after backend confirms paste-buffer completion.
  // paste-buffer exits once tmux has queued the data, but the PTY write
  // may not be fully flushed yet — this small delay lets it settle.
  const ENTER_DELAY_MS = 200;

  let openingBranches = $state<Set<string>>(new Set());
  let visibleWorktrees = $derived(worktrees);
  let creatingWorktrees = $derived(visibleWorktrees.filter((w) => w.creating));
  let backendCreatingCount = $derived(visibleWorktrees.filter((w) => w.creating).length);
  let activeCreateCount = $derived(Math.max(pendingCreateCount, backendCreatingCount));
  let hasCreatingWorktrees = $derived(activeCreateCount > 0);
  let selectableWorktrees = $derived(
    visibleWorktrees.filter((w) => !removingBranches.has(w.branch)),
  );
  let createIndicatorLabel = $derived(
    activeCreateCount === 1 ? "Creating..." : `Creating ${activeCreateCount}...`,
  );
  let selectedWorktree = $derived(
    selectedBranch && !removingBranches.has(selectedBranch)
      ? visibleWorktrees.find((w) => w.branch === selectedBranch)
      : undefined,
  );
  let canConnect = $derived(!!selectedBranch && selectedWorktree?.mux === "✓" && !selectedWorktree?.creating);
  let isSelectedOpening = $derived(selectedBranch ? openingBranches.has(selectedBranch) : false);
  let pollIntervalMs = $derived(
    hasCreatingWorktrees ? ACTIVE_CREATE_POLL_INTERVAL_MS : DEFAULT_POLL_INTERVAL_MS,
  );

  $effect(() => {
    const nextSelectedBranch = resolveSelectedBranch(
      selectedBranch,
      selectedWorktree,
      selectableWorktrees,
      hasLoadedWorktrees,
    );
    if (nextSelectedBranch !== selectedBranch) {
      selectedBranch = nextSelectedBranch;
    }
  });

  $effect(() => {
    if (pendingCreateCount === 0 || latestAutoSelectCreateId === -1) return;
    const target = pendingCreateBranchHint
      ? visibleWorktrees.find((w) => w.branch === pendingCreateBranchHint)
      : creatingWorktrees.length === 1
        ? creatingWorktrees[0]
        : undefined;
    if (!target) return;
    selectedBranch = target.branch;
    if (isMobile) mobileScreen = "session";
  });

  $effect(() => {
    applyPollInterval?.(pollIntervalMs);
  });

  $effect(() => {
    if (!hasLoadedWorktrees) return;
    if (selectedWorktree) {
      saveSelectedWorktree(selectedWorktree.branch);
      return;
    }
    if (selectableWorktrees.length === 0) {
      saveSelectedWorktree(null);
    }
  });

  $effect(() => {
    if (!showCreateDialog) return;

    const fetchId = ++nextBranchFetchId;
    availableBranches = [];
    availableBranchesLoading = true;
    availableBranchesError = null;

    api.fetchAvailableBranches()
      .then((branches) => {
        if (fetchId !== nextBranchFetchId) return;
        availableBranches = branches;
      })
      .catch((err: unknown) => {
        if (fetchId !== nextBranchFetchId) return;
        availableBranchesError = errorMessage(err);
      })
      .finally(() => {
        if (fetchId !== nextBranchFetchId) return;
        availableBranchesLoading = false;
      });
  });

  $effect(() => {
    document.title = config.name ? `${config.name} - Dashboard` : "Dev Dashboard";
  });

  $effect(() => {
    const paneCount = selectedWorktree?.paneCount ?? 0;
    if (paneCount === 0) {
      if (activePane !== 0) activePane = 0;
      return;
    }
    if (activePane > paneCount - 1) {
      activePane = 0;
    }
  });

  $effect(() => {
    if (isMobile && mobileScreen === "session" && !selectedWorktree) {
      mobileScreen = "worktrees";
    }
  });

  let paneBarPanes = $derived.by(() => {
    const count = selectedWorktree?.paneCount ?? 0;
    if (count < 2) return [];
    return Array.from({ length: count }, (_, i) => ({
      index: i,
      label: String(i + 1),
    }));
  });

  function showMobileSession(): void {
    if (isMobile) mobileScreen = "session";
  }

  function showMobileWorktrees(): void {
    if (isMobile) mobileScreen = "worktrees";
  }

  function markBranchRead(branch: string): void {
    notifiedBranches = new Set([...notifiedBranches].filter((x) => x !== branch));
  }

  function selectWorktree(branch: string): void {
    selectedBranch = branch;
    markBranchRead(branch);
    showMobileSession();
  }

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
      hasLoadedWorktrees = true;
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
    mode: WorktreeCreateMode,
    name: string,
    profile: string,
    agent: string,
    prompt: string,
    envOverrides: Record<string, string>,
  ) {
    const requestId = nextCreateRequestId++;
    const shouldAutoSelectCreatedWorktree = selectedWorktree == null;
    if (shouldAutoSelectCreatedWorktree) {
      latestAutoSelectCreateId = requestId;
    }
    pendingCreateCount += 1;
    if (shouldAutoSelectCreatedWorktree) {
      pendingCreateBranchHint = name || null;
    }
    showCreateDialog = false;
    assignIssue = null;

    try {
      const createPromise = api.createWorktree(
        mode,
        name || undefined,
        profile,
        agent,
        prompt || undefined,
        Object.keys(envOverrides).length > 0 ? envOverrides : undefined,
      );
      void refresh();
      const result = await createPromise;
      if (shouldAutoSelectCreatedWorktree) {
        pendingCreateBranchHint = result.branch;
      }
      await refresh();
      if (shouldAutoSelectCreatedWorktree && requestId === latestAutoSelectCreateId) {
        selectedBranch = result.branch;
        showMobileSession();
      }
    } catch (err) {
      alert(`Failed to create: ${errorMessage(err)}`);
    } finally {
      pendingCreateCount = Math.max(0, pendingCreateCount - 1);
      if (shouldAutoSelectCreatedWorktree && requestId === latestAutoSelectCreateId) {
        pendingCreateBranchHint = null;
        latestAutoSelectCreateId = -1;
      }
    }
  }

  function selectNeighborOf(branch: string) {
    if (selectedBranch !== branch) return;
    const idx = visibleWorktrees.findIndex((w) => w.branch === branch);
    const previous = visibleWorktrees[idx - 1];
    const next = visibleWorktrees[idx + 1];
    const neighbor = [previous, next].find((candidate) =>
      candidate
      && !removingBranches.has(candidate.branch)
    );
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

  async function openSelectedWorktree(): Promise<void> {
    const branch = selectedBranch;
    if (!branch) return;
    openingBranches = new Set([...openingBranches, branch]);
    try {
      await api.openWorktree(branch);
      await refresh();
    } catch (err) {
      alert(`Failed to open worktree: ${errorMessage(err)}`);
    } finally {
      openingBranches = new Set([...openingBranches].filter((x) => x !== branch));
    }
  }

  async function handleClose() {
    const branch = selectedBranch;
    if (!branch) return;
    selectNeighborOf(branch);
    try {
      await api.closeWorktree(branch);
      await refresh();
    } catch (err) {
      alert(`Failed to close worktree: ${errorMessage(err)}`);
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
      showMobileSession();
      return;
    }
    const idx = selectable.findIndex((w) => w.branch === selectedBranch);
    const next = idx + direction;
    if (next >= 0 && next < selectable.length) {
      selectedBranch = selectable[next].branch;
      showMobileSession();
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
      showCreateDialog = true;
    } else if (e.key === "m" || e.key === "M") {
      e.preventDefault();
      if (selectedBranch) mergeBranch = selectedBranch;
    } else if (e.key === "d" || e.key === "D") {
      e.preventDefault();
      if (selectedBranch) removeBranch = selectedBranch;
    } else if (e.key === "Enter") {
      if (selectedWorktree && selectedWorktree.mux !== "✓" && !selectedWorktree.creating && !isSelectedOpening) {
        e.preventDefault();
        openSelectedWorktree();
      }
    }
  }

  function handlePaneSelect(pane: number) {
    activePane = pane;
    terminalRef?.sendSelectPane(pane);
  }

  function handleTerminalInteractionModeChange(mode: TerminalInteractionMode): void {
    terminalInteractionMode = mode;
  }

  onMount(() => {
    applyTheme(currentTheme);
    api
      .fetchConfig()
      .then((c) => {
        config = c;
      })
      .catch(() => {});
    refresh();
    refreshLinear();
    let intervalMs = pollIntervalMs;
    let interval: ReturnType<typeof setInterval> | undefined;
    window.addEventListener("keydown", handleKeydown);
    let unsubNotifications = api.subscribeNotifications(handleNotification, handleSseDismiss, handleInitialNotification);
    // Request notification permission (no-op if already granted/denied)
    if (Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }

    // Pause polling when tab is hidden or idle (no interaction for 60s).
    let idleTimer: ReturnType<typeof setTimeout>;
    let idle = false;

    function startPolling(): void {
      if (interval) clearInterval(interval);
      if (document.hidden || idle) return;
      interval = setInterval(refresh, intervalMs);
    }

    applyPollInterval = (nextIntervalMs: number): void => {
      if (intervalMs === nextIntervalMs) return;
      intervalMs = nextIntervalMs;
      startPolling();
    };
    startPolling();

    function resetIdleTimer(): void {
      if (idle) {
        idle = false;
        refresh();
        startPolling();
      }
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        idle = true;
        if (interval) clearInterval(interval);
      }, 60_000);
    }

    document.addEventListener("click", resetIdleTimer);
    document.addEventListener("keydown", resetIdleTimer);
    resetIdleTimer();

    function onVisibilityChange(): void {
      if (document.hidden) {
        if (interval) clearInterval(interval);
      } else {
        resetIdleTimer();
        refresh();
        startPolling();
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    const mq = window.matchMedia("(max-width: 768px)");
    isMobile = mq.matches;
    mobileScreen = mq.matches && selectedBranch ? "session" : "worktrees";
    terminalInteractionMode = mq.matches ? "scroll" : "interact";
    function onMqChange(e: MediaQueryListEvent): void {
      isMobile = e.matches;
      mobileScreen = e.matches && selectedBranch ? "session" : "worktrees";
      terminalInteractionMode = e.matches ? "scroll" : "interact";
    }
    mq.addEventListener("change", onMqChange);

    return () => {
      if (interval) clearInterval(interval);
      applyPollInterval = null;
      clearTimeout(idleTimer);
      document.removeEventListener("click", resetIdleTimer);
      document.removeEventListener("keydown", resetIdleTimer);
      window.removeEventListener("keydown", handleKeydown);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      mq.removeEventListener("change", onMqChange);
      unsubNotifications();
    };
  });
</script>

{#if isMobile}
  <div class="flex h-dvh flex-col bg-surface text-primary">
    <div class="flex flex-1 min-h-0 overflow-hidden">
      {#if mobileScreen === "worktrees"}
        <WorktreeSidebar
          appName={config.name}
          {activeCreateCount}
          {createIndicatorLabel}
          worktrees={visibleWorktrees}
          selected={selectedBranch}
          removing={removingBranches}
          initializing={openingBranches}
          {notifiedBranches}
          {linearIssues}
          isMobile={true}
          oncreate={() => (showCreateDialog = true)}
          onselect={selectWorktree}
          onremove={(branch) => (removeBranch = branch)}
          onassignissue={handleAssignIssue}
          onselectissue={(issue) => (detailIssue = issue)}
        />
      {:else}
        <SessionPanel
          bind:terminalRef
          {selectedBranch}
          {selectedWorktree}
          {canConnect}
          {isSelectedOpening}
          isMobile={true}
          {sshHost}
          linkedRepos={config.linkedRepos ?? []}
          {notificationHistory}
          {unreadCount}
          {terminalTheme}
          {activePane}
          {paneBarPanes}
          {terminalInteractionMode}
          onshowworktrees={showMobileWorktrees}
          onclose={handleClose}
          onmerge={() => {
            if (selectedBranch) mergeBranch = selectedBranch;
          }}
          onremove={() => {
            if (selectedBranch) removeBranch = selectedBranch;
          }}
          onsettings={() => (showSettingsDialog = true)}
          ondirtyclick={() => (showDiffDialog = true)}
          onCiClick={(pr) => (ciDetailsPr = pr)}
          onReviewsClick={(pr) => (commentReviewPr = pr)}
          onbellopen={handleBellOpen}
          onnotificationselect={selectWorktree}
          onopensession={openSelectedWorktree}
          onselectpane={handlePaneSelect}
          oninteractionmodechange={handleTerminalInteractionModeChange}
        />
      {/if}
    </div>

    <nav class="shrink-0 border-t border-edge bg-topbar px-3 pt-2" style="padding-bottom: env(safe-area-inset-bottom, 0px);">
      <div class="flex gap-2">
        <button
          type="button"
          class="flex-1 rounded-md px-3 py-2 text-sm font-medium {mobileScreen === 'worktrees'
            ? 'bg-surface text-primary'
            : 'text-muted hover:text-primary'}"
          onclick={showMobileWorktrees}
        >
          Worktrees
        </button>
        <button
          type="button"
          class="flex-1 rounded-md px-3 py-2 text-sm font-medium {mobileScreen === 'session'
            ? 'bg-surface text-primary'
            : 'text-muted hover:text-primary'} disabled:cursor-not-allowed disabled:opacity-50"
          onclick={showMobileSession}
          disabled={!selectedWorktree}
        >
          Session
        </button>
      </div>
    </nav>
  </div>
{:else}
  <div class="flex h-dvh bg-surface text-primary {isResizingSidebar ? 'select-none' : ''}" style={isResizingSidebar ? 'cursor: col-resize' : ''}>
    <aside class="flex shrink-0 overflow-hidden border-r border-edge" style={`width: ${sidebarWidth}px`}>
      <WorktreeSidebar
        appName={config.name}
        {activeCreateCount}
        {createIndicatorLabel}
        worktrees={visibleWorktrees}
        selected={selectedBranch}
        removing={removingBranches}
        initializing={openingBranches}
        {notifiedBranches}
        {linearIssues}
        oncreate={() => (showCreateDialog = true)}
        onselect={selectWorktree}
        onremove={(branch) => (removeBranch = branch)}
        onassignissue={handleAssignIssue}
        onselectissue={(issue) => (detailIssue = issue)}
      />
    </aside>

    <button
      type="button"
      class="w-1 shrink-0 cursor-col-resize border-none bg-transparent p-0 transition-colors hover:bg-accent/50"
      class:bg-accent={isResizingSidebar}
      onpointerdown={handleResizeStart}
      onkeydown={handleResizeKeydown}
      aria-label="Resize worktree sidebar"
    ></button>

    <main class="flex flex-1 min-w-0 overflow-hidden">
      <SessionPanel
        bind:terminalRef
        {selectedBranch}
        {selectedWorktree}
        {canConnect}
        {isSelectedOpening}
        {sshHost}
        linkedRepos={config.linkedRepos ?? []}
        {notificationHistory}
        {unreadCount}
        {terminalTheme}
        {activePane}
        {paneBarPanes}
        terminalInteractionMode="interact"
        onclose={handleClose}
        onmerge={() => {
          if (selectedBranch) mergeBranch = selectedBranch;
        }}
        onremove={() => {
          if (selectedBranch) removeBranch = selectedBranch;
        }}
        onsettings={() => (showSettingsDialog = true)}
        ondirtyclick={() => (showDiffDialog = true)}
        onCiClick={(pr) => (ciDetailsPr = pr)}
        onReviewsClick={(pr) => (commentReviewPr = pr)}
        onbellopen={handleBellOpen}
        onnotificationselect={selectWorktree}
        onopensession={openSelectedWorktree}
        onselectpane={handlePaneSelect}
        oninteractionmodechange={handleTerminalInteractionModeChange}
      />
    </main>
  </div>
{/if}

{#if showCreateDialog}
  <CreateWorktreeDialog
    profiles={config.profiles}
    defaultProfileName={config.defaultProfileName}
    autoNameEnabled={config.autoName}
    initialBranch={assignIssue?.branchName ?? ""}
    initialPrompt={assignIssue ? `${assignIssue.title}${assignIssue.description ? '\n\n' + assignIssue.description : ''}` : ""}
    {availableBranches}
    {availableBranchesLoading}
    {availableBranchesError}
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
    {currentTheme}
    onthemechange={(key) => (currentTheme = key)}
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

{#if showDiffDialog && selectedBranch}
  <DiffDialog
    branch={selectedBranch}
    onclose={() => (showDiffDialog = false)}
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
  onselect={selectWorktree}
/>
