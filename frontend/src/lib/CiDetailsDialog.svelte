<script lang="ts">
  import type { PrEntry } from "./types";
  import { api } from "./api";
  import { normalizeTextForPrompt } from "./promptUtils";
  import { prLabel, errorMessage } from "./utils";
  import { getToastController } from "./toast-context";
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

  let logsByRunId = $state(new Map<number, string>());
  let expandedChecks = $state(new Set<string>());
  let loadingRunId = $state<number | null>(null);
  let logsError = $state("");
  let fixLoading = $state(false);
  let fixError = $state("");
  const toast = getToastController();

  let label = $derived(prLabel(pr));

  function checkKey(check: { name: string; runId: number | null }): string {
    return `${check.name}:${check.runId}`;
  }

  function logsForCheck(check: { name: string; runId: number | null }): string {
    if (check.runId === null) return "";
    const allLogs = logsByRunId.get(check.runId);
    if (!allLogs) return "";
    const prefix = check.name + "\t";
    return allLogs
      .split("\n")
      .filter((line) => line.startsWith(prefix))
      .map((line) => line.slice(prefix.length))
      .join("\n");
  }

  function toggleCheck(key: string): void {
    if (expandedChecks.has(key)) {
      expandedChecks.delete(key);
    } else {
      expandedChecks.add(key);
    }
    expandedChecks = new Set(expandedChecks);
  }

  async function handleViewLogs(check: { runId: number; name: string }): Promise<void> {
    const key = checkKey(check);
    if (logsByRunId.has(check.runId)) {
      toggleCheck(key);
      return;
    }
    expandedChecks.add(key);
    expandedChecks = new Set(expandedChecks);
    logsError = "";
    loadingRunId = check.runId;
    try {
      const { logs } = await api.fetchCiLogs({ params: { runId: check.runId } });
      logsByRunId.set(check.runId, logs);
      logsByRunId = new Map(logsByRunId);
    } catch (err) {
      logsError = errorMessage(err);
      expandedChecks.delete(key);
      expandedChecks = new Set(expandedChecks);
    } finally {
      loadingRunId = null;
    }
  }

  async function handleFix(checkName: string, filteredLogs: string): Promise<void> {
    if (!branch) return;
    fixError = "";
    fixLoading = true;
    const preamble =
      [
        "Fix the failing CI check.",
        `PR: ${label}`,
        `Check: ${checkName}`,
        "",
        "Logs:",
      ].join("\n") + "\n";
    const sanitizedLogs = normalizeTextForPrompt(filteredLogs);
    try {
      await api.sendWorktreePrompt({
        params: { name: branch },
        body: { text: sanitizedLogs, preamble },
      });
      toast.success(`Asked agent to fix ${checkName}`);
      onfixsuccess();
    } catch (err) {
      fixError = errorMessage(err);
    } finally {
      fixLoading = false;
    }
  }

  async function handleCopy(filteredLogs: string): Promise<void> {
    await navigator.clipboard.writeText(filteredLogs);
    toast.success("Copied logs");
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
      {@const key = checkKey(check)}
      {@const cached = check.runId !== null && logsByRunId.has(check.runId)}
      {@const expanded = expandedChecks.has(key)}
      {@const filtered = expanded ? logsForCheck(check) : ""}
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
            {#if cached}
              <LinkBtn onclick={() => toggleCheck(key)}
                >{expanded ? "Hide logs" : "Show logs"}</LinkBtn
              >
            {:else}
              <LinkBtn onclick={() => handleViewLogs({ runId: check.runId!, name: check.name })}
                >View logs</LinkBtn
              >
            {/if}
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

        {#if check.runId !== null && loadingRunId === check.runId && expanded}
          <div class="text-[12px] text-muted py-2 mt-2">Loading logs...</div>
        {:else if expanded && filtered}
          <div class="mt-2">
            <pre
              class="bg-surface border border-edge rounded-md p-3 text-[11px] font-mono overflow-x-auto max-h-[300px] overflow-y-auto whitespace-pre-wrap m-0">{filtered}</pre>
            <div class="flex justify-end items-center gap-2 mt-1.5">
              <LinkBtn onclick={() => handleCopy(filtered)}>Copy logs</LinkBtn>
              <Btn
                variant="cta"
                small
                disabled={!branch || fixLoading}
                onclick={() => handleFix(check.name, filtered)}
                >{fixLoading ? "Asking agent..." : "Ask agent to fix"}</Btn
              >
            </div>
          </div>
        {/if}
        {#if logsError && loadingRunId === null && check.runId !== null && !logsByRunId.has(check.runId)}
          <div class="text-[12px] text-danger py-2 mt-2">{logsError}</div>
        {/if}
        {#if fixError}
          <div class="text-[12px] text-danger py-1.5">{fixError}</div>
        {/if}
      </li>
    {/each}
  </ul>

  <div class="flex justify-end">
    <Btn type="button" onclick={onclose}>Close</Btn>
  </div>
</BaseDialog>
