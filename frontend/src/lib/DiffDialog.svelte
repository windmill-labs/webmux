<script lang="ts">
  import { html as diff2html } from "diff2html";
  import { ColorSchemeType } from "diff2html/lib/types";
  import "diff2html/bundles/css/diff2html.min.css";
  import type { UnpushedCommit } from "./types";
  import { fetchWorktreeDiff } from "./api";
  import { errorMessage } from "./utils";
  import BaseDialog from "./BaseDialog.svelte";
  import Btn from "./Btn.svelte";

  let {
    branch,
    onclose,
  }: {
    branch: string;
    onclose: () => void;
  } = $props();

  let uncommitted = $state("");
  let uncommittedTruncated = $state(false);
  let unpushedCommits = $state<UnpushedCommit[]>([]);
  let loading = $state(true);
  let error = $state("");

  $effect(() => {
    loading = true;
    error = "";
    fetchWorktreeDiff(branch)
      .then((res) => {
        uncommitted = res.uncommitted;
        uncommittedTruncated = res.uncommittedTruncated;
        unpushedCommits = res.unpushedCommits;
      })
      .catch((err: unknown) => {
        error = errorMessage(err);
      })
      .finally(() => {
        loading = false;
      });
  });

  const diffOpts = {
    outputFormat: "line-by-line" as const,
    colorScheme: ColorSchemeType.AUTO,
    drawFileList: false,
  };

  let renderedUncommitted = $derived(uncommitted ? diff2html(uncommitted, diffOpts) : "");
  let hasContent = $derived(!!uncommitted || unpushedCommits.length > 0);

  type DiffTab = "diff" | "unpushed";
  let activeTab = $state<DiffTab>("diff");

  let initialTabSet = false;
  $effect(() => {
    if (!loading && !error && !initialTabSet) {
      initialTabSet = true;
      activeTab = uncommitted ? "diff" : "unpushed";
    }
  });
</script>

<BaseDialog {onclose} wide maxWidth="90vw" className="diff-dialog">
  <h2 class="text-base mb-4">Changes &mdash; <span class="font-mono text-sm">{branch}</span></h2>

  {#if loading}
    <div class="text-sm text-muted py-8 text-center">Loading diff...</div>
  {:else if error}
    <div class="text-sm text-danger py-8 text-center">{error}</div>
  {:else if !hasContent}
    <div class="text-sm text-muted py-8 text-center">No changes</div>
  {:else}
    <div class="flex gap-1 mb-3">
      <button
        type="button"
        class="tab-btn"
        class:active={activeTab === "diff"}
        disabled={!uncommitted}
        onclick={() => (activeTab = "diff")}
      >Current diff</button>
      <button
        type="button"
        class="tab-btn"
        class:active={activeTab === "unpushed"}
        disabled={unpushedCommits.length === 0}
        onclick={() => (activeTab = "unpushed")}
      >Unpushed commits ({unpushedCommits.length})</button>
    </div>

    {#if activeTab === "diff" && uncommitted}
      <div class="diff-container overflow-auto max-h-[60vh] md:max-h-[70vh] rounded-md border border-edge">
        {#if uncommittedTruncated}
          <div class="text-[11px] text-warning px-3 py-1">Truncated (exceeded 200KB)</div>
        {/if}
        {@html renderedUncommitted}
      </div>
    {:else if activeTab === "unpushed" && unpushedCommits.length > 0}
      <ul class="commit-list overflow-auto max-h-[60vh] md:max-h-[70vh] rounded-md border border-edge list-none m-0 p-0">
        {#each unpushedCommits as commit (commit.hash)}
          <li class="flex items-baseline gap-2 px-3 py-1.5 border-b border-edge last:border-b-0">
            <code class="text-[11px] text-accent shrink-0">{commit.hash}</code>
            <span class="text-[12px] text-primary">{commit.message}</span>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}

  <div class="flex justify-end mt-4">
    <Btn type="button" onclick={onclose}>Close</Btn>
  </div>
</BaseDialog>

<style>
  @media (max-width: 768px) {
    :global(.diff-dialog) {
      max-width: 100vw !important;
      width: 100% !important;
      height: 100dvh;
      max-height: 100dvh;
      margin: 0;
      border-radius: 0 !important;
      font-size: 11px;
    }
  }

  .tab-btn {
    padding: 4px 12px;
    font-size: 11px;
    border-radius: 4px;
    border: 1px solid var(--color-edge);
    background: transparent;
    color: var(--color-muted);
    cursor: pointer;
  }
  .tab-btn:hover {
    color: var(--color-primary);
    background: var(--color-hover);
  }
  .tab-btn.active {
    background: var(--color-surface);
    color: var(--color-primary);
    border-color: var(--color-accent);
  }
  .tab-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .tab-btn:disabled:hover {
    color: var(--color-muted);
    background: transparent;
  }

  .diff-container {
    font-size: 12px;
  }

  .diff-container :global(.d2h-wrapper) {
    background: transparent;
  }
  .diff-container :global(.d2h-file-header) {
    background: var(--color-surface);
    border-color: var(--color-edge);
    color: var(--color-primary);
  }
  .diff-container :global(.d2h-file-name) {
    color: var(--color-primary);
  }
  .diff-container :global(.d2h-code-linenumber),
  .diff-container :global(.d2h-code-line) {
    color: var(--color-primary);
    font-size: 11px;
  }
  .diff-container :global(.d2h-code-line-ctn) {
    color: var(--color-primary);
  }
  .diff-container :global(td.d2h-code-linenumber) {
    border-color: var(--color-edge);
    position: static;
  }

  @media (max-width: 768px) {
    .diff-container {
      max-height: calc(100dvh - 8rem) !important;
      font-size: 10px;
    }
    .diff-container :global(.d2h-code-line),
    .diff-container :global(.d2h-code-linenumber) {
      font-size: 10px;
      padding: 0 4px;
    }
  }
</style>
