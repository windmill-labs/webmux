<script lang="ts">
  import Toggle from "./Toggle.svelte";

  let {
    startupEnvs = {},
    envValues = $bindable({}),
  }: {
    startupEnvs: Record<string, string | boolean>;
    envValues: Record<string, string | boolean>;
  } = $props();

  let envKeys = $derived(Object.keys(startupEnvs));
</script>

{#if envKeys.length > 0}
  <div class="mb-4">
    <p class="text-xs text-muted mb-2">Startup Environment <span class="opacity-60">(optional)</span></p>
    <div class="pl-3 border-l border-edge">
      {#each envKeys as key (key)}
        {#if typeof startupEnvs[key] === "boolean"}
          <div class="mb-3">
            <label class="flex items-center gap-2 text-xs text-muted cursor-pointer" for="wt-env-{key}">
              <Toggle
                id="wt-env-{key}"
                aria-label={key}
                bind:checked={() => envValues[key] as boolean, (v) => envValues[key] = v}
              />
              {key}
            </label>
          </div>
        {:else}
          <div class="mb-3">
            <label class="block text-xs text-muted mb-1.5" for="wt-env-{key}">{key}</label>
            <input
              id="wt-env-{key}"
              type="text"
              class="w-full px-2.5 py-1.5 rounded-md border border-edge bg-surface text-primary text-[13px] placeholder:text-muted/50 outline-none focus:border-accent"
              bind:value={() => envValues[key], (v) => envValues[key] = v}
            />
          </div>
        {/if}
      {/each}
    </div>
  </div>
{/if}
