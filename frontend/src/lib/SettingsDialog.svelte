<script lang="ts">
  import { SSH_STORAGE_KEY } from "./utils";
  import BaseDialog from "./BaseDialog.svelte";
  import Btn from "./Btn.svelte";

  let { onsave, onclose }: {
    onsave: (sshHost: string) => void;
    onclose: () => void;
  } = $props();

  let sshHost = $state(localStorage.getItem(SSH_STORAGE_KEY) ?? "");
  let inputEl: HTMLInputElement;

  $effect(() => {
    inputEl?.focus();
  });

  function handleSave() {
    const trimmed = sshHost.trim();
    if (trimmed) {
      localStorage.setItem(SSH_STORAGE_KEY, trimmed);
    } else {
      localStorage.removeItem(SSH_STORAGE_KEY);
    }
    onsave(trimmed);
  }
</script>

<BaseDialog {onclose}>
  <form onsubmit={(e) => { e.preventDefault(); handleSave(); }}>
    <h2 class="text-base mb-4">Settings</h2>
    <div class="mb-4">
      <label class="block text-xs text-muted mb-1.5" for="ssh-host">
        SSH Host <span class="opacity-60">(for "Open in Cursor")</span>
      </label>
      <input
        bind:this={inputEl}
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
