<script lang="ts">
  import type { ThemeKey } from "./themes";
  import { SSH_STORAGE_KEY, applyTheme, errorMessage } from "./utils";
  import { THEMES } from "./themes";
  import BaseDialog from "./BaseDialog.svelte";
  import Btn from "./Btn.svelte";
  import Toggle from "./Toggle.svelte";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import AgentEditorDialog from "./AgentEditorDialog.svelte";
  import { api, createAgent, deleteAgent, fetchAgents, updateAgent } from "./api";
  import type { AgentDetails, AgentSummary, UpsertCustomAgentRequest } from "./types";

  interface AgentEditorState {
    mode: "create" | "edit";
    agentId?: string;
    title: string;
    initialValue: {
      label: string;
      startCommand: string;
      resumeCommand: string;
    };
  }

  let {
    currentTheme,
    linearAutoCreate,
    autoRemoveOnMerge,
    onthemechange,
    onlinearautocreatechange,
    onautoremovechange,
    onagentschange,
    onsave,
    onclose,
  }: {
    currentTheme: ThemeKey;
    linearAutoCreate: boolean;
    autoRemoveOnMerge: boolean;
    onthemechange: (key: ThemeKey) => void;
    onlinearautocreatechange: (enabled: boolean) => void;
    onautoremovechange: (enabled: boolean) => void;
    onagentschange: (agents: AgentSummary[]) => void;
    onsave: (sshHost: string) => void;
    onclose: () => void;
  } = $props();

  let sshHost = $state(localStorage.getItem(SSH_STORAGE_KEY) ?? "");
  let pendingAutoCreate = $state<boolean | null>(null);
  let autoCreate = $derived(pendingAutoCreate ?? linearAutoCreate);
  let autoCreateSaving = $state(false);

  let pendingAutoRemove = $state<boolean | null>(null);
  let autoRemove = $derived(pendingAutoRemove ?? autoRemoveOnMerge);
  let autoRemoveSaving = $state(false);

  let agents = $state<AgentDetails[]>([]);
  let agentsLoading = $state(true);
  let agentsError = $state<string | null>(null);
  let agentsLoaded = false;
  let editor = $state<AgentEditorState | null>(null);
  let deleteCandidate = $state<AgentDetails | null>(null);
  let deletingAgentId = $state<string | null>(null);

  async function loadAgentList(): Promise<void> {
    agentsLoading = true;
    agentsError = null;

    try {
      agents = await fetchAgents();
    } catch (err) {
      agentsError = errorMessage(err);
    } finally {
      agentsLoading = false;
    }
  }

  function syncAgentSummaries(): void {
    api.fetchConfig()
      .then((config) => {
        onagentschange(config.agents);
      })
      .catch(() => {});
  }

  $effect(() => {
    if (agentsLoaded) return;
    agentsLoaded = true;
    void loadAgentList();
  });

  function handleAutoCreateToggle(enabled: boolean) {
    pendingAutoCreate = enabled;
    autoCreateSaving = true;
    api.setLinearAutoCreate({ body: { enabled } })
      .then((result) => {
        onlinearautocreatechange(result.enabled);
      })
      .finally(() => {
        pendingAutoCreate = null;
        autoCreateSaving = false;
      });
  }

  function handleAutoRemoveToggle(enabled: boolean) {
    pendingAutoRemove = enabled;
    autoRemoveSaving = true;
    api.setAutoRemoveOnMerge({ body: { enabled } })
      .then((result) => {
        onautoremovechange(result.enabled);
      })
      .finally(() => {
        pendingAutoRemove = null;
        autoRemoveSaving = false;
      });
  }

  function handleSave() {
    const trimmed = sshHost.trim();
    if (trimmed) {
      localStorage.setItem(SSH_STORAGE_KEY, trimmed);
    } else {
      localStorage.removeItem(SSH_STORAGE_KEY);
    }
    onsave(trimmed);
  }

  function selectTheme(key: ThemeKey) {
    applyTheme(key);
    onthemechange(key);
  }

  function openCreateAgentEditor(): void {
    editor = {
      mode: "create",
      title: "Add custom agent",
      initialValue: {
        label: "",
        startCommand: "",
        resumeCommand: "",
      },
    };
  }

  function openEditAgentEditor(agent: AgentDetails): void {
    editor = {
      mode: "edit",
      agentId: agent.id,
      title: `Edit ${agent.label}`,
      initialValue: {
        label: agent.label,
        startCommand: agent.startCommand ?? "",
        resumeCommand: agent.resumeCommand ?? "",
      },
    };
  }

  function openDuplicateAgentEditor(agent: AgentDetails): void {
    editor = {
      mode: "create",
      title: `Duplicate ${agent.label}`,
      initialValue: {
        label: `${agent.label} Copy`,
        startCommand: agent.startCommand ?? "",
        resumeCommand: agent.resumeCommand ?? "",
      },
    };
  }

  async function handleSaveAgent(input: UpsertCustomAgentRequest): Promise<void> {
    if (!editor) return;

    if (editor.mode === "edit" && editor.agentId) {
      await updateAgent(editor.agentId, input);
    } else {
      await createAgent(input);
    }

    await loadAgentList();
    syncAgentSummaries();
    editor = null;
  }

  async function handleDeleteAgent(): Promise<void> {
    if (!deleteCandidate) return;
    deletingAgentId = deleteCandidate.id;

    try {
      await deleteAgent(deleteCandidate.id);
      await loadAgentList();
      syncAgentSummaries();
      deleteCandidate = null;
    } finally {
      deletingAgentId = null;
    }
  }
