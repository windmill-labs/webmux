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

  let diff = $state("");
  let truncated = $state(false);
  let loading = $state(true);
  let error = $state("");

  $effect(() => {
    loading = true;
    error = "";
    fetchWorktreeDiff(branch)
      .then((res) => {
        diff = res.diff;
        truncated = res.truncated;
      })
      .catch((err: unknown) => {
        error = errorMessage(err);
      })
      .finally(() => {
        loading = false;
      });
  });

  let rendered = $derived(
    diff
      ? diff2html(diff, {
          outputFormat: "line-by-line",
          colorScheme: ColorSchemeType.DARK,
          drawFileList: false,
        })
      : "",
  );
</script>

<BaseDialog {onclose} wide className="diff-dialog">
  <h2 class="text-base mb-4">Uncommitted Changes &mdash; <span class="font-mono text-sm">{branch}</span></h2>

  {#if loading}
    <div class="text-sm text-muted py-8 text-center">Loading diff...</div>
  {:else if error}
    <div class="text-sm text-danger py-8 text-center">{error}</div>
  {:else if !diff}
    <div class="text-sm text-muted py-8 text-center">No uncommitted changes</div>
  {:else}
    {#if truncated}
      <div class="text-[11px] text-warning mb-2">Diff truncated (exceeded 200KB limit)</div>
    {/if}
    <div class="diff-container overflow-auto max-h-[60vh] md:max-h-[70vh] rounded-md border border-edge">
      {@html rendered}
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
