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
  import DiffDialog from "./lib/DiffDialog.svelte";
  import PaneBar from "./lib/PaneBar.svelte";
  import NotificationToast from "./lib/NotificationToast.svelte";
  import LinearPanel from "./lib/LinearPanel.svelte";
  import LinearDetailDialog from "./lib/LinearDetailDialog.svelte";
  import CursorButton from "./lib/CursorButton.svelte";
  import type {
    AvailableBranch,
    AppConfig,
    AppNotification,
    CreateWorktreeRequest,
    PrEntry,
    LinearIssueAvailability,
    LinearIssue,
    WorktreeInfo,
  } from "./lib/types";
  import {
    SSH_STORAGE_KEY,
    makeCursorUrl,
    errorMessage,
    worktreeCreationPhaseLabel,
    loadSavedTheme,
    loadSavedSelectedWorktree,
    saveSelectedWorktree,
    resolveSelectedBranch,
    applyTheme,
    loadSavedSidebarWidth,
    saveSidebarWidth,
  } from "./lib/utils";
  import { buildWorktreeListRows } from "./lib/worktree-list";
  import { getTheme } from "./lib/themes";
  import type { ThemeKey } from "./lib/themes";
  import * as api from "./lib/api";

  let config = $state<AppConfig>({
    services: [],
    profiles: [],
    defaultProfileName: "",
    autoName: false,
    linearCreateTicketOption: false,
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
  let pullMainConfirm = $state(false);
  let pullMainLoading = $state(false);
  let pullMainError = $state("");
  let pullMainForce = $state(false);
  let pullLinkedRepoAlias = $state<string | null>(null);
  let pullLinkedRepoLoading = $state(false);
  let pullLinkedRepoError = $state("");
  let pullLinkedRepoForce = $state(false);
  let pendingCreateCount = $state(0);
  let latestAutoSelectCreateId = -1;
  let nextCreateRequestId = 0;
  let nextAvailableBranchFetchId = 0;
  let nextBaseBranchFetchId = 0;
  let sshHost = $state(localStorage.getItem(SSH_STORAGE_KEY) ?? "");
  let currentTheme = $state<ThemeKey>(loadSavedTheme());
  let terminalTheme = $derived(getTheme(currentTheme).terminal);
  let applyPollInterval: ((intervalMs: number) => void) | null = null;
  let pendingCreateBranchHint = $state<string | null>(null);
  let availableBranches = $state<AvailableBranch[]>([]);
  let availableBranchesLoading = $state(false);
  let availableBranchesError = $state<string | null>(null);
  let baseBranches = $state<AvailableBranch[]>([]);
  let baseBranchesLoading = $state(false);
  let baseBranchesError = $state<string | null>(null);
  let includeRemoteBranches = $state(false);
  type BranchCacheKey = "local" | "remote";
  let availableBranchCache: Partial<Record<BranchCacheKey, AvailableBranch[]>> = {};
  let availableBranchRequests: Partial<Record<BranchCacheKey, Promise<AvailableBranch[]>>> = {};
  let baseBranchCache: AvailableBranch[] | null = null;
  let baseBranchRequest: Promise<AvailableBranch[]> | null = null;

  // Linear integration
  let linearIssues = $state<LinearIssue[]>([]);
  let linearAvailability = $state<LinearIssueAvailability>("disabled");
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

  function getAvailableBranchCacheKey(includeRemote: boolean): BranchCacheKey {
    return includeRemote ? "remote" : "local";
  }

  function fetchAvailableBranchesCached(includeRemote: boolean): Promise<AvailableBranch[]> {
    const key = getAvailableBranchCacheKey(includeRemote);
    const cached = availableBranchCache[key];
    if (cached) return Promise.resolve(cached);

    const inFlight = availableBranchRequests[key];
    if (inFlight) return inFlight;

    const request = api.fetchAvailableBranches({ includeRemote })
      .then((branches) => {
        availableBranchCache[key] = branches;
        return branches;
      })
      .finally(() => {
        delete availableBranchRequests[key];
      });

    availableBranchRequests[key] = request;
    return request;
  }

  function fetchBaseBranchesCached(): Promise<AvailableBranch[]> {
    if (baseBranchCache) return Promise.resolve(baseBranchCache);
    if (baseBranchRequest) return baseBranchRequest;

    baseBranchRequest = api.fetchBaseBranches()
      .then((branches) => {
        baseBranchCache = branches;
        return branches;
      })
      .finally(() => {
        baseBranchRequest = null;
      });

    return baseBranchRequest;
  }

  function invalidateBranchCaches(): void {
    availableBranchCache = {};
    availableBranchRequests = {};
    baseBranchCache = null;
    baseBranchRequest = null;
    availableBranches = [];
    availableBranchesError = null;
    availableBranchesLoading = false;
    baseBranches = [];
    baseBranchesError = null;
    baseBranchesLoading = false;
  }

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
  let visibleWorktreeRows = $derived(buildWorktreeListRows(visibleWorktrees));
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
  let showLinearPanel = $derived(linearAvailability !== "disabled");

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
    if (isMobile) sidebarOpen = false;
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

    const cached = availableBranchCache[getAvailableBranchCacheKey(includeRemoteBranches)];
    if (cached) {
      availableBranches = cached;
      availableBranchesLoading = false;
      availableBranchesError = null;
      return;
    }

    const fetchId = ++nextAvailableBranchFetchId;
    availableBranchesLoading = true;
    availableBranchesError = null;

    fetchAvailableBranchesCached(includeRemoteBranches)
      .then((branches) => {
        if (fetchId !== nextAvailableBranchFetchId) return;
        availableBranches = branches;
      })
      .catch((err: unknown) => {
        if (fetchId !== nextAvailableBranchFetchId) return;
        availableBranchesError = errorMessage(err);
      })
      .finally(() => {
        if (fetchId !== nextAvailableBranchFetchId) return;
        availableBranchesLoading = false;
      });
  });

  $effect(() => {
    if (!showCreateDialog) return;

    if (baseBranchCache) {
      baseBranches = baseBranchCache;
      baseBranchesLoading = false;
      baseBranchesError = null;
      return;
    }

    const fetchId = ++nextBaseBranchFetchId;
    baseBranches = [];
    baseBranchesLoading = true;
    baseBranchesError = null;

    fetchBaseBranchesCached()
      .then((branches) => {
        if (fetchId !== nextBaseBranchFetchId) return;
        baseBranches = branches;
      })
      .catch((err: unknown) => {
        if (fetchId !== nextBaseBranchFetchId) return;
        baseBranchesError = errorMessage(err);
      })
      .finally(() => {
        if (fetchId !== nextBaseBranchFetchId) return;
        baseBranchesLoading = false;
      });
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
      linearAvailability = data.availability;
      linearIssues = data.issues;
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

  function openCreateDialog(issue: LinearIssue | null = null): void {
    includeRemoteBranches = false;
    assignIssue = issue;
    showCreateDialog = true;
  }

  function handleAssignIssue(issue: LinearIssue): void {
    openCreateDialog(issue);
  }

  async function handleCreate(request: CreateWorktreeRequest) {
    const requestId = nextCreateRequestId++;
    const shouldAutoSelectCreatedWorktree = selectedWorktree == null;
    if (shouldAutoSelectCreatedWorktree) {
      latestAutoSelectCreateId = requestId;
    }
    pendingCreateCount += 1;
    if (shouldAutoSelectCreatedWorktree) {
      pendingCreateBranchHint = request.branch ?? null;
    }
    showCreateDialog = false;
    assignIssue = null;

    try {
      const createPromise = api.createWorktree(request);
      void refresh();
      const result = await createPromise;
      if (shouldAutoSelectCreatedWorktree) {
        pendingCreateBranchHint = result.branch;
      }
      invalidateBranchCaches();
      await refresh();
      if (request.createLinearTicket) {
        linearLastFetch = 0;
        refreshLinear();
      }
      if (shouldAutoSelectCreatedWorktree && requestId === latestAutoSelectCreateId) {
        selectedBranch = result.branch;
        if (isMobile) sidebarOpen = false;
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
    const orderedWorktrees = visibleWorktreeRows.map((row) => row.worktree);
    const idx = orderedWorktrees.findIndex((w) => w.branch === branch);
    const previous = orderedWorktrees[idx - 1];
    const next = orderedWorktrees[idx + 1];
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
      invalidateBranchCaches();
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
      invalidateBranchCaches();
      await refresh();
    } catch (err) {
      alert(`Failed to merge: ${errorMessage(err)}`);
    } finally {
      removingBranches = new Set(
        [...removingBranches].filter((b) => b !== branch),
      );
    }
  }

  async function handlePullMain(): Promise<void> {
    pullMainLoading = true;
    pullMainError = "";
    try {
      const result = await api.pullMain(pullMainForce);
      if (result.status === "updated" || result.status === "already_up_to_date") {
        pullMainConfirm = false;
        pullMainForce = false;
      } else if (result.status === "merge_failed" && !pullMainForce) {
        pullMainForce = true;
        pullMainError = `Fast-forward failed: ${result.error ?? "unknown error"}.\nForce pull will reset main to match remote.`;
      } else {
        pullMainError = result.error ?? result.status;
      }
    } catch (err) {
      pullMainError = errorMessage(err);
    } finally {
      pullMainLoading = false;
    }
  }

  async function handlePullLinkedRepo(): Promise<void> {
    if (!pullLinkedRepoAlias) return;
    pullLinkedRepoLoading = true;
    pullLinkedRepoError = "";
    try {
      const result = await api.pullMain(pullLinkedRepoForce, pullLinkedRepoAlias);
      if (result.status === "updated" || result.status === "already_up_to_date") {
        pullLinkedRepoAlias = null;
        pullLinkedRepoForce = false;
      } else if (result.status === "merge_failed" && !pullLinkedRepoForce) {
        pullLinkedRepoForce = true;
        pullLinkedRepoError = `Fast-forward failed: ${result.error ?? "unknown error"}.\nForce pull will reset to match remote.`;
      } else {
        pullLinkedRepoError = result.error ?? result.status;
      }
    } catch (err) {
      pullLinkedRepoError = errorMessage(err);
    } finally {
      pullLinkedRepoLoading = false;
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
    if (showCreateDialog || removeBranch || mergeBranch || pullMainConfirm || pullLinkedRepoAlias) return;

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
      openCreateDialog();
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
    if (isMobile) sidebarOpen = true;
    function onMqChange(e: MediaQueryListEvent): void {
      isMobile = e.matches;
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

<div class="flex h-dvh bg-surface text-primary {isResizingSidebar ? 'select-none' : ''}" style={isResizingSidebar ? 'cursor: col-resize' : ''}>
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
        : ''} bg-sidebar border-r border-edge flex flex-col overflow-hidden shrink-0"
      style={isMobile ? '' : `width: ${sidebarWidth}px`}
    >
      <div class="p-4 border-b border-edge">
        <div class="flex items-center justify-between">
          <h1 class="text-base font-semibold">{config.name ?? "Dashboard"}</h1>
          <div class="flex items-center gap-2">
            <button
              class="h-8 px-2 gap-1.5 rounded-md border border-edge bg-surface text-accent text-xs flex items-center justify-center cursor-pointer hover:bg-hover disabled:opacity-50 disabled:cursor-not-allowed"
              onclick={() => openCreateDialog()}
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
        {#if activeCreateCount > 0}
          <div class="mt-2 flex items-center gap-1 text-[10px] text-muted">
            <span class="spinner"></span>
            {createIndicatorLabel}
          </div>
        {/if}
      </div>
      <WorktreeList
        rows={visibleWorktreeRows}
        selected={selectedBranch}
        removing={removingBranches}
        initializing={openingBranches}
        {notifiedBranches}
        onselect={(b) => {
          selectedBranch = b;
          notifiedBranches = new Set([...notifiedBranches].filter((x) => x !== b));
          if (isMobile) sidebarOpen = false;
        }}
        onremove={(b) => (removeBranch = b)}
      />
      {#if config.projectDir}
        {@const mainCursorUrl = makeCursorUrl(config.projectDir, sshHost)}
        <div class="shrink-0 border-t border-edge px-3 py-2 flex items-center gap-2">
          <span class="text-[11px] text-muted font-medium truncate">{config.mainBranch ?? "main"}</span>
          {#if mainCursorUrl}
            <CursorButton url={mainCursorUrl} />
          {/if}
          <button
            type="button"
            class="shrink-0 text-[9px] px-1.5 py-0.5 rounded border border-edge text-muted font-medium cursor-pointer hover:bg-hover hover:text-primary"
            title="Pull latest from remote"
            onclick={() => { pullMainConfirm = true; pullMainForce = false; pullMainError = ""; }}
          >Pull</button>
        </div>
      {/if}
      {#each (config.linkedRepos ?? []).filter((lr) => lr.dir) as lr (lr.alias)}
        {@const lrCursorUrl = makeCursorUrl(lr.dir, sshHost)}
        <div class="shrink-0 border-t border-edge px-3 py-2 flex items-center gap-2">
          <span class="text-[11px] text-muted font-medium truncate">{lr.alias}</span>
          {#if lrCursorUrl}
            <CursorButton url={lrCursorUrl} />
          {/if}
          <button
            type="button"
            class="shrink-0 text-[9px] px-1.5 py-0.5 rounded border border-edge text-muted font-medium cursor-pointer hover:bg-hover hover:text-primary"
            title="Pull latest from remote"
            onclick={() => { pullLinkedRepoAlias = lr.alias; pullLinkedRepoForce = false; pullLinkedRepoError = ""; }}
          >Pull</button>
        </div>
      {/each}
      {#if showLinearPanel}
        <LinearPanel
          issues={linearIssues}
          availability={linearAvailability}
          onassign={handleAssignIssue}
          onselect={(issue) => (detailIssue = issue)}
        />
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
    {#if !isMobile}
      <div
        class="w-1 shrink-0 cursor-col-resize hover:bg-accent/50 transition-colors"
        class:bg-accent={isResizingSidebar}
        onpointerdown={handleResizeStart}
        onkeydown={handleResizeKeydown}
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={sidebarWidth}
        aria-valuemin={MIN_SIDEBAR_WIDTH}
        aria-valuemax={MAX_SIDEBAR_WIDTH}
        tabindex="0"
      ></div>
    {/if}
  {/if}

  <main class="flex-1 min-w-0 flex flex-col overflow-hidden">
    <TopBar
      name={selectedWorktree?.branch ?? null}
      worktree={selectedWorktree}
      {sshHost}
      linkedRepos={config.linkedRepos ?? []}
      {isMobile}
      {notificationHistory}
      {unreadCount}
      ontogglesidebar={() => (sidebarOpen = !sidebarOpen)}
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
          {terminalTheme}
          bind:this={terminalRef}
        />
      {/key}
    {:else if selectedWorktree?.creating}
      <div class="flex-1 flex items-center justify-center px-6">
        <div class="flex flex-col items-center gap-3 text-center">
          <span class="spinner" style="width: 24px; height: 24px; border-width: 2px;"></span>
          <p class="text-sm text-primary font-medium">{selectedWorktree.branch}</p>
          <p class="text-xs text-muted">{worktreeCreationPhaseLabel(selectedWorktree.creationPhase)}</p>
        </div>
      </div>
    {:else if selectedWorktree}
      <div class="flex-1 flex items-center justify-center px-6">
        <div class="flex flex-col items-center gap-4 text-center">
          <p class="text-sm text-primary font-medium">{selectedWorktree.branch}</p>
          <div class="flex flex-col items-center gap-1">
            {#if selectedWorktree.profile}
              <span class="text-xs text-muted">Profile: {selectedWorktree.profile}</span>
            {/if}
            {#if selectedWorktree.agentName}
              <span class="text-xs text-muted">Agent: {selectedWorktree.agentName}</span>
            {/if}
          </div>
          <button
            class="mt-2 px-5 py-2 rounded-md bg-accent text-white text-sm font-medium cursor-pointer border-none hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            onclick={openSelectedWorktree}
            disabled={isSelectedOpening}
          >
            {#if isSelectedOpening}
              <span class="spinner" style="width: 14px; height: 14px; border-width: 1.5px;"></span>
              Opening...
            {:else}
              Open Session
            {/if}
          </button>
        </div>
      </div>
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
    profiles={config.profiles}
    defaultProfileName={config.defaultProfileName}
    autoNameEnabled={config.autoName}
    initialBranch={assignIssue?.branchName ?? ""}
    initialPrompt={assignIssue ? `${assignIssue.title}${assignIssue.description ? '\n\n' + assignIssue.description : ''}` : ""}
    bind:includeRemoteBranches
    {availableBranches}
    {availableBranchesLoading}
    {availableBranchesError}
    {baseBranches}
    {baseBranchesLoading}
    {baseBranchesError}
    startupEnvs={config.startupEnvs ?? {}}
    linearCreateTicketOption={config.linearCreateTicketOption}
    openedFromLinearIssue={assignIssue !== null}
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

{#if pullMainConfirm}
  <ConfirmDialog
    message={pullMainForce
      ? `Force pull "${config.mainBranch ?? "main"}"? This will discard any local commits on main.`
      : `Pull latest "${config.mainBranch ?? "main"}" from remote?`}
    confirmLabel={pullMainForce ? "Force Pull" : "Pull"}
    variant={pullMainForce ? "danger" : "accent"}
    loading={pullMainLoading}
    error={pullMainError}
    onconfirm={handlePullMain}
    oncancel={() => { pullMainConfirm = false; pullMainForce = false; }}
  />
{/if}

{#if pullLinkedRepoAlias}
  <ConfirmDialog
    message={pullLinkedRepoForce
      ? `Force pull "${pullLinkedRepoAlias}"? This will discard any local commits.`
      : `Pull latest "${pullLinkedRepoAlias}" from remote?`}
    confirmLabel={pullLinkedRepoForce ? "Force Pull" : "Pull"}
    variant={pullLinkedRepoForce ? "danger" : "accent"}
    loading={pullLinkedRepoLoading}
    error={pullLinkedRepoError}
    onconfirm={handlePullLinkedRepo}
    oncancel={() => { pullLinkedRepoAlias = null; pullLinkedRepoForce = false; }}
  />
{/if}

{#if showSettingsDialog}
  <SettingsDialog
    {currentTheme}
    linearAutoCreate={config.linearAutoCreateWorktrees ?? false}
    autoRemoveOnMerge={config.autoRemoveOnMerge ?? false}
    onthemechange={(key) => (currentTheme = key)}
    onlinearautocreatechange={(enabled) => { config.linearAutoCreateWorktrees = enabled; }}
    onautoremovechange={(enabled) => { config.autoRemoveOnMerge = enabled; }}
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
  onselect={(branch) => {
    selectedBranch = branch;
    notifiedBranches = new Set([...notifiedBranches].filter((x) => x !== branch));
    if (isMobile) sidebarOpen = false;
  }}
/>
