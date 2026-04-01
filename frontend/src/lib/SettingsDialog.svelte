<script lang="ts">
  import type { ThemeKey } from "./themes";
  import { SSH_STORAGE_KEY, applyTheme } from "./utils";
  import { THEMES } from "./themes";
  import BaseDialog from "./BaseDialog.svelte";
  import Btn from "./Btn.svelte";
  import Toggle from "./Toggle.svelte";
  import * as api from "./api";

  let {
    currentTheme,
    linearAutoCreate,
    autoRemoveOnMerge,
    onthemechange,
    onlinearautocreatechange,
    onautoremovechange,
    onsave,
    onclose,
  }: {
    currentTheme: ThemeKey;
    linearAutoCreate: boolean;
    autoRemoveOnMerge: boolean;
    onthemechange: (key: ThemeKey) => void;
    onlinearautocreatechange: (enabled: boolean) => void;
    onautoremovechange: (enabled: boolean) => void;
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

  function handleAutoCreateToggle(enabled: boolean) {
    pendingAutoCreate = enabled;
    autoCreateSaving = true;
    api.setLinearAutoCreate(enabled)
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
    api.setAutoRemoveOnMerge(enabled)
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
</script>

<BaseDialog {onclose} wide>
  <form onsubmit={(e) => { e.preventDefault(); handleSave(); }}>
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
