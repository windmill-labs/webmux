<script lang="ts">
  import { isMobileDebugEnabled, recordMobileDebug } from "./mobileDebug";
  import MobileTerminalScrollView from "./MobileTerminalScrollView.svelte";
  import type { ITheme } from "@xterm/xterm";
  import PaneBar from "./PaneBar.svelte";
  import Terminal from "./Terminal.svelte";
  import TopBar from "./TopBar.svelte";
  import type {
    AppNotification,
    LinkedRepoInfo,
    PrEntry,
    TerminalController,
    TerminalInteractionMode,
    WorktreeInfo,
  } from "./types";
  import { worktreeCreationPhaseLabel } from "./utils";

  let {
    selectedBranch,
    selectedWorktree,
    canConnect,
    isSelectedOpening,
    isMobile = false,
    sshHost,
    linkedRepos = [],
    notificationHistory = [],
    unreadCount = 0,
    terminalTheme,
    activePane,
    paneBarPanes,
    terminalInteractionMode = "interact",
    terminalRef = $bindable(),
    onshowworktrees,
    onclose,
    onmerge,
    onremove,
    onsettings,
    ondirtyclick,
    onCiClick,
    onReviewsClick,
    onbellopen,
    onnotificationselect,
    onopensession,
    onselectpane,
    oninteractionmodechange,
  }: {
    selectedBranch: string | null;
    selectedWorktree: WorktreeInfo | undefined;
    canConnect: boolean;
    isSelectedOpening: boolean;
    isMobile?: boolean;
    sshHost: string;
    linkedRepos?: LinkedRepoInfo[];
    notificationHistory?: AppNotification[];
    unreadCount?: number;
    terminalTheme: ITheme;
    activePane: number;
    paneBarPanes: Array<{ index: number; label: string }>;
    terminalInteractionMode?: TerminalInteractionMode;
    terminalRef?: TerminalController;
    onshowworktrees?: () => void;
    onclose: () => void;
    onmerge: () => void;
    onremove: () => void;
    onsettings: () => void;
    ondirtyclick?: () => void;
    onCiClick: (pr: PrEntry) => void;
    onReviewsClick: (pr: PrEntry) => void;
    onbellopen?: () => void;
    onnotificationselect?: (branch: string) => void;
    onopensession: () => void;
    onselectpane: (pane: number) => void;
    oninteractionmodechange: (mode: TerminalInteractionMode) => void;
  } = $props();

  let showPaneBar = $derived(isMobile && canConnect && paneBarPanes.length > 0);
  let panelEl = $state<HTMLDivElement | null>(null);
  let topBarEl = $state<HTMLDivElement | null>(null);
  let modeBarEl = $state<HTMLDivElement | null>(null);
  let paneBarEl = $state<HTMLDivElement | null>(null);

  $effect(() => {
    if (!isMobile || !panelEl || !topBarEl || !isMobileDebugEnabled()) return;

    const reportLayout = (): void => {
      const nextPanelEl = panelEl;
      const nextTopBarEl = topBarEl;
      if (!nextPanelEl || !nextTopBarEl) return;

      recordMobileDebug("session.layout", {
        canConnect,
        interaction: terminalInteractionMode,
        paneCount: paneBarPanes.length,
        panelH: Math.round(nextPanelEl.getBoundingClientRect().height),
        topBarH: Math.round(nextTopBarEl.getBoundingClientRect().height),
        modeBarH: modeBarEl ? Math.round(modeBarEl.getBoundingClientRect().height) : 0,
        paneBarH: paneBarEl ? Math.round(paneBarEl.getBoundingClientRect().height) : 0,
      });
    };

    const observer = new ResizeObserver(reportLayout);
    observer.observe(panelEl);
    observer.observe(topBarEl);
    if (modeBarEl) observer.observe(modeBarEl);
    if (paneBarEl) observer.observe(paneBarEl);
    reportLayout();

    return () => {
      observer.disconnect();
    };
  });
</script>

