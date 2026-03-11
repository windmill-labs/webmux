<script lang="ts">
  import SiteNav from "../components/SiteNav.svelte";

  let copied = $state(false);

  function copyInstall() {
    navigator.clipboard.writeText("bun install -g webmux");
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }
</script>

<SiteNav currentPage="home" />

<!-- Hero -->
<section class="bg-surface px-6 pt-20 pb-16 md:pt-32 md:pb-24">
  <div class="mx-auto max-w-4xl text-center">
    <h1 class="mb-4 text-4xl font-bold tracking-tight text-primary md:text-6xl">
      Manage parallel AI coding agents from one dashboard
    </h1>
    <p class="mx-auto mb-10 max-w-2xl text-lg text-muted md:text-xl">
      Run multiple AI agents in isolated worktrees, monitor their output in
      real-time, and manage PRs — all from a single browser tab.
    </p>

    <!-- Install CTA -->
    <div class="mx-auto mb-5 max-w-md">
      <div
        class="flex items-center rounded-lg border border-edge bg-sidebar px-4 py-3 font-mono text-sm"
      >
        <span class="text-muted select-none">$</span>
        <span class="ml-2 flex-1 text-left text-accent"
          >bun install -g webmux</span
        >
        <button
          onclick={copyInstall}
          class="ml-3 cursor-pointer rounded border-none bg-transparent p-1.5 text-muted transition-colors hover:text-primary"
          aria-label="Copy install command"
        >
          {#if copied}
            <svg
              class="h-4 w-4 text-success"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M5 13l4 4L19 7"
              />
            </svg>
          {:else}
            <svg
              class="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
            </svg>
          {/if}
        </button>
      </div>
    </div>

    <!-- Secondary CTA + badge -->
    <div class="flex flex-col items-center gap-4">
      <div class="flex flex-col items-center gap-3 sm:flex-row">
        <a
          href="/docs/"
          class="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-surface no-underline transition-opacity hover:opacity-90"
        >
          Read docs
        </a>
        <a
          href="https://github.com/windmill-labs/webmux"
          target="_blank"
          rel="noopener"
          class="inline-flex items-center gap-2 rounded-lg border border-edge px-5 py-2.5 text-sm font-medium text-primary no-underline transition-colors hover:bg-hover"
        >
          <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 16 16">
            <path
              d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
            />
          </svg>
          View on GitHub
        </a>
      </div>
      <span class="text-sm text-muted">
        Used by engineers at <a
          href="https://github.com/windmill-labs/windmill"
          target="_blank"
          rel="noopener"
          class="text-muted underline transition-colors hover:text-primary"
          >Windmill</a
        > every day.
      </span>
    </div>
  </div>
</section>

<!-- Features -->
<section id="features" class="bg-sidebar px-6 py-20 md:py-28">
  <div class="mx-auto max-w-6xl">
    <h2 class="mb-4 text-center text-3xl font-bold text-primary md:text-4xl">
      Everything you need
    </h2>
    <p class="mx-auto mb-14 max-w-xl text-center text-muted">
      A complete toolkit for running parallel AI coding agents.
    </p>

    <div class="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      <!-- Parallel AI Agents -->
      <div class="rounded-xl border border-edge bg-surface p-6">
        <div
          class="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10"
        >
          <svg
            class="h-5 w-5 text-accent"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="1.5"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z"
            />
          </svg>
        </div>
        <h3 class="mb-2 text-lg font-semibold text-primary">
          Parallel AI Agents
        </h3>
        <p class="text-sm leading-relaxed text-muted">
          Run multiple agents in isolated worktrees simultaneously. Each gets
          its own branch, terminal, and environment.
        </p>
      </div>

      <!-- One-Click Worktrees -->
      <div class="rounded-xl border border-edge bg-surface p-6">
        <div
          class="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10"
        >
          <svg
            class="h-5 w-5 text-accent"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="1.5"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M12 4.5v15m7.5-7.5h-15"
            />
          </svg>
        </div>
        <h3 class="mb-2 text-lg font-semibold text-primary">
          One-Click Worktrees
        </h3>
        <p class="text-sm leading-relaxed text-muted">
          Create worktrees with AI-powered branch naming. Describe the task, and
          webmux handles the rest.
        </p>
      </div>

      <!-- Real-Time Terminals -->
      <div class="rounded-xl border border-edge bg-surface p-6">
        <div
          class="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10"
        >
          <svg
            class="h-5 w-5 text-accent"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="1.5"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z"
            />
          </svg>
        </div>
        <h3 class="mb-2 text-lg font-semibold text-primary">
          Real-Time Terminals
        </h3>
        <p class="text-sm leading-relaxed text-muted">
          Live WebSocket terminal streaming in the browser. Watch agents work,
          send prompts, and switch instantly.
        </p>
      </div>

      <!-- PR & CI Integration -->
      <div class="rounded-xl border border-edge bg-surface p-6">
        <div
          class="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10"
        >
          <svg
            class="h-5 w-5 text-accent"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="1.5"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
        <h3 class="mb-2 text-lg font-semibold text-primary">
          PR & CI Integration
        </h3>
        <p class="text-sm leading-relaxed text-muted">
          PR status, CI check results, and review comments displayed inline next
          to each worktree.
        </p>
      </div>

      <!-- Linear Issues -->
      <div class="rounded-xl border border-edge bg-surface p-6">
        <div
          class="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10"
        >
          <svg
            class="h-5 w-5 text-accent"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="1.5"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z"
            />
          </svg>
        </div>
        <h3 class="mb-2 text-lg font-semibold text-primary">Linear Issues</h3>
        <p class="text-sm leading-relaxed text-muted">
          Browse and assign Linear issues directly. Auto-link branches to issues
          for seamless tracking.
        </p>
      </div>

      <!-- Docker Sandboxing -->
      <div class="rounded-xl border border-edge bg-surface p-6">
        <div
          class="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10"
        >
          <svg
            class="h-5 w-5 text-accent"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="1.5"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M21 7.5l-2.25-1.313M21 7.5v2.25m0-2.25l-2.25 1.313M3 7.5l2.25-1.313M3 7.5l2.25 1.313M3 7.5v2.25m9 3l2.25-1.313M12 12.75l-2.25-1.313M12 12.75V15m0 6.75l2.25-1.313M12 21.75V19.5m0 2.25l-2.25-1.313m0-16.875L12 2.25l2.25 1.313M21 14.25v2.25l-2.25 1.313m-13.5 0L3 16.5v-2.25"
            />
          </svg>
        </div>
        <h3 class="mb-2 text-lg font-semibold text-primary">
          Docker Sandboxing
        </h3>
        <p class="text-sm leading-relaxed text-muted">
          Isolated containers with automatic port forwarding and volume mounts
          for untrusted workloads.
        </p>
      </div>
    </div>
  </div>
</section>

<!-- Demo Sections -->
<section class="bg-surface px-6 py-20 md:py-28">
  <div class="mx-auto max-w-6xl space-y-24">
    <!-- Demo 1: Create & Manage Worktrees -->
    <div class="flex flex-col items-center gap-10 md:flex-row">
      <div class="flex-1">
        <h3 class="mb-3 text-2xl font-bold text-primary md:text-3xl">
          Create & Manage Worktrees
        </h3>
        <p class="text-muted leading-relaxed">
          Spin up new worktrees with one click. Pick a profile, type a prompt,
          and webmux creates the worktree, starts the agent, and begins
          streaming output. Merge or remove worktrees when you're done.
        </p>
      </div>
      <div class="flex-1 overflow-hidden rounded-xl border border-edge">
        <img
          src="https://github.com/user-attachments/assets/7f084d27-448c-47e4-aadf-8ab25154c096"
          alt="Creating and managing worktrees demo"
          class="w-full"
          loading="lazy"
        />
      </div>
    </div>

    <!-- Demo 2: PR, CI & Comments -->
    <div class="flex flex-col items-center gap-10 md:flex-row-reverse">
      <div class="flex-1">
        <h3 class="mb-3 text-2xl font-bold text-primary md:text-3xl">
          PR, CI & Comments
        </h3>
        <p class="text-muted leading-relaxed">
          See pull request status, CI check results, and review comments right
          next to each worktree. No more switching to GitHub to check if your
          agent's PR passed CI.
        </p>
      </div>
      <div class="flex-1 overflow-hidden rounded-xl border border-edge">
        <img
          src="https://github.com/user-attachments/assets/395f8471-f9ff-412a-87e2-1347bfadb387"
          alt="PR, CI checks and comments demo"
          class="w-full"
          loading="lazy"
        />
      </div>
    </div>

    <!-- Demo 3: Service Health Monitoring -->
    <div class="flex flex-col items-center gap-10 md:flex-row">
      <div class="flex-1">
        <h3 class="mb-3 text-2xl font-bold text-primary md:text-3xl">
          Service Health Monitoring
        </h3>
        <p class="text-muted leading-relaxed">
          Track dev server ports across worktrees. webmux polls configured
          services and shows live health badges so you know which worktrees have
          their servers running.
        </p>
      </div>
      <div class="flex-1 overflow-hidden rounded-xl border border-edge">
        <img
          src="https://github.com/user-attachments/assets/b2cf535a-0242-4c15-bdb9-344dfde5f75e"
          alt="Service health monitoring demo"
          class="w-full"
          loading="lazy"
        />
      </div>
    </div>

    <!-- Demo 4: Linear Integration -->
    <div class="flex flex-col items-center gap-10 md:flex-row-reverse">
      <div class="flex-1">
        <h3 class="mb-3 text-2xl font-bold text-primary md:text-3xl">
          Linear Integration
        </h3>
        <p class="text-muted leading-relaxed">
          See your assigned Linear issues alongside your worktrees. Webmux
          matches branches to issues automatically, so you can browse your
          backlog, pick an issue, and spin up a worktree for it in one click.
        </p>
      </div>
      <div class="flex-1 overflow-hidden rounded-xl border border-edge">
        <img
          src="https://github.com/user-attachments/assets/3187fbe2-eeee-4a33-8780-c51c3575b72a"
          alt="Linear integration demo"
          class="w-full"
          loading="lazy"
        />
      </div>
    </div>
  </div>
</section>

<!-- Config Section -->
<section class="bg-sidebar px-6 py-20 md:py-28">
  <div class="mx-auto max-w-3xl">
    <h2 class="mb-4 text-center text-3xl font-bold text-primary md:text-4xl">
      One config file. Full control.
    </h2>
    <p class="mx-auto mb-10 max-w-xl text-center text-muted">
      Define worktree layout, service ports, agent profiles, and Docker
      sandboxes in a single YAML file.
    </p>
    <div class="overflow-hidden rounded-xl border border-edge bg-surface">
      <div class="flex items-center gap-2 border-b border-edge px-4 py-2.5">
        <span class="h-3 w-3 rounded-full bg-danger/60"></span>
        <span class="h-3 w-3 rounded-full bg-warning/60"></span>
        <span class="h-3 w-3 rounded-full bg-success/60"></span>
        <span class="ml-2 text-xs text-muted">.webmux.yaml</span>
      </div>
      <pre class="overflow-x-auto p-5 text-sm leading-relaxed"><code
          class="text-primary"
          ><span class="text-accent">name</span>: My Project

<span class="text-accent">workspace</span>:
  <span class="text-muted">mainBranch</span>: main
  <span class="text-muted">worktreeRoot</span>: __worktrees
  <span class="text-muted">defaultAgent</span>: claude

<span class="text-accent">services</span>:
  - <span class="text-muted">name</span>: Backend
    <span class="text-muted">portEnv</span>: PORT
    <span class="text-muted">portStart</span>: <span class="text-warning"
            >5111</span
          >
  - <span class="text-muted">name</span>: Frontend
    <span class="text-muted">portEnv</span>: FRONTEND_PORT
    <span class="text-muted">portStart</span>: <span class="text-warning"
            >5112</span
          >

<span class="text-accent">profiles</span>:
  <span class="text-muted">default</span>:
    <span class="text-muted">runtime</span>: host
    <span class="text-muted">panes</span>:
      - <span class="text-muted">kind</span>: agent
        <span class="text-muted">focus</span>: <span class="text-warning"
            >true</span
          >
      - <span class="text-muted">kind</span>: command
        <span class="text-muted">command</span>: npm run dev

  <span class="text-muted">sandbox</span>:
    <span class="text-muted">runtime</span>: docker
    <span class="text-muted">image</span>: my-sandbox
    <span class="text-muted">yolo</span>: <span class="text-warning">true</span
          ></code
        ></pre>
    </div>
  </div>
</section>

<!-- Quick Start -->
<section class="bg-surface px-6 py-20 md:py-28">
  <div class="mx-auto max-w-3xl">
    <h2 class="mb-4 text-center text-3xl font-bold text-primary md:text-4xl">
      Get started in 60 seconds
    </h2>
    <p class="mx-auto mb-12 max-w-xl text-center text-muted">
      Four commands to go from zero to a running dashboard.
    </p>

    <div class="space-y-6">
      <div class="flex gap-4">
        <div
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-sm font-bold text-accent"
        >
          1
        </div>
        <div class="flex-1">
          <p class="mb-2 font-medium text-primary">Install prerequisites</p>
          <div
            class="rounded-lg border border-edge bg-sidebar px-4 py-3 font-mono text-sm text-muted"
          >
            sudo apt install tmux python3<br />
            curl -fsSL https://bun.sh/install | bash
          </div>
        </div>
      </div>

      <div class="flex gap-4">
        <div
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-sm font-bold text-accent"
        >
          2
        </div>
        <div class="flex-1">
          <p class="mb-2 font-medium text-primary">Install webmux</p>
          <div
            class="rounded-lg border border-edge bg-sidebar px-4 py-3 font-mono text-sm text-accent"
          >
            bun install -g webmux
          </div>
        </div>
      </div>

      <div class="flex gap-4">
        <div
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-sm font-bold text-accent"
        >
          3
        </div>
        <div class="flex-1">
          <p class="mb-2 font-medium text-primary">Set up your project</p>
          <div
            class="rounded-lg border border-edge bg-sidebar px-4 py-3 font-mono text-sm text-muted"
          >
            cd /path/to/your/project<br />
            <span class="text-accent">webmux init</span>
          </div>
        </div>
      </div>

      <div class="flex gap-4">
        <div
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-sm font-bold text-accent"
        >
          4
        </div>
        <div class="flex-1">
          <p class="mb-2 font-medium text-primary">Start the dashboard</p>
          <div
            class="rounded-lg border border-edge bg-sidebar px-4 py-3 font-mono text-sm text-accent"
          >
            webmux serve
          </div>
          <p class="mt-2 text-sm text-muted">
            Opens on <span class="text-accent">http://localhost:5111</span>
          </p>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- Footer -->
<footer class="border-t border-edge bg-sidebar px-6 py-10">
  <div
    class="mx-auto flex max-w-6xl flex-col items-center gap-4 text-center text-sm text-muted"
  >
    <div class="flex items-center gap-4">
      <a
        href="https://github.com/windmill-labs/webmux"
        target="_blank"
        rel="noopener"
        class="text-muted transition-colors hover:text-primary">GitHub</a
      >
      <span class="text-edge">&middot;</span>
      <a
        href="https://www.npmjs.com/package/webmux"
        target="_blank"
        rel="noopener"
        class="text-muted transition-colors hover:text-primary">npm</a
      >
    </div>
    <p>MIT License &middot; Open Source</p>
    <p>Built by <a href="https://www.linkedin.com/in/farhad-g-1b179a202/" target="_blank" rel="noopener" class="text-muted underline transition-colors hover:text-primary">Farhad</a> at <a href="https://github.com/windmill-labs/windmill" target="_blank" rel="noopener" class="text-muted underline transition-colors hover:text-primary">Windmill</a></p>
  </div>
</footer>
