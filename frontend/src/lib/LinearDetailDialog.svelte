<script lang="ts">
  import type { LinearIssue } from "./types";
  import BaseDialog from "./BaseDialog.svelte";
  import Btn from "./Btn.svelte";

  let {
    issue,
    onassign,
    onclose,
  }: {
    issue: LinearIssue;
    onassign: (issue: LinearIssue) => void;
    onclose: () => void;
  } = $props();
</script>

<BaseDialog {onclose} wide>
  <div class="flex items-center gap-2 mb-1">
    <span
      class="shrink-0 w-2.5 h-2.5 rounded-full"
      style="background: {issue.state.color};"
      title={issue.state.name}
    ></span>
    <a
      href={issue.url}
      target="_blank"
      rel="noopener noreferrer"
      class="font-mono text-xs text-accent no-underline hover:underline"
    >{issue.identifier}</a>
    <span class="text-[11px] text-muted">{issue.state.name}</span>
    <span class="text-[11px] text-muted">· {issue.priorityLabel}</span>
  </div>

  <h2 class="text-base font-semibold mb-3">{issue.title}</h2>

  {#if issue.description}
    <div class="text-[13px] text-secondary whitespace-pre-wrap max-h-64 overflow-y-auto mb-4 leading-relaxed">
      {issue.description}
    </div>
  {:else}
    <p class="text-[13px] text-muted italic mb-4">No description</p>
  {/if}

  <div class="flex items-center gap-3 text-[11px] text-muted mb-4">
    <span>{issue.team.key}</span>
    {#if issue.project}
      <span>· {issue.project}</span>
    {/if}
    {#if issue.labels.length > 0}
      {#each issue.labels as label (label.name)}
        <span
          class="px-1.5 py-0.5 rounded-full text-[10px]"
          style="color: {label.color}; background: {label.color}20;"
        >{label.name}</span>
      {/each}
    {/if}
    {#if issue.dueDate}
      <span>Due {issue.dueDate}</span>
    {/if}
  </div>

  <div class="flex justify-end gap-2">
    <Btn onclick={onclose}>Close</Btn>
    <Btn variant="accent-outline" onclick={() => onassign(issue)}>Implement</Btn>
  </div>
</BaseDialog>
