<script lang="ts">
  import { html as diff2html } from "diff2html";
  import { ColorSchemeType } from "diff2html/lib/types";
  import "diff2html/bundles/css/diff2html.min.css";
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
  let unpushed = $state("");
  let unpushedTruncated = $state(false);
  let loading = $state(true);
  let error = $state("");

  $effect(() => {
    loading = true;
    error = "";
    fetchWorktreeDiff(branch)
      .then((res) => {
        uncommitted = res.uncommitted;
        uncommittedTruncated = res.uncommittedTruncated;
        unpushed = res.unpushed;
        unpushedTruncated = res.unpushedTruncated;
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
    colorScheme: ColorSchemeType.DARK,
    drawFileList: false,
  };

  let renderedUncommitted = $derived(uncommitted ? diff2html(uncommitted, diffOpts) : "");
  let renderedUnpushed = $derived(unpushed ? diff2html(unpushed, diffOpts) : "");
  let hasContent = $derived(!!uncommitted || !!unpushed);
</script>

<BaseDialog {onclose} wide className="diff-dialog">
  <h2 class="text-base mb-4">Changes &mdash; <span class="font-mono text-sm">{branch}</span></h2>

  {#if loading}
    <div class="text-sm text-muted py-8 text-center">Loading diff...</div>
  {:else if error}
    <div class="text-sm text-danger py-8 text-center">{error}</div>
  {:else if !hasContent}
    <div class="text-sm text-muted py-8 text-center">No changes</div>
  {:else}
    <div class="diff-container overflow-auto max-h-[60vh] md:max-h-[70vh] rounded-md border border-edge">
      {#if uncommitted}
        <div class="section-header">Uncommitted changes</div>
        {#if uncommittedTruncated}
          <div class="text-[11px] text-warning px-3 py-1">Truncated (exceeded 200KB)</div>
        {/if}
        {@html renderedUncommitted}
      {/if}
      {#if unpushed}
        <div class="section-header" class:border-t={!!uncommitted}>Unpushed commits</div>
        {#if unpushedTruncated}
          <div class="text-[11px] text-warning px-3 py-1">Truncated (exceeded 200KB)</div>
        {/if}
        {@html renderedUnpushed}
      {/if}
    </div>
  {/if}

  <div class="flex justify-end mt-4">
    <Btn type="button" onclick={onclose}>Close</Btn>
  </div>
</BaseDialog>

<style>
  :global(.diff-dialog) {
    max-width: 90vw !important;
    width: 90% !important;
  }

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

  .section-header {
    position: sticky;
    top: 0;
    z-index: 1;
    padding: 6px 12px;
    font-size: 11px;
    font-weight: 600;
    color: var(--color-muted);
    background: var(--color-surface);
    border-color: var(--color-edge);
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
