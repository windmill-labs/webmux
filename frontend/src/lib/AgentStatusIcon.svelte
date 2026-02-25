<script lang="ts">
  let {
    status,
    size = 10,
    pill = false,
  }: { status: string; size?: number; pill?: boolean } = $props();

  function pillClass(s: string): string {
    if (s === "working") return "bg-success/15 text-success";
    if (s === "waiting") return "bg-warning/15 text-warning";
    if (s === "done") return "bg-success/15 text-success";
    if (s === "error") return "bg-danger/15 text-danger";
    return "bg-hover text-muted";
  }
</script>

{#snippet icon()}
  {#if status === "working"}
    <span
      class="spinner text-success"
      style="width:{size}px;height:{size}px;border-width:1.5px;"
    ></span>
  {:else if status === "waiting"}
    <svg
      class="text-warning"
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      ><path
        d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
      /><path d="M12 7v2" /><path d="M12 13h.01" /></svg
    >
  {:else if status === "error"}
    <svg
      class="text-danger"
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="3"
      stroke-linecap="round"
      stroke-linejoin="round"
      ><line x1="18" y1="6" x2="6" y2="18" /><line
        x1="6"
        y1="6"
        x2="18"
        y2="18"
      /></svg
    >
  {/if}
{/snippet}

{#if pill}
  <span
    class="text-xs px-2 py-0.5 rounded-xl flex items-center gap-1 {pillClass(
      status,
    )}"
  >
    {@render icon()}
    {status || "idle"}
  </span>
{:else}
  {@render icon()}
{/if}
