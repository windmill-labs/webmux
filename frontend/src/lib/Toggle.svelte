<script lang="ts">
  let {
    checked = $bindable(false),
    id,
    disabled = false,
    size = "default",
    preventMouseFocus = false,
    ontoggle,
    "aria-label": ariaLabel,
  }: {
    checked: boolean;
    id?: string;
    disabled?: boolean;
    size?: "default" | "sm";
    preventMouseFocus?: boolean;
    ontoggle?: (checked: boolean) => void;
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
  onmousedown={(event) => {
    if (!preventMouseFocus) return;
    event.preventDefault();
  }}
  onclick={() => {
    checked = !checked;
    ontoggle?.(checked);
  }}
  class="toggle"
  class:on={checked}
  class:sm={size === "sm"}
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

  .toggle:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }

  .toggle.on .knob {
    transform: translateX(14px);
  }

  .toggle.sm {
    width: 24px;
    height: 14px;
    border-radius: 7px;
  }

  .toggle.sm .knob {
    top: 1px;
    left: 1px;
    width: 10px;
    height: 10px;
  }

  .toggle.sm.on .knob {
    transform: translateX(10px);
  }
</style>
