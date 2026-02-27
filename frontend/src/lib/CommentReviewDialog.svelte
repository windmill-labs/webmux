<script lang="ts">
  import { SvelteSet } from "svelte/reactivity";
  import type { PrEntry } from "./types";
  import { sendWorktreePrompt } from "./api";
  import { normalizeTextForPrompt } from "./promptUtils";
  import { prLabel, errorMessage } from "./utils";
  import BaseDialog from "./BaseDialog.svelte";
  import Btn from "./Btn.svelte";
  import CtaBtn from "./CtaBtn.svelte";
  import LinkBtn from "./LinkBtn.svelte";

  let {
    pr,
    branch,
    onclose,
    onsendsuccess,
  }: {
    pr: PrEntry;
    branch: string;
    onclose: () => void;
    onsendsuccess: () => void;
  } = $props();

  let selected = $state(new SvelteSet<number>());
  let sending = $state(false);
  let sendError = $state("");

  $effect(() => {
    selected = new SvelteSet(pr.comments.map((_, i) => i));
  });

  let label = $derived(prLabel(pr));
  let allSelected = $derived(selected.size === pr.comments.length);
  let noneSelected = $derived(selected.size === 0);

  function toggleAll(): void {
    if (allSelected) {
      selected.clear();
    } else {
      for (let i = 0; i < pr.comments.length; i++) selected.add(i);
    }
  }

  function toggleOne(index: number): void {
    if (selected.has(index)) {
      selected.delete(index);
    } else {
      selected.add(index);
    }
  }

  async function handleSend(): Promise<void> {
    if (!branch || noneSelected) return;
    sending = true;
    sendError = "";
    const preamble =
      [
        "Review the PR comments and elaborate a plan to address them.",
        `PR: ${label}`,
        "",
        "Comments:",
      ].join("\n") + "\n";
    const content = pr.comments
      .filter((_, i) => selected.has(i))
      .map(
        (c, i) =>
          `[${i + 1}] @${c.author} (${c.createdAt.slice(0, 10)}):\n${c.body}`,
      )
      .join("\n\n");
    try {
      await sendWorktreePrompt(
        branch,
        normalizeTextForPrompt(content, 20000),
        preamble,
      );
      onsendsuccess();
    } catch (err) {
      sendError = errorMessage(err);
    } finally {
      sending = false;
    }
  }
</script>

<BaseDialog {onclose} wide>
  <h2 class="text-base mb-4">PR Comments &mdash; {label}</h2>

  <div class="flex items-center justify-between mb-3">
    <LinkBtn onclick={toggleAll}>
      {allSelected ? "Deselect all" : "Select all"}
    </LinkBtn>
    <span class="text-[11px] text-muted">
      {selected.size} of {pr.comments.length} selected
    </span>
  </div>

  <ul class="list-none p-0 m-0 flex flex-col gap-2 mb-4 max-h-[400px] overflow-y-auto">
    {#each pr.comments as comment, i (i)}
      <li class="rounded-md border border-edge bg-surface p-3">
        <label class="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={selected.has(i)}
            onchange={() => toggleOne(i)}
            class="mt-0.5 accent-accent"
          />
          <div class="flex-1 min-w-0">
            <div class="text-[12px] text-muted mb-1">
              <span class="font-medium text-primary">@{comment.author}</span>
              &middot; {comment.createdAt.slice(0, 10)}
            </div>
            <pre class="text-[11px] font-mono whitespace-pre-wrap m-0 text-primary/80">{comment.body}</pre>
          </div>
        </label>
      </li>
    {/each}
  </ul>

  {#if sendError}
    <div class="text-[12px] text-danger mb-3">{sendError}</div>
  {/if}

  <div class="flex justify-end gap-2">
    <Btn type="button" onclick={onclose}>Cancel</Btn>
    <CtaBtn
      disabled={noneSelected || sending}
      onclick={handleSend}
    >
      {sending ? "Sending..." : `Send ${selected.size} to agent`}
    </CtaBtn>
  </div>
</BaseDialog>
