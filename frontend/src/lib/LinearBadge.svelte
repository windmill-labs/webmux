<script lang="ts">
  import type { LinkedLinearIssue } from "./types";

  let { issue }: { issue: LinkedLinearIssue } = $props();
</script>

<a
  href={issue.url}
  target="_blank"
  rel="noopener noreferrer"
  class="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full no-underline hover:opacity-80"
  style="color: {issue.state.color}; background: {issue.state.color}20;"
  title="{issue.identifier} ({issue.state.name})"
>{issue.identifier}</a>
