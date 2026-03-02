<script lang="ts">
  import type { LinearIssue } from "./types";
  import Btn from "./Btn.svelte";

  let {
    issues,
    onassign,
    onselect,
  }: {
    issues: LinearIssue[];
    onassign: (issue: LinearIssue) => void;
    onselect: (issue: LinearIssue) => void;
  } = $props();

  let collapsed = $state(false);
</script>

<div class="border-t border-edge">
  <button
    type="button"
    class="w-full flex items-center justify-between px-4 py-2 text-xs text-muted cursor-pointer bg-transparent border-none hover:bg-hover"
    onclick={() => (collapsed = !collapsed)}
  >
    <span class="font-semibold">Linear ({issues.length})</span>
    <span class="text-[10px]">{collapsed ? "▸" : "▾"}</span>
  </button>

  {#if !collapsed}
    <ul class="list-none overflow-y-auto max-h-64 px-2 pb-2">
      {#each issues as issue (issue.id)}
        <li class="mb-1 p-2 rounded-md border border-transparent hover:bg-hover text-[12px]">
          <div class="flex items-center gap-1.5 mb-0.5">
            <span
              class="shrink-0 w-2 h-2 rounded-full"
              style="background: {issue.state.color};"
              title={issue.state.name}
            ></span>
            <a
              href={issue.url}
              target="_blank"
              rel="noopener noreferrer"
              class="font-mono text-[11px] text-accent no-underline hover:underline"
            >{issue.identifier}</a>
            <span class="text-[10px] text-muted">{issue.priorityLabel}</span>
          </div>
          <button
            type="button"
            class="truncate text-primary mb-1 text-left bg-transparent border-none p-0 cursor-pointer hover:underline w-full"
            title={issue.title}
            onclick={() => onselect(issue)}
          >{issue.title}</button>
          <div class="flex items-center justify-between gap-2">
            <span class="text-[10px] text-muted truncate">
              {issue.team.key}{#if issue.project} · {issue.project}{/if}
            </span>
            <Btn small variant="accent-outline" onclick={() => onassign(issue)}>Assign</Btn>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>
