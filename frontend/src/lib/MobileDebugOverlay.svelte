<script lang="ts">
  import { onMount } from "svelte";
  import { getMobileDebugState, setMobileDebugEnabled, subscribeMobileDebug } from "./mobileDebug";
  import type { MobileDebugEntry, MobileDebugValue, MobileDebugState } from "./types";

  const initialState: MobileDebugState = getMobileDebugState();
  let state = initialState;
  let copyLabel = "Copy";

  function formatValue(value: MobileDebugValue): string {
    if (value === undefined) return "-";
    if (value === null) return "null";
    return String(value);
  }

  function formatEntry(entry: MobileDebugEntry): string {
    return Object.entries(entry.fields)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${formatValue(value)}`)
      .join(" ");
  }

  function latestEntries(): MobileDebugEntry[] {
    return Object.keys(state.latest).map((key) => state.latest[key]).filter((entry) => entry !== undefined);
  }

  async function writeToClipboard(text: string): Promise<boolean> {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
      }
    }

    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "true");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    ta.style.pointerEvents = "none";
    document.body.appendChild(ta);
    ta.select();

    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      document.body.removeChild(ta);
    }
  }

  async function copyLogs(): Promise<void> {
    const lines = [
      "[latest]",
      ...latestEntries().map((entry: MobileDebugEntry) => `${entry.timestamp} ${entry.scope} ${formatEntry(entry)}`),
      "",
      "[events]",
      ...state.events.map((entry: MobileDebugEntry) => `${entry.timestamp} ${entry.scope} ${formatEntry(entry)}`),
    ];
    const ok = await writeToClipboard(lines.join("\n"));
    if (ok) {
      copyLabel = "Copied";
      setTimeout(() => {
        copyLabel = "Copy";
      }, 1500);
    } else {
      copyLabel = "Failed";
      setTimeout(() => {
        copyLabel = "Copy";
      }, 1500);
    }
  }

  onMount(() => subscribeMobileDebug(() => {
    state = getMobileDebugState();
  }));
</script>

{#if state.enabled}
  <aside
    class="fixed left-2 right-2 z-[120] rounded-lg border border-edge bg-black/85 p-2 font-mono text-[10px] text-white shadow-xl"
    style="bottom: calc(env(safe-area-inset-bottom, 0px) + 4.5rem);"
  >
    <div class="flex items-center justify-between gap-2">
      <strong class="text-[11px]">Mobile Debug</strong>
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="rounded border border-edge px-2 py-0.5 text-[10px] text-white"
          onclick={copyLogs}
        >
          {copyLabel}
        </button>
        <button
          type="button"
          class="rounded border border-edge px-2 py-0.5 text-[10px] text-white"
          onclick={() => setMobileDebugEnabled(false)}
        >
          Hide
        </button>
      </div>
    </div>

    <div class="mt-2 flex max-h-28 flex-col gap-1 overflow-y-auto">
      {#each latestEntries() as entry (entry.scope)}
        <div>
          <span class="text-accent">{entry.scope}</span>
          <span class="text-white/80">{formatEntry(entry)}</span>
        </div>
      {/each}
    </div>

    <div class="mt-2 border-t border-edge pt-2 text-white/75">
      {#each state.events.slice(0, 6) as entry, index (`${entry.scope}-${entry.timestamp}-${index}`)}
        <div class="truncate">
          <span class="text-white/50">{entry.timestamp}</span>
          <span class="text-accent"> {entry.scope}</span>
          <span> {formatEntry(entry)}</span>
        </div>
      {/each}
    </div>
  </aside>
{/if}
