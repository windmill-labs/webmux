<script lang="ts">
  import type {
    AvailableBranch,
    CreateWorktreeAgentSelection,
    CreateWorktreeRequest,
    ProfileConfig,
    WorktreeCreateMode,
  } from "./types";
  import BaseDialog from "./BaseDialog.svelte";
  import BranchSelector from "./BranchSelector.svelte";
  import Btn from "./Btn.svelte";
  import StartupEnvFields from "./StartupEnvFields.svelte";
  import Toggle from "./Toggle.svelte";

  let {
    profiles = [],
    defaultProfileName = "",
    autoNameEnabled = false,
    initialBranch = "",
    initialPrompt = "",
    availableBranches = [],
    availableBranchesLoading = false,
    availableBranchesError = null,
    baseBranches = [],
    baseBranchesLoading = false,
    baseBranchesError = null,
    includeRemoteBranches = $bindable(false),
    startupEnvs = {},
    linearCreateTicketOption = false,
    openedFromLinearIssue = false,
    oncreate,
    oncancel,
  }: {
    profiles: ProfileConfig[];
    defaultProfileName?: string;
    autoNameEnabled?: boolean;
    initialBranch?: string;
    initialPrompt?: string;
    availableBranches?: AvailableBranch[];
    availableBranchesLoading?: boolean;
    availableBranchesError?: string | null;
    baseBranches?: AvailableBranch[];
    baseBranchesLoading?: boolean;
    baseBranchesError?: string | null;
    includeRemoteBranches: boolean;
    startupEnvs?: Record<string, string | boolean>;
    linearCreateTicketOption?: boolean;
    openedFromLinearIssue?: boolean;
    oncreate: (request: CreateWorktreeRequest) => void;
    oncancel: () => void;
  } = $props();

  const AGENTS: Array<{ value: CreateWorktreeAgentSelection; label: string }> = [
    { value: "claude", label: "Claude" },
    { value: "codex", label: "Codex" },
    { value: "both", label: "Both" },
  ];

  const STORAGE_KEY = "wt-default-profile";
  const AGENT_STORAGE_KEY = "wt-default-agent";
  const ENV_STORAGE_KEY = "wt-default-envs";
  const savedProfile = localStorage.getItem(STORAGE_KEY);
  const savedAgent = localStorage.getItem(AGENT_STORAGE_KEY);
  const savedEnvs = localStorage.getItem(ENV_STORAGE_KEY);

  let fallbackProfile = $derived(defaultProfileName || profiles[0]?.name || "default");
  let mode = $state<WorktreeCreateMode>("new");
  // svelte-ignore state_referenced_locally
  let newBranchName = $state(initialBranch);
  // svelte-ignore state_referenced_locally
  let prompt = $state(initialPrompt);
  let selectedExistingBranch = $state("");
  let selectedBaseBranch = $state("");
  let agent = $state<CreateWorktreeAgentSelection>(
    savedAgent === "codex" || savedAgent === "both" ? savedAgent : "claude",
  );
  let profile = $state(savedProfile ?? "");
  let createLinearTicket = $state(false);
  let linearTitle = $state("");
  const hasSavedDefaults = savedProfile != null || savedAgent != null || savedEnvs != null;
  let saveDefault = $state(hasSavedDefaults);

  function loadSavedEnvs(): Record<string, string | boolean> {
    if (!savedEnvs) return { ...startupEnvs };
    try {
      const parsed = JSON.parse(savedEnvs) as Record<string, string | boolean>;
      const filtered = Object.fromEntries(
        Object.entries(parsed).filter(([k]) => k in startupEnvs),
      );
      return { ...startupEnvs, ...filtered };
    } catch {
      return { ...startupEnvs };
    }
  }

  // svelte-ignore state_referenced_locally
  let envValues = $state<Record<string, string | boolean>>(loadSavedEnvs());

  function focus(node: HTMLElement) {
    node.focus();
  }
  let showLinearTicketOption = $derived(
    linearCreateTicketOption && !openedFromLinearIssue && mode === "new",
  );
  let creatingBothAgents = $derived(agent === "both");
  let promptRequired = $derived(showLinearTicketOption && createLinearTicket);
  let canSubmit = $derived(
    (mode === "new" || selectedExistingBranch.length > 0) &&
      (!promptRequired || prompt.trim().length > 0),
  );

  $effect(() => {
    if (!profiles.some((p) => p.name === profile)) {
      profile = fallbackProfile;
    }
  });

  $effect(() => {
    if (!showLinearTicketOption) {
      createLinearTicket = false;
      linearTitle = "";
    }
  });

  $effect(() => {
    if (creatingBothAgents && mode === "existing") {
      mode = "new";
      selectedExistingBranch = "";
    }
  });

  function selectExistingBranch(name: string): void {
    selectedExistingBranch = name;
  }

  function openExistingBranchSelector(): void {
    mode = "existing";
    if (!selectedExistingBranch && initialBranch.trim().length > 0) {
      selectedExistingBranch = initialBranch.trim();
    }
  }

  function switchToNewBranchMode(): void {
    mode = "new";
  }
