<script lang="ts">
  import type { ProfileConfig } from "./types";
  import BaseDialog from "./BaseDialog.svelte";
  import Btn from "./Btn.svelte";

  let {
    loading = false,
    profiles = [],
    initialBranch = "",
    initialPrompt = "",
    startupEnvs = {},
    oncreate,
    oncancel,
  }: {
    loading?: boolean;
    profiles: ProfileConfig[];
    initialBranch?: string;
    initialPrompt?: string;
    startupEnvs?: Record<string, string>;
    oncreate: (name: string, profile: string, agent: string, prompt: string, envOverrides: Record<string, string>) => void;
    oncancel: () => void;
  } = $props();

  const AGENTS = [
    { value: "claude", label: "Claude" },
    { value: "codex", label: "Codex" },
  ];

  const STORAGE_KEY = "wt-default-profile";
  const AGENT_STORAGE_KEY = "wt-default-agent";
  const savedProfile = localStorage.getItem(STORAGE_KEY);
  const savedAgent = localStorage.getItem(AGENT_STORAGE_KEY);

  let defaultProfile = $derived(savedProfile ?? profiles[0]?.name ?? "Full");
  // svelte-ignore state_referenced_locally
  let name = $state(initialBranch);
  // svelte-ignore state_referenced_locally
  let prompt = $state(initialPrompt);
  let agent = $state(savedAgent ?? "claude");
  let profile = $state(savedProfile ?? "Full");
  let saveDefault = $state(false);
  // svelte-ignore state_referenced_locally
  let envValues = $state<Record<string, string>>({ ...startupEnvs });
  let envKeys = $derived(Object.keys(startupEnvs));

  function focus(node: HTMLElement) { node.focus(); }

  $effect(() => {
    if (!profiles.some(p => p.name === profile)) {
      profile = defaultProfile;
    }
  });
</script>

<BaseDialog onclose={oncancel}>
  <form
    onsubmit={(e) => {
      e.preventDefault();
      if (saveDefault) {
        localStorage.setItem(STORAGE_KEY, profile);
        localStorage.setItem(AGENT_STORAGE_KEY, agent);
      } else {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(AGENT_STORAGE_KEY);
      }
      const filteredEnvs: Record<string, string> = {};
      for (const [k, v] of Object.entries(envValues)) {
        if (v) filteredEnvs[k] = v;
      }
      oncreate(name.trim(), profile, agent, prompt.trim(), filteredEnvs);
    }}
  >
    <h2 class="text-base mb-4">New Worktree</h2>
    <div class="mb-4">
      <label class="block text-xs text-muted mb-1.5" for="wt-prompt"
        >Prompt <span class="opacity-60">(optional)</span></label
      >
      <textarea
        id="wt-prompt"
        rows="3"
        use:focus
        class="w-full px-2.5 py-1.5 rounded-md border border-edge bg-surface text-primary text-[13px] placeholder:text-muted/50 outline-none focus:border-accent resize-y"
        placeholder="Describe the task for the agent..."
        bind:value={prompt}
        onkeydown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }}
      ></textarea>
    </div>
    <div class="mb-4">
      <label class="block text-xs text-muted mb-1.5" for="wt-name"
        >Name <span class="opacity-60">(optional)</span></label
      >
      <input
        id="wt-name"
        type="text"
        class="w-full px-2.5 py-1.5 rounded-md border border-edge bg-surface text-primary text-[13px] placeholder:text-muted/50 outline-none focus:border-accent"
        placeholder="auto-generated if empty"
        bind:value={name}
      />
    </div>
    {#each envKeys as key (key)}
      <div class="mb-4">
        <label class="block text-xs text-muted mb-1.5" for="wt-env-{key}">{key}</label>
        <input
          id="wt-env-{key}"
          type="text"
          class="w-full px-2.5 py-1.5 rounded-md border border-edge bg-surface text-primary text-[13px] placeholder:text-muted/50 outline-none focus:border-accent"
          bind:value={envValues[key]}
        />
      </div>
    {/each}
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
      <Btn type="button" onclick={oncancel} disabled={loading}>Cancel</Btn>
      <Btn
        type="submit"
        variant="cta"
        class="flex items-center gap-1.5"
        disabled={loading}
      >{#if loading}<span class="spinner"></span>{/if} Create</Btn>
    </div>
  </form>
</BaseDialog>
