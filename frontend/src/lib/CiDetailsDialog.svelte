<script lang="ts">
  import type { PrEntry } from "./types";
  import { fetchCiLogs, sendWorktreePrompt } from "./api";
  import { normalizeTextForPrompt } from "./promptUtils";
  import { prLabel, errorMessage } from "./utils";
  import BaseDialog from "./BaseDialog.svelte";
  import Btn from "./Btn.svelte";
  import LinkBtn from "./LinkBtn.svelte";

  let {
    pr,
    branch,
    onclose,
    onfixsuccess,
  }: {
    pr: PrEntry;
    branch: string;
    onclose: () => void;
    onfixsuccess: () => void;
  } = $props();

  let expandedCheck = $state<string | null>(null);
  let logs = $state("");
  let logsLoading = $state(false);
  let logsError = $state("");
  let copied = $state(false);
  let fixLoading = $state<string | null>(null);
  let fixError = $state("");

  let label = $derived(prLabel(pr));

  function checkKey(check: { name: string; runId: number | null }): string {
    return `${check.name}:${check.runId}`;
  }

  async function handleViewLogs(check: { runId: number; name: string }): Promise<void> {
    const key = checkKey(check);
    if (expandedCheck === key) {
      expandedCheck = null;
      return;
    }
    expandedCheck = key;
    logs = "";
    logsError = "";
    logsLoading = true;
    copied = false;
    fixError = "";
    try {
      logs = await fetchCiLogs(check.runId, check.name);
    } catch (err) {
      logsError = errorMessage(err);
    } finally {
      logsLoading = false;
    }
  }

  async function handleFix(checkName: string): Promise<void> {
    if (!branch) return;
    fixError = "";
    fixLoading = expandedCheck;
    const preamble =
      [
        "Fix the failing CI check.",
        `PR: ${label}`,
        `Check: ${checkName}`,
        "",
        "Logs:",
      ].join("\n") + "\n";
    const sanitizedLogs = normalizeTextForPrompt(logs);
    try {
      await sendWorktreePrompt(branch, sanitizedLogs, preamble);
      onfixsuccess();
    } catch (err) {
      fixError = errorMessage(err);
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
</script>

<BaseDialog {onclose} wide>
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
          {#if check.status === "failed" && check.runId !== null}
            <LinkBtn
              onclick={() => handleViewLogs({ runId: check.runId!, name: check.name })}
              >{expandedCheck === checkKey(check)
                ? "Hide logs"
                : "View logs"}</LinkBtn
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

        {#if expandedCheck === checkKey(check)}
          <div class="mt-2">
            {#if logsLoading}
              <div class="text-[12px] text-muted py-2">Loading logs...</div>
            {:else if logsError}
              <div class="text-[12px] text-danger py-2">{logsError}</div>
            {:else if logs}
              <pre
                class="bg-surface border border-edge rounded-md p-3 text-[11px] font-mono overflow-x-auto max-h-[300px] overflow-y-auto whitespace-pre-wrap m-0">{logs}</pre>
              <div class="flex justify-end items-center gap-2 mt-1.5">
                <LinkBtn onclick={handleCopy}
                  >{copied ? "Copied!" : "Copy logs"}</LinkBtn
                >
                <Btn
                  variant="cta"
                  small
                  disabled={!branch ||
                    !logs ||
                    logsLoading ||
                    fixLoading !== null}
                  onclick={() => handleFix(check.name)}
                  >{fixLoading !== null
                    ? "Asking agent..."
                    : "Ask agent to fix"}</Btn
                >
              </div>
            {/if}
            {#if fixError}
              <div class="text-[12px] text-danger py-1.5">{fixError}</div>
            {/if}
          </div>
        {/if}
      </li>
    {/each}
  </ul>

  <div class="flex justify-end">
    <Btn type="button" onclick={onclose}>Close</Btn>
  </div>
</BaseDialog>
