<script lang="ts">
  import type { LinearIssue } from "./types";
  import { fuzzyMatch } from "./utils";
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

  let collapsed = $state(true);
  let query = $state("");

  let filtered = $derived(
    query
      ? issues.filter(
          (i) =>
            fuzzyMatch(query, i.title) ||
            (i.description ? fuzzyMatch(query, i.description) : false),
        )
      : issues,
  );
</script>

<div class="border-t border-edge">
  <button
    type="button"
    class="w-full flex items-center justify-between px-4 py-2 text-xs text-muted cursor-pointer bg-transparent border-none hover:bg-hover"
    onclick={() => (collapsed = !collapsed)}
  >
    <span class="font-semibold">Linear ({filtered.length !== issues.length ? `${filtered.length}/` : ""}{issues.length})</span>
    <span class="text-[10px]">{collapsed ? "▸" : "▾"}</span>
  </button>

  {#if !collapsed}
    <div class="px-2 pb-1">
      <input
        type="text"
        placeholder="Search issues…"
        class="w-full px-2 py-1 text-xs rounded border border-edge bg-surface text-primary placeholder:text-muted outline-none focus:border-accent"
        bind:value={query}
      />
    </div>
    <ul class="list-none overflow-y-auto max-h-64 px-2 pb-2">
      {#each filtered as issue (issue.id)}
        <li>
          <button
            type="button"
            class="w-full text-left mb-1 p-2 rounded-md border border-transparent hover:bg-hover text-[12px] cursor-pointer bg-transparent"
            onclick={() => onselect(issue)}
          >
          <div class="flex items-center gap-1.5 mb-0.5">
            <span
              class="shrink-0 w-2 h-2 rounded-full"
              style="background: {issue.state.color};"
              title={issue.state.name}
            ></span>
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <a
              href={issue.url}
              target="_blank"
              rel="noopener noreferrer"
              class="font-mono text-[11px] text-accent no-underline hover:underline"
              onclick={(e: MouseEvent) => e.stopPropagation()}
            >{issue.identifier}</a>
            <span class="text-[10px] text-muted">{issue.priorityLabel}</span>
          </div>
          <p class="truncate text-primary mb-1 m-0">{issue.title}</p>
          {#if issue.description}
            <p class="text-[10px] text-muted truncate m-0 mb-1">{issue.description}</p>
          {/if}
          <div class="flex items-center justify-between gap-2">
            <span class="text-[10px] text-muted truncate">
              {issue.team.key}{#if issue.project} · {issue.project}{/if}
            </span>
            <span onclick={(e: MouseEvent) => e.stopPropagation()} onkeydown={(e: KeyboardEvent) => e.stopPropagation()} role="none">
              <Btn small variant="accent-outline" onclick={() => onassign(issue)}>Implement</Btn>
            </span>
          </div>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>
