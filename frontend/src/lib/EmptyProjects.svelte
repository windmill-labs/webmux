<script lang="ts">
  import { onMount } from "svelte";
  import { addProject } from "./api";
  import { applyTheme, loadSavedTheme } from "./utils";

  let path = $state("");
  let error = $state<string | null>(null);
  let busy = $state(false);

  onMount(() => {
    applyTheme(loadSavedTheme());
  });

  async function add(): Promise<void> {
    const target = path.trim();
    if (!target || busy) return;
    busy = true;
    error = null;
    try {
      const project = await addProject(target);
      window.location.assign(`/${project.prefix}/`);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      busy = false;
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
      webmux serves every project from this one dashboard. Run
      <code class="text-primary">webmux init</code> in a git repo to create a
      <code class="text-primary">.webmux.yaml</code>, then start webmux there — or add an
      existing webmux project below.
    </p>
    <div class="flex gap-2">
      <input
        type="text"
        bind:value={path}
        onkeydown={onKeydown}
        placeholder="Path to a git repo with .webmux.yaml"
        class="flex-1 min-w-0 px-3 py-2 text-sm rounded border border-edge bg-surface text-primary placeholder:text-muted"
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
    {#if error}
      <div class="mt-2 text-sm text-red-400 break-words">{error}</div>
    {/if}
  </div>
</div>
