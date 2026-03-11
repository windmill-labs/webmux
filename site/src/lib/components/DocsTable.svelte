<script lang="ts">
  import type { ConfigField } from "../types";

  const { fields }: { fields: ConfigField[] } = $props();
</script>

<div class="overflow-hidden rounded-2xl border border-edge bg-surface">
  <div class="overflow-x-auto">
    <table class="min-w-full border-collapse text-left text-sm">
      <thead class="bg-sidebar text-xs uppercase tracking-[0.16em] text-muted">
        <tr>
          <th class="px-4 py-3 font-medium">Key</th>
          <th class="px-4 py-3 font-medium">Type</th>
          <th class="px-4 py-3 font-medium">Required</th>
          <th class="px-4 py-3 font-medium">Default</th>
          <th class="px-4 py-3 font-medium">Description</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-edge">
        {#each fields as field}
          <tr class="align-top">
            <td class="px-4 py-4 font-mono text-xs text-primary">{field.key}</td>
            <td class="px-4 py-4 text-muted">{field.type}</td>
            <td class="px-4 py-4 text-muted">{field.required}</td>
            <td class="px-4 py-4 text-muted">{field.defaultValue ?? "-"}</td>
            <td class="px-4 py-4 leading-6 text-muted">{field.description}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>