<div class="flex flex-1 min-h-0 flex-col overflow-hidden" bind:this={panelEl}>
  <div bind:this={topBarEl}>
    <TopBar
      name={selectedWorktree?.branch ?? null}
      worktree={selectedWorktree}
      {sshHost}
      {linkedRepos}
      {isMobile}
      {notificationHistory}
      {unreadCount}
      ontogglesidebar={onshowworktrees}
      {onclose}
      {onmerge}
      {onremove}
      onsettings={onsettings}
      ondirtyclick={ondirtyclick}
      {onCiClick}
      {onReviewsClick}
      onbellopen={onbellopen}
      onnotificationselect={onnotificationselect}
    />
  </div>

  {#if canConnect}
    {#if isMobile}
      <div class="shrink-0 border-b border-edge bg-surface px-4 py-2.5" bind:this={modeBarEl}>
        <div class="inline-flex rounded-lg border border-edge bg-sidebar p-1">
          <button
            type="button"
            class="rounded-md px-3 py-1.5 text-xs font-medium transition-colors {terminalInteractionMode === 'scroll'
              ? 'bg-surface text-primary'
              : 'text-muted hover:text-primary'}"
            onclick={() => oninteractionmodechange("scroll")}
          >
            Scroll
          </button>
          <button
            type="button"
            class="rounded-md px-3 py-1.5 text-xs font-medium transition-colors {terminalInteractionMode === 'interact'
              ? 'bg-surface text-primary'
              : 'text-muted hover:text-primary'}"
            onclick={() => oninteractionmodechange("interact")}
          >
            Interact
          </button>
        </div>
        <p class="mt-2 text-[11px] text-muted">
          {terminalInteractionMode === "scroll"
            ? "Review a read-only pane snapshot with native scrolling."
            : "Terminal input is active and touch events go straight to the live session."}
        </p>
      </div>
    {/if}

    <div class="relative flex flex-1 min-h-0 overflow-hidden">
      {#key selectedBranch}
        <Terminal
          worktree={selectedBranch!}
          {isMobile}
          initialPane={isMobile ? activePane : undefined}
          interactionMode={terminalInteractionMode}
          {terminalTheme}
          bind:this={terminalRef}
        />
      {/key}

      {#if isMobile && terminalInteractionMode === "scroll"}
        <div class="absolute inset-0 z-10 overflow-hidden">
          <MobileTerminalScrollView worktree={selectedBranch!} pane={activePane} />
        </div>
      {/if}
    </div>
  {:else if selectedWorktree?.creating}
    <div class="flex flex-1 items-center justify-center px-6">
      <div class="flex flex-col items-center gap-3 text-center">
        <span class="spinner" style="width: 24px; height: 24px; border-width: 2px;"></span>
        <p class="text-sm font-medium text-primary">{selectedWorktree.branch}</p>
        <p class="text-xs text-muted">{worktreeCreationPhaseLabel(selectedWorktree.creationPhase)}</p>
      </div>
    </div>
  {:else if selectedWorktree}
    <div class="flex flex-1 items-center justify-center px-6">
      <div class="flex flex-col items-center gap-4 text-center">
        <p class="text-sm font-medium text-primary">{selectedWorktree.branch}</p>
        <div class="flex flex-col items-center gap-1">
          {#if selectedWorktree.profile}
            <span class="text-xs text-muted">Profile: {selectedWorktree.profile}</span>
          {/if}
          {#if selectedWorktree.agentName}
            <span class="text-xs text-muted">Agent: {selectedWorktree.agentName}</span>
          {/if}
        </div>
        <button
          type="button"
          class="mt-2 flex cursor-pointer items-center gap-2 rounded-md bg-accent px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          onclick={onopensession}
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
    <div class="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted">
      <p>Select a worktree to open its session</p>
    </div>
  {/if}

  {#if showPaneBar}
    <div bind:this={paneBarEl}>
      <PaneBar activePane={activePane} panes={paneBarPanes} onselect={onselectpane} />
    </div>
  {/if}
</div>
