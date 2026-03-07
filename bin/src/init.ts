#!/usr/bin/env bun

import * as p from "@clack/prompts";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { run, which, getGitRoot } from "./shared.ts";
import {
  buildInitAgentCommand,
  buildInitPromptSpec,
  buildStarterTemplate,
  detectInitProjectContext,
  runInitAgentCommand,
  type InitAgent,
  type InitAgentStreamEvent,
  type InitAuthoringChoice,
} from "./init-helpers.ts";

// ── Dependency checks ───────────────────────────────────────────────────────

interface Dep {
  tool: string;
  required: boolean;
  hint: string;
}

const deps: Dep[] = [
  { tool: "git", required: true, hint: "https://git-scm.com/downloads" },
  { tool: "bun", required: true, hint: "https://bun.sh" },
  { tool: "python3", required: true, hint: "https://www.python.org/downloads/  or  brew install python  or  sudo apt install python3" },
  { tool: "tmux", required: true, hint: "brew install tmux / sudo apt install tmux" },
  { tool: "gh", required: false, hint: "brew install gh  then  gh auth login" },
  { tool: "claude", required: false, hint: "Install the Claude Code CLI to let Claude scaffold .webmux.yaml" },
  { tool: "codex", required: false, hint: "Install the Codex CLI to let Codex scaffold .webmux.yaml" },
  { tool: "docker", required: false, hint: "https://docs.docker.com/get-started/get-docker/" },
];

function checkDeps(): Dep[] {
  const missing: Dep[] = [];
  for (const dep of deps) {
    const found = which(dep.tool);
    if (found) {
      console.log(`  ✓ ${dep.tool}`);
    } else if (dep.required) {
      console.log(`  ✗ ${dep.tool} — not found (required)`);
      missing.push(dep);
    } else {
      console.log(`  ○ ${dep.tool} — not found (optional)`);
    }
  }
  return missing;
}

function agentLabel(agent: InitAgent): string {
  return agent === "claude" ? "Claude" : "Codex";
}

function defaultTemplateAgent(): InitAgent {
  return which("codex") && !which("claude") ? "codex" : "claude";
}

