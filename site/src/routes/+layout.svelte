<script lang="ts">
  import "../app.css";
  import type { Snippet } from "svelte";

  const { children } = $props<{ children: Snippet }>();
</script>

{@render children()}
