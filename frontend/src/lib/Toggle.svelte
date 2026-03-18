<script lang="ts">
  let {
    checked = $bindable(false),
    id,
    disabled = false,
    "aria-label": ariaLabel,
  }: {
    checked: boolean;
    id?: string;
    disabled?: boolean;
    "aria-label"?: string;
  } = $props();
</script>

<button
  type="button"
  role="switch"
  aria-checked={checked}
  aria-label={ariaLabel}
  {id}
  {disabled}
  onclick={() => { checked = !checked; }}
  class="toggle"
  class:on={checked}
>
  <span class="knob"></span>
</button>

<style>
  .toggle {
    position: relative;
    width: 32px;
    height: 18px;
    border-radius: 9px;
    border: 1px solid var(--color-edge);
    background: var(--color-hover);
    cursor: pointer;
    padding: 0;
    transition: background 0.15s, border-color 0.15s;
    flex-shrink: 0;
  }

  .toggle:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .toggle.on {
    background: var(--color-accent);
    border-color: var(--color-accent);
  }

  .knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--color-primary);
    transition: transform 0.15s;
  }

  .toggle.on .knob {
    transform: translateX(14px);
  }
</style>
