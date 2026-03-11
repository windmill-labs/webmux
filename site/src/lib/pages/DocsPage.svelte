<script lang="ts">
  import CommandBlock from "../components/CommandBlock.svelte";
  import DocsTable from "../components/DocsTable.svelte";
  import SiteNav from "../components/SiteNav.svelte";
  import {
    configExample,
    configGroups,
    defaultsAtAGlance,
    docsNav,
    featureHighlights,
    keyboardShortcuts,
    prerequisites,
    quickStartSteps,
    rootCommands,
    runtimeEnvGroups,
    worktreeCommands,
  } from "../docs";
</script>

<SiteNav currentPage="docs" />

<main class="bg-surface">
  <section class="border-b border-edge bg-sidebar/40 px-6 pt-20 pb-14 md:pt-28 md:pb-20">
    <div class="mx-auto max-w-6xl">
      <div
        class="mb-6 inline-flex items-center rounded-full border border-edge bg-sidebar px-3 py-1 text-xs font-medium tracking-[0.18em] text-muted uppercase"
      >
        Developer documentation
      </div>
      <h1 class="max-w-3xl text-4xl font-bold tracking-tight text-primary md:text-6xl">
        Everything you need to install, configure, and operate webmux.
      </h1>
      <p class="mt-5 max-w-3xl text-lg leading-8 text-muted md:text-xl">
        This page turns the current CLI and config surface into a complete docs
        reference: installation, command usage, schema details, defaults,
        automation hooks, integrations, and runtime behavior.
      </p>
      <div class="mt-8 flex flex-col gap-3 sm:flex-row">
        <a
          href="https://github.com/windmill-labs/webmux"
          target="_blank"
          rel="noopener"
          class="inline-flex items-center justify-center rounded-lg border border-edge px-5 py-3 text-sm font-medium text-primary no-underline transition-colors hover:bg-hover"
        >
          View full README
        </a>
        <a
          href="#quickstart"
          class="inline-flex items-center justify-center rounded-lg bg-accent px-5 py-3 text-sm font-medium text-surface no-underline transition-opacity hover:opacity-90"
        >
          Jump to quick start
        </a>
      </div>
      <div class="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {#each defaultsAtAGlance as fact}
          <div class="rounded-2xl border border-edge bg-surface p-5">
            <div class="text-xs uppercase tracking-[0.14em] text-muted">
              {fact.label}
            </div>
            <div class="mt-2 text-base font-medium text-primary">{fact.value}</div>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <div class="mx-auto grid max-w-7xl gap-10 px-6 py-10 lg:grid-cols-[240px_minmax(0,1fr)]">
    <aside class="hidden lg:block">
      <div class="sticky top-24 rounded-2xl border border-edge bg-sidebar p-5">
        <div class="mb-4 text-xs uppercase tracking-[0.16em] text-muted">
          On this page
        </div>
        <nav class="space-y-2">
          {#each docsNav as item}
            <a
              href={`#${item.id}`}
              class="block rounded-lg px-3 py-2 text-sm text-muted no-underline transition-colors hover:bg-hover hover:text-primary"
            >
              {item.label}
            </a>
          {/each}
        </nav>
      </div>
    </aside>

    <div class="space-y-16">
      <div class="flex gap-3 overflow-x-auto pb-2 lg:hidden">
        {#each docsNav as item}
          <a
            href={`#${item.id}`}
            class="shrink-0 rounded-full border border-edge bg-sidebar px-4 py-2 text-sm text-muted no-underline transition-colors hover:text-primary"
          >
            {item.label}
          </a>
        {/each}
      </div>

      <section id="overview" class="scroll-mt-28">
        <div class="mb-8 max-w-3xl">
          <h2 class="text-3xl font-bold text-primary md:text-4xl">Overview</h2>
          <p class="mt-3 leading-7 text-muted">
            webmux is a Bun-powered dashboard and CLI for managing parallel AI
            coding worktrees. It owns the worktree lifecycle, tmux layout,
            runtime env materialization, service health checks, and linked PR or
            issue context.
          </p>
        </div>
        <div class="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {#each featureHighlights as feature}
            <article class="rounded-2xl border border-edge bg-sidebar p-6">
              <h3 class="text-lg font-semibold text-primary">{feature.title}</h3>
              <p class="mt-3 text-sm leading-7 text-muted">
                {feature.description}
              </p>
            </article>
          {/each}
        </div>
      </section>

      <section id="install" class="scroll-mt-28">
        <div class="mb-8 max-w-3xl">
          <h2 class="text-3xl font-bold text-primary md:text-4xl">Install</h2>
          <p class="mt-3 leading-7 text-muted">
            webmux init expects a git repository and checks the local toolchain
            before it writes configuration. The dashboard itself is started with
            webmux serve.
          </p>
        </div>
        <div class="grid gap-8 xl:grid-cols-[0.9fr_1.1fr]">
          <article class="rounded-2xl border border-edge bg-sidebar p-6 md:p-8">
            <h3 class="text-xl font-semibold text-primary">Prerequisites</h3>
            <div class="mt-6 space-y-4">
              {#each prerequisites as tool}
                <div class="rounded-xl border border-edge bg-surface px-4 py-4">
                  <div class="flex items-center justify-between gap-4">
                    <h4 class="font-mono text-sm text-primary">{tool.name}</h4>
                    {#if tool.optional}
                      <span class="text-xs text-warning">optional</span>
                    {/if}
                  </div>
                  <p class="mt-2 text-sm leading-6 text-muted">{tool.purpose}</p>
                  {#if tool.installHint}
                    <p class="mt-2 text-xs leading-5 text-muted">{tool.installHint}</p>
                  {/if}
                </div>
              {/each}
            </div>
          </article>

          <article class="rounded-2xl border border-edge bg-sidebar p-6 md:p-8">
            <h3 class="text-xl font-semibold text-primary">Install commands</h3>
            <div class="mt-6 space-y-5">
              <div>
                <div class="mb-3 text-sm font-medium text-muted">
                  Install the CLI
                </div>
                <CommandBlock command={"bun install -g webmux"} />
              </div>
              <div>
                <div class="mb-3 text-sm font-medium text-muted">
                  Initialize a repository
                </div>
                <CommandBlock command={"cd /path/to/your/project\nwebmux init"} />
              </div>
              <div>
                <div class="mb-3 text-sm font-medium text-muted">
                  Start the dashboard
                </div>
                <CommandBlock command={"webmux serve"} />
              </div>
            </div>
          </article>
        </div>
      </section>

      <section id="quickstart" class="scroll-mt-28">
        <div class="mb-8 max-w-3xl">
          <h2 class="text-3xl font-bold text-primary md:text-4xl">Quick start</h2>
          <p class="mt-3 leading-7 text-muted">
            This is the shortest path from a fresh machine to a working browser
            dashboard on http://localhost:5111.
          </p>
        </div>
        <div class="grid gap-6 xl:grid-cols-2">
          {#each quickStartSteps as step, index}
            <article class="rounded-2xl border border-edge bg-sidebar p-6">
              <div class="mb-4 text-sm font-medium text-accent">
                Step {index + 1}
              </div>
              <h3 class="text-xl font-semibold text-primary">{step.title}</h3>
              <p class="mt-2 text-sm leading-7 text-muted">{step.description}</p>
              <div class="mt-4">
                <CommandBlock command={step.command} />
              </div>
              {#if step.outcome}
                <p class="mt-4 text-sm leading-7 text-muted">{step.outcome}</p>
              {/if}
            </article>
          {/each}
        </div>
      </section>

      <section id="cli" class="scroll-mt-28">
        <div class="mb-8 max-w-3xl">
          <h2 class="text-3xl font-bold text-primary md:text-4xl">CLI reference</h2>
          <p class="mt-3 leading-7 text-muted">
            The root command surface includes dashboard serving, setup, service
            management, shell completion, and lifecycle-aware worktree
            subcommands.
          </p>
        </div>
        <div class="space-y-8">
          <article class="rounded-2xl border border-edge bg-sidebar p-6 md:p-8">
            <h3 class="text-xl font-semibold text-primary">Root commands</h3>
            <div class="mt-6 grid gap-5 xl:grid-cols-2">
              {#each rootCommands as command}
                <div class="rounded-2xl border border-edge bg-surface p-5">
                  <div class="text-sm font-medium text-accent">{command.title}</div>
                  <div class="mt-3">
                    <CommandBlock command={command.usage} />
                  </div>
                  <p class="mt-4 text-sm leading-7 text-muted">
                    {command.description}
                  </p>
                  {#if command.details}
                    <ul class="mt-4 space-y-2 text-sm leading-6 text-muted">
                      {#each command.details as detail}
                        <li>{detail}</li>
                      {/each}
                    </ul>
                  {/if}
                </div>
              {/each}
            </div>
          </article>

          <article class="rounded-2xl border border-edge bg-sidebar p-6 md:p-8">
            <h3 class="text-xl font-semibold text-primary">Worktree commands</h3>
            <div class="mt-6 grid gap-5 xl:grid-cols-2">
              {#each worktreeCommands as command}
                <div class="rounded-2xl border border-edge bg-surface p-5">
                  <div class="text-sm font-medium text-accent">{command.title}</div>
                  <div class="mt-3">
                    <CommandBlock command={command.usage} />
                  </div>
                  <p class="mt-4 text-sm leading-7 text-muted">
                    {command.description}
                  </p>
                  {#if command.details}
                    <ul class="mt-4 space-y-2 text-sm leading-6 text-muted">
                      {#each command.details as detail}
                        <li>{detail}</li>
                      {/each}
                    </ul>
                  {/if}
                </div>
              {/each}
            </div>
          </article>
        </div>
      </section>

      <section id="configuration" class="scroll-mt-28">
        <div class="mb-8 max-w-3xl">
          <h2 class="text-3xl font-bold text-primary md:text-4xl">Configuration</h2>
          <p class="mt-3 leading-7 text-muted">
            .webmux.yaml is loaded from the git root and normalized into the
            final project config shape. The example below includes services,
            profiles, docker mounts, startup envs, integrations, lifecycle
            hooks, and auto naming.
          </p>
        </div>
        <div class="max-w-5xl">
          <article class="rounded-2xl border border-edge bg-sidebar p-6 md:p-8">
            <h3 class="text-xl font-semibold text-primary">Full example</h3>
            <div class="mt-6">
              <CommandBlock command={configExample} />
            </div>
          </article>
        </div>
      </section>

      <section id="schema" class="scroll-mt-28">
        <div class="mb-8 max-w-3xl">
          <h2 class="text-3xl font-bold text-primary md:text-4xl">Schema reference</h2>
          <p class="mt-3 leading-7 text-muted">
            These tables reflect the current config parser and defaults in the
            codebase rather than a hand-maintained marketing summary.
          </p>
        </div>
        <div class="space-y-8">
          {#each configGroups as group}
            <article class="rounded-2xl border border-edge bg-sidebar p-6 md:p-8">
              <h3 class="text-xl font-semibold text-primary">{group.title}</h3>
              <p class="mt-3 max-w-3xl text-sm leading-7 text-muted">
                {group.description}
              </p>
              <div class="mt-6">
                <DocsTable fields={group.fields} />
              </div>
            </article>
          {/each}
        </div>
      </section>

      <section id="automation" class="scroll-mt-28">
        <div class="mb-8 max-w-3xl">
          <h2 class="text-3xl font-bold text-primary md:text-4xl">Automation and runtime details</h2>
          <p class="mt-3 leading-7 text-muted">
            The details below are the implementation-level behaviors that matter
            when you automate webmux, write lifecycle hooks, or rely on
            generated branch names and port allocation.
          </p>
        </div>
        <div class="max-w-5xl">
          <article class="rounded-2xl border border-edge bg-sidebar p-6 md:p-8">
            <h3 class="text-xl font-semibold text-primary">Runtime environment reference</h3>
            <div class="mt-6 space-y-6">
              {#each runtimeEnvGroups as group}
                <div>
                  <p class="mb-4 text-sm leading-7 text-muted">{group.description}</p>
                  <DocsTable fields={group.fields} />
                </div>
              {/each}
            </div>
          </article>
        </div>
      </section>

      <section id="shortcuts" class="scroll-mt-28">
        <div class="mb-8 max-w-3xl">
          <h2 class="text-3xl font-bold text-primary md:text-4xl">Keyboard shortcuts</h2>
          <p class="mt-3 leading-7 text-muted">
            The browser dashboard keeps the common worktree actions on a small,
            memorable set of keyboard shortcuts.
          </p>
        </div>
        <article class="rounded-2xl border border-edge bg-sidebar p-6 md:p-8">
          <div class="space-y-4">
            {#each keyboardShortcuts as shortcut}
              <div class="flex items-start justify-between gap-4 border-b border-edge pb-4 last:border-b-0 last:pb-0">
                <div class="font-mono text-sm text-primary">{shortcut.keys}</div>
                <div class="max-w-xl text-right text-sm leading-6 text-muted">
                  {shortcut.action}
                </div>
              </div>
            {/each}
          </div>
        </article>
      </section>
    </div>
  </div>
</main>
