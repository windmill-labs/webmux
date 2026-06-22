<script lang="ts">
  import { onMount } from "svelte";
  import { setUpProject } from "./api";
  import { applyTheme, loadSavedTheme, projectInitPhaseLabel } from "./utils";
  import type { ProjectInitPhase } from "./types";

  let path = $state("");
  let error = $state<string | null>(null);
  let busy = $state(false);
  let phase = $state<ProjectInitPhase | null>(null);

  onMount(() => {
    applyTheme(loadSavedTheme());
  });

  async function add(): Promise<void> {
    const target = path.trim();
    if (!target || busy) return;
    busy = true;
    error = null;
    phase = null;
    try {
      const { prefix } = await setUpProject(target, (next) => (phase = next));
      window.location.assign(`/${prefix}/`);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      busy = false;
      phase = null;
    }
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      event.preventDefault();
      void add();
    }
  }
</script>

<div class="min-h-screen flex items-center justify-center bg-bg text-primary p-6">
  <div class="w-full max-w-md">
    <h1 class="text-lg font-semibold mb-2">No projects yet</h1>
    <p class="text-sm text-muted mb-4">
      webmux serves every project from this one dashboard. Add a git repo below
      and webmux sets it up for you — scaffolding a
      <code class="text-primary">.webmux.yaml</code> and analyzing the project
      to fill it in.
    </p>
    <div class="flex gap-2">
      <input
        type="text"
        bind:value={path}
        onkeydown={onKeydown}
        placeholder="Path to a git repo"
        disabled={busy}
        class="flex-1 min-w-0 px-3 py-2 text-sm rounded border border-edge bg-surface text-primary placeholder:text-muted disabled:opacity-50"
      />
      <button
        type="button"
        class="shrink-0 px-3 py-2 text-sm rounded border border-edge text-primary hover:bg-hover disabled:opacity-50"
        disabled={busy || path.trim() === ""}
        onclick={add}
      >
        Add
      </button>
    </div>
    {#if busy && phase}
      <div class="mt-3 flex items-center gap-2 text-sm text-muted">
        <span class="spinner"></span>
        {projectInitPhaseLabel(phase)}…
      </div>
    {/if}
    {#if error}
      <div class="mt-2 text-sm text-red-400 break-words">{error}</div>
    {/if}
  </div>
</div>