function createAgentStreamPrinter(label: string): {
  onEvent: (event: InitAgentStreamEvent) => void;
  finish: () => void;
  sawAssistantText: () => boolean;
} {
  const prefix = `  ${label}: `;
  let atLineStart = true;
  let assistantActive = false;
  let sawAssistantText = false;

  const closeAssistantLine = (): void => {
    if (assistantActive && !atLineStart) {
      process.stdout.write("\n");
    }
    assistantActive = false;
    atLineStart = true;
  };

  const writeAssistantChunk = (text: string): void => {
    if (!text) return;

    assistantActive = true;
    sawAssistantText = true;

    for (const char of text) {
      if (atLineStart) {
        process.stdout.write(prefix);
        atLineStart = false;
      }
      process.stdout.write(char);
      if (char === "\n") {
        atLineStart = true;
      }
    }
  };

  return {
    onEvent(event: InitAgentStreamEvent): void {
      if (event.kind === "assistant_delta") {
        writeAssistantChunk(event.text);
        return;
      }

      if (event.kind === "assistant_done") {
        closeAssistantLine();
        return;
      }

      closeAssistantLine();
      const tag = event.kind === "warning" ? "warning" : "status";
      console.log(`  ${label} ${tag}: ${event.text}`);
    },
    finish(): void {
      closeAssistantLine();
    },
    sawAssistantText(): boolean {
      return sawAssistantText;
    },
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

p.intro("webmux init");

// Step 1 — Git repo
const gitRoot = getGitRoot();
if (!gitRoot) {
  p.log.error("Not inside a git repository. Run this from within a project.");
  p.outro("Aborted.");
  process.exit(1);
}
p.log.success(`Git root: ${gitRoot}`);

// Step 2 — Dependency checks
p.log.step("Checking dependencies...");

const missing = checkDeps();

if (missing.length > 0) {
  const lines = missing.map((d) => `  ${d.tool}: ${d.hint}`).join("\n");
  p.note(lines, "Install these required dependencies, then re-run webmux init");
  p.outro("Setup incomplete.");
  process.exit(1);
}

// Step 3 — gh auth check
if (which("gh")) {
  const ghAuth = run("gh", ["auth", "status"]);
  if (!ghAuth.success) {
    p.log.warning("gh is installed but not authenticated. Run: gh auth login");
  } else {
    p.log.success("gh — authenticated");
  }
}

// Step 4 — .webmux.yaml
p.log.step("Checking config files...");

const webmuxYaml = join(gitRoot, ".webmux.yaml");
if (existsSync(webmuxYaml)) {
  p.log.info(".webmux.yaml already exists, skipping");
} else {
  const claudeAvailable = which("claude");
  const codexAvailable = which("codex");

  const choice = await p.select<InitAuthoringChoice>({
    message: "No .webmux.yaml found. How should webmux create it?",
    initialValue: claudeAvailable ? "claude" : codexAvailable ? "codex" : "manual",
    options: [
      {
        value: "claude",
        label: "Claude",
        hint: claudeAvailable ? "Claude inspects the repo and adapts the starter .webmux.yaml" : "Claude CLI not found",
        disabled: !claudeAvailable,
      },
      {
        value: "codex",
        label: "Codex",
        hint: codexAvailable ? "Codex inspects the repo and adapts the starter .webmux.yaml" : "Codex CLI not found",
        disabled: !codexAvailable,
      },
      {
        value: "manual",
        label: "I'll do it myself",
        hint: "Create the starter template now so you can edit it manually",
      },
    ],
  });

  if (p.isCancel(choice)) {
    p.outro("Aborted.");
    process.exit(1);
  }

  const selectedAgent: InitAgent = choice === "codex" ? "codex" : defaultTemplateAgent();
  const context = detectInitProjectContext(gitRoot, selectedAgent);

  if (choice === "manual") {
    await Bun.write(
      webmuxYaml,
      buildStarterTemplate({
        projectName: context.projectName,
        mainBranch: context.mainBranch,
        defaultAgent: context.defaultAgent,
        packageManager: context.packageManager,
      }),
    );
    p.log.success(".webmux.yaml starter template created");
  } else {
    const label = agentLabel(choice);
    const starterTemplate = buildStarterTemplate({
      projectName: context.projectName,
      mainBranch: context.mainBranch,
      defaultAgent: choice,
      packageManager: context.packageManager,
    });

    await Bun.write(webmuxYaml, starterTemplate);

    const prompt = buildInitPromptSpec({ ...context, defaultAgent: choice });
    const command = buildInitAgentCommand(choice, prompt);
    const streamPrinter = createAgentStreamPrinter(label);

    p.log.step(`Running ${label} to adapt the starter .webmux.yaml...`);
    const result = await runInitAgentCommand(command, gitRoot, { onEvent: streamPrinter.onEvent });
    streamPrinter.finish();

    if (!existsSync(webmuxYaml)) {
      p.log.error(`${label} removed .webmux.yaml`);

      const details = [
        result.summary ? `Summary:\n${result.summary}` : "",
        result.stderr.trim() ? `stderr:\n${result.stderr.trim()}` : "",
      ].filter((entry) => entry.length > 0).join("\n\n");

      if (details) {
        p.note(details, `${label} output`);
      }
      p.outro("Setup incomplete.");
      process.exit(1);
    }

    const finalYaml = await Bun.file(webmuxYaml).text();
    const changedTemplate = finalYaml !== starterTemplate;

    if (result.exitCode === 0 && changedTemplate) {
      p.log.success(`${label} adapted .webmux.yaml`);
    } else if (result.exitCode === 0) {
      p.log.warning(`${label} left the starter template unchanged`);
      p.log.warning(`${label} did not change the starter template. Review .webmux.yaml manually.`);
    } else if (changedTemplate) {
      p.log.warning(`${label} updated .webmux.yaml`);
      p.log.warning(`${label} exited with code ${result.exitCode}. Review the generated file before using it.`);
    } else {
      p.log.warning(`${label} left the starter template in place`);
      p.log.warning(`${label} exited with code ${result.exitCode}. The starter template is still there for manual editing.`);
    }

    if (result.summary && !streamPrinter.sawAssistantText()) {
      p.note(result.summary, `${label} summary`);
    }

    const trimmedStderr = result.stderr.trim();
    if (trimmedStderr) {
      p.note(trimmedStderr, `${label} stderr`);
    }
  }
}

// Step 5 — Summary
p.outro("You're all set! Next steps:");
console.log();
console.log("  1. Review .webmux.yaml and adjust panes, ports, and profiles if needed");
console.log("  2. Run: webmux");
console.log();
