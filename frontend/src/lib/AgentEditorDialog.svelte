<script lang="ts">
  import BaseDialog from "./BaseDialog.svelte";
  import Btn from "./Btn.svelte";
  import type { UpsertCustomAgentRequest, ValidateCustomAgentResponse } from "./types";
  import { errorMessage } from "./utils";

  let {
    title,
    initialValue,
    onsave,
    onvalidate,
    onclose,
  }: {
    title: string;
    initialValue: {
      label: string;
      startCommand: string;
      resumeCommand: string;
    };
    onsave: (value: UpsertCustomAgentRequest) => Promise<void>;
    onvalidate?: (value: UpsertCustomAgentRequest) => Promise<ValidateCustomAgentResponse>;
    onclose: () => void;
  } = $props();

  let label = $state("");
  let startCommand = $state("");
  let resumeCommand = $state("");
  let initialized = false;
  let saving = $state(false);
  let validating = $state(false);
  let error = $state<string | null>(null);
  let validation = $state<ValidateCustomAgentResponse | null>(null);
  let canSave = $derived(label.trim().length > 0 && startCommand.trim().length > 0);

  $effect(() => {
    if (initialized) return;
    initialized = true;
    label = initialValue.label;
    startCommand = initialValue.startCommand;
    resumeCommand = initialValue.resumeCommand;
  });

  function buildRequest(): UpsertCustomAgentRequest {
    return {
      label: label.trim(),
      startCommand: startCommand.trim(),
      ...(resumeCommand.trim() ? { resumeCommand: resumeCommand.trim() } : {}),
    };
  }

  async function handleValidate(): Promise<void> {
    if (!canSave || saving || validating || !onvalidate) return;
    validating = true;
    error = null;

    try {
      validation = await onvalidate(buildRequest());
    } catch (err) {
      error = errorMessage(err);
      validation = null;
    } finally {
      validating = false;
    }
  }

  async function handleSubmit(): Promise<void> {
    if (!canSave || saving) return;
    saving = true;
    error = null;

    try {
      await onsave(buildRequest());
    } catch (err) {
      error = errorMessage(err);
    } finally {
      saving = false;
    }
  }
</script>

<BaseDialog {onclose} wide>
  <form onsubmit={(event) => { event.preventDefault(); void handleSubmit(); }}>
    <h2 class="text-base mb-4">{title}</h2>

    <div class="mb-4">
      <label class="block text-xs text-muted mb-1.5" for="agent-label">Agent name</label>
      <input
        id="agent-label"
        type="text"
        class="w-full px-2.5 py-1.5 rounded-md border border-edge bg-surface text-primary text-[13px] placeholder:text-muted/50 outline-none focus:border-accent"
        placeholder="e.g. Gemini CLI"
        bind:value={label}
      />
    </div>

    <div class="mb-4">
      <label class="block text-xs text-muted mb-1.5" for="agent-start-command">Start command</label>
      <textarea
        id="agent-start-command"
        rows="4"
        class="w-full px-2.5 py-1.5 rounded-md border border-edge bg-surface text-primary text-[13px] placeholder:text-muted/50 outline-none focus:border-accent resize-y font-mono"
        placeholder={"e.g. gemini --prompt \"${PROMPT}\""}
        bind:value={startCommand}
      ></textarea>
    </div>

    <div class="mb-4">
      <label class="block text-xs text-muted mb-1.5" for="agent-resume-command">
        Resume command <span class="opacity-60">(optional)</span>
      </label>
      <input
        id="agent-resume-command"
        type="text"
        class="w-full px-2.5 py-1.5 rounded-md border border-edge bg-surface text-primary text-[13px] placeholder:text-muted/50 outline-none focus:border-accent font-mono"
        placeholder={"e.g. gemini resume --branch \"${BRANCH}\""}
        bind:value={resumeCommand}
      />
    </div>

    <div class="mb-5 rounded-lg border border-edge bg-surface/40 p-3">
      <p class="text-[13px] text-primary">Supported placeholders</p>
      <div class="mt-2 flex flex-wrap gap-1.5 text-[11px] text-muted font-mono">
        {#each ["${PROMPT}", "${SYSTEM_PROMPT}", "${WORKTREE_PATH}", "${REPO_PATH}", "${BRANCH}", "${PROFILE}"] as placeholder}
          <span class="rounded-full border border-edge px-1.5 py-0.5">{placeholder}</span>
        {/each}
      </div>
      <p class="mt-2 text-[11px] text-muted">
        webmux exports placeholder values safely before running your command.
      </p>
      <div class="mt-3 space-y-2 text-[11px] text-muted">
        <p class="text-primary">Examples</p>
        <div>
          <p>Start command</p>
          <p class="mt-1 font-mono break-all text-primary/80">pi --append-system-prompt "{"${SYSTEM_PROMPT}"}" "{"${PROMPT}"}"</p>
        </div>
        <div>
          <p>Resume command</p>
          <p class="mt-1 font-mono break-all text-primary/80">pi -c --append-system-prompt "{"${SYSTEM_PROMPT}"}"</p>
        </div>
      </div>
    </div>

    {#if validation}
      <div class="mb-4 rounded-lg border border-edge bg-surface/40 p-3 text-[12px]">
        <p class="text-primary">Agent id: <span class="font-mono">{validation.normalizedId}</span></p>
        {#if validation.warnings.length > 0}
          <ul class="mt-2 space-y-1 text-muted">
            {#each validation.warnings as warning}
              <li>{warning}</li>
            {/each}
          </ul>
        {:else}
          <p class="mt-2 text-success">Configuration looks good.</p>
        {/if}
      </div>
    {/if}

    {#if error}
      <p class="mb-4 text-[12px] text-danger">{error}</p>
    {/if}

    <div class="flex justify-end gap-2">
      <Btn type="button" onclick={onclose}>Cancel</Btn>
      {#if onvalidate}
        <Btn type="button" onclick={() => { void handleValidate(); }} disabled={!canSave || validating || saving}>
          {validating ? "Testing..." : "Test"}
        </Btn>
      {/if}
      <Btn type="submit" variant="cta" disabled={!canSave || saving}>
        {saving ? "Saving..." : "Save"}
      </Btn>
    </div>
  </form>
</BaseDialog>