</script>

<BaseDialog onclose={oncancel} className="md:max-w-[440px]">
  <form
    onsubmit={(e) => {
      e.preventDefault();
      if (!canSubmit) return;
      if (saveDefault) {
        localStorage.setItem(STORAGE_KEY, profile);
        localStorage.setItem(AGENT_STORAGE_KEY, agent);
        localStorage.setItem(ENV_STORAGE_KEY, JSON.stringify(envValues));
      } else {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(AGENT_STORAGE_KEY);
        localStorage.removeItem(ENV_STORAGE_KEY);
      }
      const filteredEnvs: Record<string, string> = {};
      for (const [k, v] of Object.entries(envValues)) {
        if (typeof v === "boolean") {
          if (v) filteredEnvs[k] = "true";
        } else if (v) {
          filteredEnvs[k] = v;
        }
      }
      const trimmedPrompt = prompt.trim();
      const branchName = mode === "existing" ? selectedExistingBranch : newBranchName.trim();
      oncreate({
        mode,
        ...(branchName && !(mode === "new" && createLinearTicket) ? { branch: branchName } : {}),
        ...(mode === "new" && selectedBaseBranch ? { baseBranch: selectedBaseBranch } : {}),
        profile,
        agent,
        ...(trimmedPrompt ? { prompt: trimmedPrompt } : {}),
        ...(Object.keys(filteredEnvs).length > 0 ? { envOverrides: filteredEnvs } : {}),
        ...(createLinearTicket ? { createLinearTicket: true } : {}),
        ...(createLinearTicket && linearTitle.trim() ? { linearTitle: linearTitle.trim() } : {}),
      });
    }}
  >
    <h2 class="text-base mb-4">New Worktree</h2>
    <div class="mb-4">
      <label class="block text-xs text-muted mb-1.5" for="wt-prompt"
        >Prompt <span class="opacity-60">({promptRequired ? "required" : "optional"})</span></label
      >
      <textarea
        id="wt-prompt"
        rows="4"
        use:focus
        class="w-full px-2.5 py-1.5 rounded-md border border-edge bg-surface text-primary text-[13px] placeholder:text-muted/50 outline-none focus:border-accent resize-y"
        placeholder={createLinearTicket
          ? "Describe the task for the agent. This will also be used as the Linear ticket description..."
          : "Describe the task for the agent..."}
        bind:value={prompt}
        onkeydown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }
        }}
      ></textarea>
    </div>
    <div class="mb-4">
      {#if mode === "new"}
        <label class="block text-xs text-muted mb-1.5" for="wt-name"
          >Branch name <span class="opacity-60">(optional)</span></label
        >
        <input
          id="wt-name"
          type="text"
          class="w-full px-2.5 py-1.5 rounded-md border border-edge bg-surface text-primary text-[13px] placeholder:text-muted/50 outline-none focus:border-accent"
          placeholder={createLinearTicket
            ? "Generated from the Linear ticket"
            : autoNameEnabled
              ? "generated from prompt if empty"
              : "auto-generated if empty"}
          disabled={createLinearTicket}
          bind:value={newBranchName}
        />
        {#if createLinearTicket}
          <p class="mt-2 text-[11px] text-muted">
            The worktree branch will use the Linear ticket branch name.
          </p>
        {:else if creatingBothAgents}
          <p class="mt-2 text-[11px] text-muted">
            Creates paired <span class="font-mono">claude-...</span> and <span class="font-mono">codex-...</span> branches from this task name.
          </p>
        {:else}
          <button
            type="button"
            class="mt-2 text-[11px] text-accent hover:underline"
            onclick={openExistingBranchSelector}
          >
            Use existing branch
          </button>
        {/if}
      {:else}
        <BranchSelector
          label="Existing branch"
          selected={selectedExistingBranch}
          branches={availableBranches}
          loading={availableBranchesLoading}
          error={availableBranchesError}
          placeholder="Select a branch"
          initialOpen={true}
          inlineToggleLabel="include remote"
          inlineToggleAriaLabel="Include remote branches"
          inlineToggleChecked={includeRemoteBranches}
          oninlinetoggle={() => (includeRemoteBranches = !includeRemoteBranches)}
          onselect={selectExistingBranch}
        />
        <button
          type="button"
          class="mt-2 text-[11px] text-accent hover:underline"
          onclick={switchToNewBranchMode}
        >
          Create new branch instead
        </button>
        <p class="mt-2 text-[11px] text-muted">
          Removing this worktree will also delete the branch.
        </p>
      {/if}
    </div>
    {#if mode === "new"}
      <div class="mb-4">
        <BranchSelector
          label="Base branch"
          selected={selectedBaseBranch}
          branches={baseBranches}
          loading={baseBranchesLoading}
          error={baseBranchesError}
          placeholder="Project main branch (default)"
          onselect={(branch) => (selectedBaseBranch = branch)}
        />
        {#if selectedBaseBranch}
          <button
            type="button"
            class="mt-2 text-[11px] text-accent hover:underline"
            onclick={() => (selectedBaseBranch = "")}
          >
            Use project default branch instead
          </button>
        {/if}
      </div>
    {/if}
    <StartupEnvFields {startupEnvs} bind:envValues />
    <div class="flex gap-2 mb-4">
      {#each AGENTS as a}
        <label
          class="flex-1 flex items-center justify-center gap-2 p-2.5 rounded-lg border cursor-pointer text-[13px] transition-colors
            {agent === a.value
            ? 'border-accent bg-accent/10'
            : 'border-edge hover:bg-hover'}"
        >
          <input
            type="radio"
            name="agent"
            value={a.value}
            checked={agent === a.value}
            onchange={() => (agent = a.value)}
            class="accent-[var(--accent)]"
          />
          {a.label}
        </label>
      {/each}
    </div>
    {#if profiles.length > 1}
      <div class="flex flex-col gap-2 mb-6">
        {#each profiles as p}
          <label
            class="flex items-center gap-2.5 p-2.5 rounded-lg border cursor-pointer text-[13px] transition-colors
              {profile === p.name
              ? 'border-accent bg-accent/10'
              : 'border-edge hover:bg-hover'}"
          >
            <input
              type="radio"
              name="profile"
              value={p.name}
              checked={profile === p.name}
              onchange={() => (profile = p.name)}
              class="accent-[var(--accent)]"
            />
            {p.name}
          </label>
        {/each}
      </div>
    {/if}
    <label
      class="flex items-center gap-2 mb-4 text-[13px] text-muted cursor-pointer"
    >
      <input
        type="checkbox"
        bind:checked={saveDefault}
        class="accent-[var(--accent)]"
      />
      Save as default
    </label>
    {#if showLinearTicketOption}
      <div class="mb-4 rounded-lg border border-edge bg-surface/40 p-3">
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="text-[13px] text-primary">Create Linear ticket</p>
            <p class="mt-1 text-[11px] text-muted">
              Creates the ticket first, uses the prompt as the ticket description, and uses the ticket branch name for the worktree.
            </p>
          </div>
          <Toggle bind:checked={createLinearTicket} aria-label="Create Linear ticket" />
        </div>
        {#if createLinearTicket}
          <div class="mt-3">
            <label class="block text-xs text-muted mb-1.5" for="wt-linear-title">
              Linear ticket title <span class="opacity-60">(optional)</span>
            </label>
            <input
              id="wt-linear-title"
              type="text"
              class="w-full px-2.5 py-1.5 rounded-md border border-edge bg-surface text-primary text-[13px] placeholder:text-muted/50 outline-none focus:border-accent"
              placeholder="Defaults to the first non-empty line of the prompt"
              bind:value={linearTitle}
            />
          </div>
        {/if}
      </div>
    {/if}
    <div class="flex justify-end gap-2">
      <Btn type="button" onclick={oncancel}>Cancel</Btn>
      <Btn
        type="submit"
        variant="cta"
        disabled={!canSubmit}
        >Create</Btn
      >
    </div>
  </form>
</BaseDialog>
