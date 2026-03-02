<script lang="ts">
  import { untrack } from "svelte";
  import { SvelteSet } from "svelte/reactivity";
  import type { PrEntry, PrComment, PrReviewComment } from "./types";
  import { sendWorktreePrompt } from "./api";
  import { normalizeTextForPrompt } from "./promptUtils";
  import { prLabel, errorMessage } from "./utils";
  import BaseDialog from "./BaseDialog.svelte";
  import Btn from "./Btn.svelte";
  import LinkBtn from "./LinkBtn.svelte";

  type CommentItem =
    | { kind: "comment"; data: PrComment }
    | { kind: "review"; data: PrReviewComment };

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

  let sending = $state(false);
  let sendError = $state("");

  let items = $derived.by((): CommentItem[] => {
    const comments: CommentItem[] = pr.comments.map((c) => ({ kind: "comment", data: c }));
    const reviews: CommentItem[] = (pr.reviewComments ?? []).map((r) => ({ kind: "review", data: r }));
    return [...comments, ...reviews].sort(
      (a, b) => new Date(a.data.createdAt).getTime() - new Date(b.data.createdAt).getTime(),
    );
  });

  const selected = new SvelteSet<number>();

  $effect(() => {
    const len = items.length;
    untrack(() => {
      selected.clear();
      for (let i = 0; i < len; i++) selected.add(i);
    });
  });

  let label = $derived(prLabel(pr));
  let allSelected = $derived(selected.size === items.length);
  let noneSelected = $derived(selected.size === 0);

  function toggleAll(): void {
    if (allSelected) {
      selected.clear();
    } else {
      for (let i = 0; i < items.length; i++) selected.add(i);
    }
  }

  function toggleOne(index: number): void {
    if (selected.has(index)) {
      selected.delete(index);
    } else {
      selected.add(index);
    }
  }

  function formatItem(item: CommentItem, idx: number): string {
    if (item.kind === "review") {
      const r = item.data;
      const loc = r.line ? `${r.path}:${r.line}` : r.path;
      const hunk = r.diffHunk ? `\n\`\`\`diff\n${r.diffHunk}\n\`\`\`\n` : "\n";
      return `[${idx}] @${r.author} (${r.createdAt.slice(0, 10)}) on ${loc}:${hunk}${r.body}`;
    }
    const c = item.data;
    return `[${idx}] @${c.author} (${c.createdAt.slice(0, 10)}):\n${c.body}`;
  }

  async function handleSend(): Promise<void> {
    if (!branch || noneSelected) return;
    sending = true;
    sendError = "";
    const preamble =
      [
        "Review the PR comments (including inline review comments) and elaborate a plan to address them.",
        `PR: ${label}`,
        "",
        "Comments:",
      ].join("\n") + "\n";
    const content = items
      .filter((_, i) => selected.has(i))
      .map((item, i) => formatItem(item, i + 1))
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
      {selected.size} of {items.length} selected
    </span>
  </div>

  <ul class="list-none p-0 m-0 flex flex-col gap-2 mb-4 max-h-[400px] overflow-y-auto">
    {#each items as item, i (i)}
      <li class="rounded-md border border-edge bg-surface p-3">
        <label class="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={selected.has(i)}
            onchange={() => toggleOne(i)}
            class="mt-0.5 accent-accent"
          />
          <div class="flex-1 min-w-0">
            {#if item.kind === "review"}
              <div class="text-[10px] font-mono text-accent mb-1 truncate" title={item.data.path}>
                {item.data.path}{item.data.line ? `:${item.data.line}` : ""}
                {#if item.data.isReply}
                  <span class="text-muted ml-1">(reply)</span>
                {/if}
              </div>
            {/if}
            <div class="text-[12px] text-muted mb-1">
              <span class="font-medium text-primary">@{item.data.author}</span>
              &middot; {item.data.createdAt.slice(0, 10)}
              {#if item.kind === "review"}
                <span class="text-accent/60 ml-1">review</span>
              {/if}
            </div>
            <pre class="text-[11px] font-mono whitespace-pre-wrap m-0 text-primary/80">{item.data.body}</pre>
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
    <Btn
      variant="cta"
      small
      disabled={noneSelected || sending}
      onclick={handleSend}
    >
      {sending ? "Sending..." : `Send ${selected.size} to agent`}
    </Btn>
  </div>
</BaseDialog>
