<script lang="ts">
  import { parseLinearTarget } from "@webmux/api-contract";
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

  let teamKey = $state("");
  let title = $state("");
  let loading = $state(false);
  let error = $state("");

  let teamKeyTrimmed = $derived(teamKey.trim().toUpperCase());
  let teamKeyParsed = $derived(parseLinearTarget(teamKeyTrimmed));
  let teamKeyLooksLikeIssue = $derived(teamKeyParsed.kind === "issue");
  let teamKeyValid = $derived(teamKeyParsed.kind === "team");

  async function handleSubmit(): Promise<void> {
    if (!teamKeyValid || loading) return;
    loading = true;
    error = "";
    try {
      const target: PostWorktreeToLinearTarget = title.trim()
        ? { kind: "team", teamKey: teamKeyTrimmed, title: title.trim() }
        : { kind: "team", teamKey: teamKeyTrimmed };
      await onsubmit(target);
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
      Creates a new Linear issue for branch <span class="font-mono">{branch}</span> and attaches the conversation as JSON + a summary comment.
      To post back into an existing issue, start the worktree from the Linear panel (bottom-left) — picking an issue there seeds the session and routes the post-back to that issue automatically.
    </p>

    <div class="mb-3">
      <label class="block text-xs text-muted mb-1.5" for="linear-team">Team key</label>
      <input
        id="linear-team"
        type="text"
        class="w-full px-2.5 py-1.5 rounded-md border border-edge bg-surface text-primary text-[13px] placeholder:text-muted/50 outline-none focus:border-accent font-mono uppercase"
        placeholder="ENG"
        bind:value={teamKey}
        autocomplete="off"
      />
      {#if teamKeyTrimmed && teamKeyLooksLikeIssue}
        <p class="mt-1 text-[11px] text-danger">
          Looks like an issue id. Start the worktree from the Linear panel (bottom-left) to seed it with that issue — the worktree menu will then offer a direct &quot;Post conversation to {teamKeyTrimmed}&quot; action.
        </p>
      {:else if teamKeyTrimmed && !teamKeyValid}
        <p class="mt-1 text-[11px] text-danger">Expected a team key like ENG (uppercase letters only).</p>
      {/if}
    </div>

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

    {#if error}<p class="text-[12px] text-danger mb-3 whitespace-pre-wrap">{error}</p>{/if}

    <div class="flex justify-end gap-2 mt-5">
      <Btn type="button" onclick={onclose} disabled={loading}>Cancel</Btn>
      <Btn
        type="submit"
        variant="cta"
        class="flex items-center gap-1.5"
        disabled={loading || !teamKeyValid}
      >{#if loading}<span class="spinner"></span>{/if} Post</Btn>
    </div>
  </form>
</BaseDialog>
