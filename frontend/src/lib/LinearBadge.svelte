<script lang="ts">
  import type { LinkedLinearIssue } from "./types";

  const badgeClass =
    "shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full";

  let { issue, clickable = false }: {
    issue: LinkedLinearIssue;
    clickable?: boolean;
  } = $props();

  let badgeStyle = $derived(
    `color: ${issue.state.color}; background: ${issue.state.color}20;`,
  );
  let badgeTitle = $derived(`${issue.identifier} (${issue.state.name})`);
</script>

{#if clickable}
  <a
    href={issue.url}
    target="_blank"
    rel="noopener noreferrer"
    class="{badgeClass} no-underline hover:opacity-80"
    style={badgeStyle}
    title={badgeTitle}
  >{issue.identifier}</a>
{:else}
  <span
    class={badgeClass}
    style={badgeStyle}
    title={badgeTitle}
  >{issue.identifier}</span>
{/if}
