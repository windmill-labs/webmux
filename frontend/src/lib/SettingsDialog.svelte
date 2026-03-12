<script lang="ts">
  import type { ThemeKey } from "./themes";
  import { SSH_STORAGE_KEY, applyTheme } from "./utils";
  import { THEMES } from "./themes";
  import BaseDialog from "./BaseDialog.svelte";
  import Btn from "./Btn.svelte";

  let { currentTheme, onthemechange, onsave, onclose }: {
    currentTheme: ThemeKey;
    onthemechange: (key: ThemeKey) => void;
    onsave: (sshHost: string) => void;
    onclose: () => void;
  } = $props();

  let sshHost = $state(localStorage.getItem(SSH_STORAGE_KEY) ?? "");

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
