<script lang="ts">
  import type { LinearIssue, LinearIssueAvailability } from "./types";
  import { searchMatch } from "./utils";
  import Btn from "./Btn.svelte";

  let {
    issues,
    availability,
    onassign,
    onselect,
  }: {
    issues: LinearIssue[];
    availability: LinearIssueAvailability;
    onassign: (issue: LinearIssue) => void;
    onselect: (issue: LinearIssue) => void;
  } = $props();

  let collapsed = $state(true);
  let query = $state("");

  let filtered = $derived(
    query
      ? issues.filter(
          (i) =>
            searchMatch(query, i.title) ||
            (i.description ? searchMatch(query, i.description) : false),
        )
      : issues,
  );
  let countLabel = $derived(
    availability === "ready"
      ? ` (${filtered.length !== issues.length ? `${filtered.length}/` : ""}${issues.length})`
      : "",
  );
</script>

<div class="border-t border-edge">
  <button
    type="button"
    class="w-full flex items-center justify-between px-4 py-2 text-xs text-muted cursor-pointer bg-transparent border-none hover:bg-hover"
    onclick={() => (collapsed = !collapsed)}
  >
    <span class="font-semibold">Linear{countLabel}</span>
    <span class="text-[10px]">{collapsed ? "▸" : "▾"}</span>
  </button>

  {#if !collapsed}
    {#if availability === "missing_api_key"}
      <p class="m-0 px-4 pb-3 text-xs text-muted">
        Set <code>LINEAR_API_KEY</code> to show your assigned Linear issues here.
      </p>
    {:else if availability === "ready"}
      {#if issues.length === 0}
        <p class="m-0 px-4 pb-3 text-xs text-muted">
          No assigned Linear issues right now.
        </p>
      {:else}
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
            <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
            <li
              class="mb-1 p-2 rounded-md border border-transparent hover:bg-hover text-[12px] cursor-pointer"
              onclick={() => onselect(issue)}
              onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onselect(issue); } }}
              role="button"
              tabindex="0"
            >
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
                  onclick={(e: MouseEvent) => e.stopPropagation()}
                  onkeydown={(e: KeyboardEvent) => e.stopPropagation()}
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
                <span
                  onclick={(e: MouseEvent) => e.stopPropagation()}
                  onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); }}
                  role="none"
                >
                  <Btn small variant="accent-outline" onclick={() => onassign(issue)}>Implement</Btn>
                </span>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    {:else}
      <p class="m-0 px-4 pb-3 text-xs text-muted">
        Linear integration is disabled in this project.
      </p>
    {/if}
  {/if}
</div>
