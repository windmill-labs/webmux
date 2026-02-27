<script lang="ts">
  import BaseDialog from "./BaseDialog.svelte";
  import Btn from "./Btn.svelte";

  let { message, loading = false, error = "", confirmLabel = "Remove", variant = "danger", onconfirm, oncancel }: {
    message: string;
    loading?: boolean;
    error?: string;
    confirmLabel?: string;
    variant?: "danger" | "accent";
    onconfirm: () => void;
    oncancel: () => void;
  } = $props();
</script>

<BaseDialog onclose={oncancel}>
  <form onsubmit={(e) => { e.preventDefault(); onconfirm(); }}>
    <h2 class="text-base mb-4">Confirm</h2>
    <p class="text-[13px] text-muted mb-6">{message}</p>
    {#if error}<p class="text-[12px] text-danger mb-4 -mt-2 whitespace-pre-wrap">{error}</p>{/if}
    <div class="flex justify-end gap-2">
      <Btn type="button" onclick={oncancel} disabled={loading}>Cancel</Btn>
      <Btn
        type="submit"
        variant={variant === "accent" ? "cta" : "danger"}
        class="flex items-center gap-1.5"
        disabled={loading}
        autofocus
      >{#if loading}<span class="spinner"></span>{/if} {confirmLabel}</Btn>
    </div>
  </form>
</BaseDialog>
