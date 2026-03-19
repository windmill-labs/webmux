<script lang="ts">
  import type { ProfileConfig } from "./types";
  import BaseDialog from "./BaseDialog.svelte";
  import Btn from "./Btn.svelte";
  import StartupEnvFields from "./StartupEnvFields.svelte";

  let {
    branch,
    currentProfile,
    currentAgent,
    profiles = [],
    startupEnvs = {},
    currentEnvValues = {},
    onsave,
    oncancel,
  }: {
    branch: string;
    currentProfile: string;
    currentAgent: string;
    profiles: ProfileConfig[];
    startupEnvs: Record<string, string | boolean>;
    currentEnvValues: Record<string, string>;
    onsave: (config: { profile?: string; agent?: string; envOverrides?: Record<string, string> }) => void;
    oncancel: () => void;
  } = $props();

  const AGENTS = [
    { value: "claude", label: "Claude" },
    { value: "codex", label: "Codex" },
  ];

  // svelte-ignore state_referenced_locally
  let agent = $state(currentAgent);
  // svelte-ignore state_referenced_locally
  let profile = $state(currentProfile);

  function buildInitialEnvValues(): Record<string, string | boolean> {
    const values: Record<string, string | boolean> = { ...startupEnvs };
    for (const [key, val] of Object.entries(currentEnvValues)) {
      if (key in startupEnvs) {
        if (typeof startupEnvs[key] === "boolean") {
          values[key] = val === "true";
        } else {
          values[key] = val;
        }
      }
    }
    return values;
  }

  // svelte-ignore state_referenced_locally
  let envValues = $state<Record<string, string | boolean>>(buildInitialEnvValues());
</script>

<BaseDialog onclose={oncancel} className="md:max-w-[440px]">
  <form
    onsubmit={(e) => {
      e.preventDefault();
      const config: { profile?: string; agent?: string; envOverrides?: Record<string, string> } = {};
      if (profile !== currentProfile) config.profile = profile;
      if (agent !== currentAgent) config.agent = agent;
      const filteredEnvs: Record<string, string> = {};
      for (const [k, v] of Object.entries(envValues)) {
        if (typeof v === "boolean") {
          if (v) filteredEnvs[k] = "true";
        } else if (v) {
          filteredEnvs[k] = v;
        }
      }
      config.envOverrides = filteredEnvs;
      onsave(config);
    }}
  >
    <h2 class="text-base mb-1">Edit Worktree</h2>
    <p class="text-xs text-muted mb-4 font-mono">{branch}</p>

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
      <div class="flex flex-col gap-2 mb-4">
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

    <p class="text-[11px] text-muted mb-4">Changes take effect on next open.</p>

    <div class="flex justify-end gap-2">
      <Btn type="button" onclick={oncancel}>Cancel</Btn>
      <Btn type="submit" variant="cta">Save</Btn>
    </div>
  </form>
</BaseDialog>
