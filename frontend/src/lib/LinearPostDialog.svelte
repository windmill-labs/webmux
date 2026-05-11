<script lang="ts">
  import BaseDialog from "./BaseDialog.svelte";
  import Btn from "./Btn.svelte";
  import type { PostWorktreeToLinearTarget } from "./types";

  let {
    branch,
    onsubmit,
    onclose,
  }: {
    branch: string;
    onsubmit: (target: PostWorktreeToLinearTarget) => Promise<void> | void;
    onclose: () => void;
  } = $props();

  let raw = $state("");
  let title = $state("");
  let loading = $state(false);
  let error = $state("");

  let parsed = $derived.by((): PostWorktreeToLinearTarget | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (/^[A-Z]+-\d+$/.test(trimmed)) return { kind: "issue", issueId: trimmed };
    if (/^[A-Z]+$/.test(trimmed)) {
      const titleTrimmed = title.trim();
      return titleTrimmed
        ? { kind: "team", teamKey: trimmed, title: titleTrimmed }
        : { kind: "team", teamKey: trimmed };
    }
    return null;
  });

  let kindLabel = $derived.by((): string => {
    if (!parsed) return "";
    return parsed.kind === "issue" ? "Will post to existing issue" : "Will create a new issue in this team";
  });

  async function handleSubmit(): Promise<void> {
    if (!parsed || loading) return;
    loading = true;
    error = "";
    try {
      await onsubmit(parsed);
      onclose();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }
</script>

<BaseDialog {onclose}>
  <form onsubmit={(e) => { e.preventDefault(); void handleSubmit(); }}>
    <h2 class="text-base mb-2">Post to Linear</h2>
    <p class="text-[12px] text-muted mb-4">
      Branch <span class="font-mono">{branch}</span> — the conversation will be uploaded as a JSON attachment and a summary comment.
    </p>

    <div class="mb-3">
      <label class="block text-xs text-muted mb-1.5" for="linear-target">Issue id or team key</label>
      <input
        id="linear-target"
        type="text"
        class="w-full px-2.5 py-1.5 rounded-md border border-edge bg-surface text-primary text-[13px] placeholder:text-muted/50 outline-none focus:border-accent font-mono"
        placeholder="ENG-123 or ENG"
        bind:value={raw}
        autocomplete="off"
      />
      {#if kindLabel}
        <p class="mt-1 text-[11px] text-muted">{kindLabel}</p>
      {/if}
    </div>

    {#if parsed?.kind === "team"}
      <div class="mb-3">
        <label class="block text-xs text-muted mb-1.5" for="linear-title">
          New issue title <span class="opacity-60">(optional)</span>
        </label>
        <input
          id="linear-title"
          type="text"
          class="w-full px-2.5 py-1.5 rounded-md border border-edge bg-surface text-primary text-[13px] placeholder:text-muted/50 outline-none focus:border-accent"
          placeholder={`Webmux session: ${branch}`}
          bind:value={title}
        />
      </div>
    {/if}

    {#if error}<p class="text-[12px] text-danger mb-3 whitespace-pre-wrap">{error}</p>{/if}

    <div class="flex justify-end gap-2 mt-5">
      <Btn type="button" onclick={onclose} disabled={loading}>Cancel</Btn>
      <Btn
        type="submit"
        variant="cta"
        class="flex items-center gap-1.5"
        disabled={loading || !parsed}
      >{#if loading}<span class="spinner"></span>{/if} Post</Btn>
    </div>
  </form>
</BaseDialog>