</script>

<BaseDialog {onclose} wide>
  <form onsubmit={(event) => { event.preventDefault(); handleSave(); }}>
    <h2 class="text-base mb-4">Settings</h2>

    <div class="mb-5">
      <span class="block text-xs text-muted mb-2">Theme</span>
      <div class="grid grid-cols-2 gap-2">
        {#each THEMES as theme (theme.key)}
          <button
            type="button"
            class="flex items-center gap-2.5 px-3 py-2 rounded-md border cursor-pointer text-left text-[13px] transition-colors {currentTheme === theme.key
              ? 'border-accent bg-active text-primary'
              : 'border-edge bg-surface text-muted hover:bg-hover hover:text-primary'}"
            onclick={() => selectTheme(theme.key)}
          >
            <span class="shrink-0 flex gap-0.5">
              {#each [theme.colors.surface, theme.colors.accent, theme.colors.success, theme.colors.warning] as color}
                <span class="w-3 h-3 rounded-full border border-edge" style="background:{color}"></span>
              {/each}
            </span>
            <span>{theme.label}</span>
          </button>
        {/each}
      </div>
    </div>

    <div class="mb-5">
      <span class="block text-xs text-muted mb-2">Agents</span>
      <div class="rounded-lg border border-edge bg-surface/40 p-3">
        <div class="mb-3 flex items-center justify-between gap-2">
          <div>
            <p class="text-[13px] text-primary">Custom agents</p>
            <p class="mt-0.5 text-[11px] text-muted">
              Add terminal agents that webmux can launch alongside the built-in Claude and Codex integrations.
            </p>
          </div>
          <Btn type="button" variant="cta" onclick={openCreateAgentEditor}>Add agent</Btn>
        </div>

        {#if agentsLoading}
          <p class="text-[12px] text-muted">Loading agents...</p>
        {:else if agentsError}
          <p class="text-[12px] text-danger">{agentsError}</p>
        {:else}
          <div class="space-y-2">
            {#each agents as agent (agent.id)}
              <div class="rounded-lg border border-edge bg-surface px-3 py-2.5">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-1.5">
                      <span class="text-[13px] text-primary">{agent.label}</span>
                      <span class="rounded-full border border-edge px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted">
                        {agent.kind}
                      </span>
                      <span class="rounded-full border border-edge px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted">
                        {agent.capabilities.inAppChat ? 'chat' : 'terminal only'}
                      </span>
                    </div>
                    <p class="mt-1 text-[11px] text-muted font-mono break-all">
                      {agent.startCommand ?? 'Built-in integration'}
                    </p>
                    {#if agent.resumeCommand}
                      <p class="mt-1 text-[11px] text-muted font-mono break-all">
                        Resume: {agent.resumeCommand}
                      </p>
                    {/if}
                  </div>

                  {#if agent.kind === 'custom'}
                    <div class="flex shrink-0 gap-2 text-[11px]">
                      <button type="button" class="text-accent hover:underline" onclick={() => openEditAgentEditor(agent)}>
                        Edit
                      </button>
                      <button type="button" class="text-accent hover:underline" onclick={() => openDuplicateAgentEditor(agent)}>
                        Duplicate
                      </button>
                      <button
                        type="button"
                        class="text-danger hover:underline disabled:opacity-60"
                        disabled={deletingAgentId === agent.id}
                        onclick={() => (deleteCandidate = agent)}
                      >
                        Delete
                      </button>
                    </div>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    <div class="mb-5">
      <span class="block text-xs text-muted mb-2">Linear</span>
      <div class="flex items-center justify-between gap-3 px-3 py-2 rounded-md border border-edge bg-surface">
        <div>
          <span class="text-[13px] text-primary">Auto-create worktrees</span>
          <p class="text-[11px] text-muted mt-0.5">
            Automatically create worktrees for Todo Linear tickets with the "webmux" label.
          </p>
        </div>

        <Toggle
          checked={autoCreate}
          disabled={autoCreateSaving}
          ontoggle={handleAutoCreateToggle}
          aria-label="Auto-create worktrees for Linear tickets"
        />
      </div>
    </div>

    <div class="mb-5">
      <span class="block text-xs text-muted mb-2">GitHub</span>
      <div class="flex items-center justify-between gap-3 px-3 py-2 rounded-md border border-edge bg-surface">
        <div>
          <span class="text-[13px] text-primary">Auto-remove on merge</span>
          <p class="text-[11px] text-muted mt-0.5">
            Automatically remove worktrees when their PR is merged on GitHub.
          </p>
        </div>

        <Toggle
          checked={autoRemove}
          disabled={autoRemoveSaving}
          ontoggle={handleAutoRemoveToggle}
          aria-label="Auto-remove worktrees on PR merge"
        />
      </div>
    </div>

    <div class="mb-4">
      <label class="block text-xs text-muted mb-1.5" for="ssh-host">
        SSH Host <span class="opacity-60">(for "Open in Cursor")</span>
      </label>
      <input
        id="ssh-host"
        type="text"
        class="w-full px-2.5 py-1.5 rounded-md border border-edge bg-surface text-primary text-[13px] placeholder:text-muted/50 outline-none focus:border-accent"
        placeholder="e.g. devbox or 10.0.0.5"
        bind:value={sshHost}
      />
      <p class="text-[11px] text-muted mt-1.5">
        Must match an entry in your local <code class="text-accent/80">~/.ssh/config</code>. Leave empty for local mode.
      </p>
    </div>
    <div class="flex justify-end gap-2">
      <Btn type="button" onclick={onclose}>Cancel</Btn>
      <Btn type="submit" variant="cta">Save</Btn>
    </div>
  </form>
</BaseDialog>

{#if editor}
  <AgentEditorDialog
    title={editor.title}
    initialValue={editor.initialValue}
    onsave={handleSaveAgent}
    onclose={() => (editor = null)}
  />
{/if}

{#if deleteCandidate}
  <ConfirmDialog
    message={`Delete agent "${deleteCandidate.label}"?`}
    onconfirm={() => {
      void handleDeleteAgent();
    }}
    oncancel={() => {
      deleteCandidate = null;
    }}
  />
{/if}
