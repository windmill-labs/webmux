<script lang="ts">
  import BaseDialog from "./BaseDialog.svelte";
  import Btn from "./Btn.svelte";

  let {
    branch,
    initialLabel,
    loading = false,
    error = "",
    onconfirm,
    onclear,
    oncancel,
  }: {
    branch: string;
    initialLabel: string | null;
    loading?: boolean;
    error?: string;
    onconfirm: (label: string) => void;
    onclear: () => void;
    oncancel: () => void;
  } = $props();

  let currentLabel = $state<string | null>(null);
  let inputEl = $state<HTMLInputElement | null>(null);
  let normalizedInitialLabel = $derived((initialLabel ?? "").trim());
  let normalizedLabel = $derived((currentLabel ?? initialLabel ?? "").trim());
  let canSave = $derived(!loading && normalizedLabel !== normalizedInitialLabel);

  $effect(() => {
    const currentInput = inputEl;
    if (!currentInput) return;
    queueMicrotask(() => currentInput.focus());
  });
</script>

<BaseDialog onclose={oncancel}>
  <form onsubmit={(event: SubmitEvent) => { event.preventDefault(); if (canSave) onconfirm(normalizedLabel); }}>
    <h2 class="text-base mb-4">Workspace label</h2>
    <div class="mb-4">
      <label class="block text-[11px] text-muted mb-1" for="worktree-label-input">Label</label>
      <input
        id="worktree-label-input"
        class="w-full px-3 py-2 rounded-md border border-edge bg-surface text-primary text-sm focus:outline-none focus:border-accent"
        maxlength="80"
        bind:this={inputEl}
        value={currentLabel ?? initialLabel ?? ""}
        oninput={(event: Event) => {
          const target = event.currentTarget;
          if (target instanceof HTMLInputElement) currentLabel = target.value;
        }}
        placeholder={branch}
        disabled={loading}
      />
    </div>
    {#if error}<p class="text-[12px] text-danger mb-4 -mt-2 whitespace-pre-wrap">{error}</p>{/if}
    <div class="flex justify-between gap-2">
      <Btn type="button" onclick={onclear} disabled={loading || !initialLabel}>Clear</Btn>
      <div class="flex justify-end gap-2">
        <Btn type="button" onclick={oncancel} disabled={loading}>Cancel</Btn>
        <Btn type="submit" variant="cta" class="flex items-center gap-1.5" disabled={!canSave}
          >{#if loading}<span class="spinner"></span>{/if} Save</Btn
        >
      </div>
    </div>
  </form>
</BaseDialog>
