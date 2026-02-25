<script lang="ts">
  import type { PrEntry } from "./types";
  import { fetchCiLogs, sendWorktreePrompt } from "./api";

  let {
    pr,
    branch,
    onclose,
  }: {
    pr: PrEntry;
    branch: string;
    onclose: () => void;
  } = $props();

  let dialogEl: HTMLDialogElement;
  let expandedRunId = $state<number | null>(null);
  let logs = $state("");
  let logsLoading = $state(false);
  let logsError = $state("");
  let copied = $state(false);
  let fixLoading = $state<number | null>(null);
  let fixError = $state("");
  let fixSuccess = $state(false);

  function stripAnsi(input: string): string {
    return input
      .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
      .replace(/\x1B[@-_]/g, "");
  }

  function normalizeLogsForPrompt(input: string): string {
    const noAnsi = stripAnsi(input).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    // Keep tabs/newlines and printable ASCII only to avoid terminal control issues.
    return noAnsi.replace(/[^\x09\x0A\x20-\x7E]/g, "");
  }

  $effect(() => {
    dialogEl?.showModal();
  });

  let label = $derived(
    pr.repo ? `${pr.repo} #${pr.number}` : `PR #${pr.number}`,
  );

  async function handleViewLogs(runId: number): Promise<void> {
    if (expandedRunId === runId) {
      expandedRunId = null;
      return;
    }
    expandedRunId = runId;
    logs = "";
    logsError = "";
    logsLoading = true;
    copied = false;
    fixError = "";
    fixSuccess = false;
    try {
      logs = await fetchCiLogs(runId);
    } catch (err) {
      logsError = err instanceof Error ? err.message : String(err);
    } finally {
      logsLoading = false;
    }
  }

  async function handleFix(checkName: string): Promise<void> {
    if (!branch) return;
    fixError = "";
    fixSuccess = false;
    fixLoading = expandedRunId ?? -1;
    const preamble = [
      "Fix the failing CI check.",
      `PR: ${label}`,
      `Check: ${checkName}`,
      "",
      "Logs:",
    ].join("\n") + "\n";
    const sanitizedLogs = normalizeLogsForPrompt(logs);
    try {
      await sendWorktreePrompt(branch, sanitizedLogs, preamble);
      fixSuccess = true;
      setTimeout(() => {
        fixSuccess = false;
      }, 3000);
    } catch (err) {
      fixError = err instanceof Error ? err.message : String(err);
    } finally {
      fixLoading = null;
    }
  }
  async function handleCopy(): Promise<void> {
    await navigator.clipboard.writeText(logs);
    copied = true;
    setTimeout(() => {
      copied = false;
    }, 2000);
  }

  function statusIcon(status: string): string {
    if (status === "success") return "\u2713";
    if (status === "failed") return "\u2717";
    if (status === "skipped") return "\u2014";
    return "\u25CB";
  }

  function statusColor(status: string): string {
    if (status === "success") return "text-success";
    if (status === "failed") return "text-danger";
    if (status === "pending") return "text-warning";
    return "text-muted";
  }

  const btn =
    "px-3 py-1.5 rounded-md border border-edge bg-surface text-primary text-xs cursor-pointer hover:bg-hover";
  const linkBtn =
    "text-[11px] text-accent cursor-pointer bg-transparent border-none p-0 hover:underline disabled:opacity-50 disabled:cursor-not-allowed";
  const ctaBtn =
    "text-[11px] font-semibold text-white bg-accent border border-accent px-2.5 py-1 rounded-md cursor-pointer hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed";
</script>

<dialog
  bind:this={dialogEl}
  {onclose}
  class="bg-sidebar text-primary border border-edge rounded-xl p-6 max-w-[560px] w-[90%]"
>
  <h2 class="text-base mb-4">CI Checks &mdash; {label}</h2>

  <ul class="list-none p-0 m-0 flex flex-col gap-2 mb-4">
    {#each pr.ciChecks as check (check.name + check.runId)}
      <li class="rounded-md border border-edge bg-surface p-3">
        <div class="flex items-center gap-2">
          <span class="text-sm font-bold {statusColor(check.status)}"
            >{statusIcon(check.status)}</span
          >
          <span class="text-[13px] font-medium flex-1 truncate"
            >{check.name}</span
          >
          <span class="text-[11px] {statusColor(check.status)}"
            >{check.status}</span
          >
        </div>
        <div class="flex items-center gap-2 mt-1.5">
          {#if check.status === "failed" && check.runId}
            <button
              type="button"
              class={linkBtn}
              onclick={() => handleViewLogs(check.runId)}
              >{expandedRunId === check.runId
                ? "Hide logs"
                : "View logs"}</button
            >
          {/if}
          {#if check.url}
            <a
              href={check.url}
              target="_blank"
              rel="noopener"
              class="text-[11px] text-muted hover:text-primary no-underline hover:underline"
              >GitHub &nearr;</a
            >
          {/if}
        </div>

        {#if expandedRunId === check.runId}
          <div class="mt-2">
            {#if logsLoading}
              <div class="text-[12px] text-muted py-2">Loading logs...</div>
            {:else if logsError}
              <div class="text-[12px] text-danger py-2">{logsError}</div>
            {:else if logs}
              <pre
                class="bg-surface border border-edge rounded-md p-3 text-[11px] font-mono overflow-x-auto max-h-[300px] overflow-y-auto whitespace-pre-wrap m-0">{logs}</pre>
              <div class="flex justify-end items-center gap-2 mt-1.5">
                <button type="button" class={linkBtn} onclick={handleCopy}
                  >{copied ? "Copied!" : "Copy logs"}</button
                >
                <button
                  type="button"
                  class={ctaBtn}
                  disabled={!branch ||
                    !logs ||
                    logsLoading ||
                    fixLoading !== null}
                  onclick={() => handleFix(check.name)}
                  >{fixLoading !== null
                    ? "Asking agent..."
                    : "Ask agent to fix"}</button
                >
              </div>
            {/if}
            {#if fixError}
              <div class="text-[12px] text-danger py-1.5">{fixError}</div>
            {:else if fixSuccess}
              <div class="text-[12px] text-success py-1.5">Sent to agent.</div>
            {/if}
          </div>
        {/if}
      </li>
    {/each}
  </ul>

  <div class="flex justify-end">
    <button type="button" class={btn} onclick={onclose}>Close</button>
  </div>
</dialog>
