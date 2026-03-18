<script lang="ts">
  import type { AvailableBranch, ProfileConfig, WorktreeCreateMode } from "./types";
  import BaseDialog from "./BaseDialog.svelte";
  import Btn from "./Btn.svelte";
  import StartupEnvFields from "./StartupEnvFields.svelte";
  import { searchMatch } from "./utils";

  let {
    profiles = [],
    defaultProfileName = "",
    autoNameEnabled = false,
    initialBranch = "",
    initialPrompt = "",
    availableBranches = [],
    availableBranchesLoading = false,
    availableBranchesError = null,
    startupEnvs = {},
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
    startupEnvs?: Record<string, string | boolean>;
    oncreate: (
      mode: WorktreeCreateMode,
      name: string,
      profile: string,
      agent: string,
      prompt: string,
      envOverrides: Record<string, string>,
    ) => void;
    oncancel: () => void;
  } = $props();

  const AGENTS = [
    { value: "claude", label: "Claude" },
    { value: "codex", label: "Codex" },
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
  let branchSearchQuery = $state("");
  let existingSelectorOpen = $state(false);
  let agent = $state(savedAgent ?? "claude");
  let profile = $state(savedProfile ?? "");
  const hasSavedDefaults = savedProfile != null || savedAgent != null || savedEnvs != null;
  let saveDefault = $state(hasSavedDefaults);
  let existingBranchFieldEl = $state<HTMLDivElement | undefined>(undefined);
  let existingBranchSearchEl = $state<HTMLInputElement | undefined>(undefined);

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

  let filteredBranches = $derived(
    branchSearchQuery.trim()
      ? availableBranches.filter((branch) => searchMatch(branchSearchQuery, branch.name))
      : availableBranches,
  );
  let canSubmit = $derived(
    mode === "new" || selectedExistingBranch.length > 0,
  );

  $effect(() => {
    if (!profiles.some((p) => p.name === profile)) {
      profile = fallbackProfile;
    }
  });

  function selectExistingBranch(name: string): void {
    selectedExistingBranch = name;
    branchSearchQuery = "";
    existingSelectorOpen = false;
  }

  function focusExistingBranchSearch(): void {
    queueMicrotask(() => existingBranchSearchEl?.focus());
  }

  function openExistingBranchSelector(): void {
    mode = "existing";
    existingSelectorOpen = true;
    if (!selectedExistingBranch && initialBranch.trim().length > 0) {
      selectedExistingBranch = initialBranch.trim();
    }
    branchSearchQuery = "";
    focusExistingBranchSearch();
  }

  function switchToNewBranchMode(): void {
    mode = "new";
    existingSelectorOpen = false;
    branchSearchQuery = "";
  }

  function handleExistingBranchFocusOut(event: FocusEvent): void {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && existingBranchFieldEl?.contains(nextTarget)) {
      return;
    }
    existingSelectorOpen = false;
    branchSearchQuery = "";
  }

  function toggleExistingBranchSelector(): void {
    existingSelectorOpen = !existingSelectorOpen;
    if (!existingSelectorOpen) {
      branchSearchQuery = "";
      return;
    }
    focusExistingBranchSearch();
  }
</script>

<BaseDialog onclose={oncancel} className="md:max-w-[440px]">
  <form
    onsubmit={(e) => {
      e.preventDefault();
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
      const branchName = mode === "existing" ? selectedExistingBranch : newBranchName.trim();
      oncreate(mode, branchName, profile, agent, prompt.trim(), filteredEnvs);
    }}
  >
    <h2 class="text-base mb-4">New Worktree</h2>
    <div class="mb-4">
      <label class="block text-xs text-muted mb-1.5" for="wt-prompt"
        >Prompt <span class="opacity-60">(optional)</span></label
      >
      <textarea
        id="wt-prompt"
        rows="4"
        use:focus
        class="w-full px-2.5 py-1.5 rounded-md border border-edge bg-surface text-primary text-[13px] placeholder:text-muted/50 outline-none focus:border-accent resize-y"
        placeholder="Describe the task for the agent..."
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
          placeholder={autoNameEnabled ? "generated from prompt if empty" : "auto-generated if empty"}
          bind:value={newBranchName}
        />
        <button
          type="button"
          class="mt-2 text-[11px] text-accent hover:underline"
          onclick={openExistingBranchSelector}
        >
          Use existing branch
        </button>
      {:else}
        <div bind:this={existingBranchFieldEl} onfocusout={handleExistingBranchFocusOut}>
          <span class="block text-xs text-muted mb-1.5">Existing branch</span>
          <button
            type="button"
            class="flex w-full items-center justify-between gap-3 rounded-md border border-edge bg-surface px-2.5 py-1.5 text-left text-[13px] text-primary outline-none transition-colors hover:bg-hover focus:border-accent"
            aria-expanded={existingSelectorOpen}
            onclick={toggleExistingBranchSelector}
          >
            <span class={selectedExistingBranch ? "font-mono" : "text-muted/50"}>
              {selectedExistingBranch || "Select a branch"}
            </span>
            <span class="text-[11px] text-muted">{existingSelectorOpen ? "▴" : "▾"}</span>
          </button>
          {#if existingSelectorOpen}
            <div class="mt-2 rounded-lg border border-edge bg-surface/60">
              <div class="border-b border-edge p-2">
                <input
                  bind:this={existingBranchSearchEl}
                  type="text"
                  class="w-full rounded-md border border-edge bg-surface px-2.5 py-1.5 text-[12px] text-primary placeholder:text-muted/50 outline-none focus:border-accent"
                  placeholder="Search branches..."
                  bind:value={branchSearchQuery}
                  onkeydown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (filteredBranches[0]) {
                        selectExistingBranch(filteredBranches[0].name);
                      }
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      existingSelectorOpen = false;
                      branchSearchQuery = "";
                    }
                  }}
                />
              </div>
              {#if availableBranchesLoading}
                <p class="px-3 py-2 text-xs text-muted">Loading branches...</p>
              {:else if availableBranchesError}
                <p class="px-3 py-2 text-xs text-muted">Failed to load branches: {availableBranchesError}</p>
              {:else if filteredBranches.length === 0}
                <p class="px-3 py-2 text-xs text-muted">No matching branches</p>
              {:else}
                <div class="border-b border-edge px-3 py-2 text-[11px] text-muted">
                  {filteredBranches.length !== availableBranches.length
                    ? `${filteredBranches.length}/${availableBranches.length}`
                    : availableBranches.length}
                  {" "}available
                </div>
                <ul class="max-h-48 overflow-y-auto py-1">
                  {#each filteredBranches as branch (branch.name)}
                    <li>
                      <button
                        type="button"
                        class="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[12px] transition-colors hover:bg-hover
                          {selectedExistingBranch === branch.name ? 'bg-accent/10' : ''}"
                        onclick={() => selectExistingBranch(branch.name)}
                      >
                        <span class="font-mono text-primary">{branch.name}</span>
                        {#if selectedExistingBranch === branch.name}
                          <span class="text-[10px] text-accent">Selected</span>
                        {/if}
                      </button>
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>
          {/if}
        </div>
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
