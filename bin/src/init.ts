#!/usr/bin/env bun

import * as p from "@clack/prompts";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { run, which, getGitRoot, detectProjectName } from "./shared.ts";

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
  { tool: "workmux", required: true, hint: "cargo install workmux  or  https://workmux.raine.dev" },
  { tool: "gh", required: false, hint: "brew install gh  then  gh auth login" },
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

function webmuxTemplate(name: string): string {
  return `# Project display name in the dashboard
name: ${name}

# Each service defines a port env var that webmux injects into .env.local
# when creating a worktree. Ports are auto-assigned: base + (slot × step).
# Use \`source .env.local\` in your .workmux.yaml pane commands to pick them up.
services:
  - name: app
    portEnv: PORT
    portStart: 3000       # Port for the main branch (slot 0)
    portStep: 10          # Increment per worktree (3010, 3020, ...)

# Agent profiles determine how AI agents run in worktrees
profiles:
  default:
    name: default

  # --- Sandbox profile (uncomment to enable) ---
  # Runs agents in Docker containers for full isolation.
  # Requires: docker + a built image.
  # sandbox:
  #   name: sandbox
  #   image: my-project-sandbox
  #   envPassthrough:            # Env vars forwarded into the container
  #     - DATABASE_URL
  #   systemPrompt: >
  #     You are running inside a sandboxed container.
  #     Start the dev server with: npm run dev

# --- Linked repos (uncomment to enable) ---
# Monitor PRs from related repos in the dashboard.
# linkedRepos:
#   - repo: org/other-repo
#     alias: other

# --- Startup environment variables ---
# These will appear as configurable fields in the UI when creating a worktree.
# startupEnvs:
#   NODE_ENV: development
`;
}

function workmuxTemplate(): string {
  return `main_branch: main

panes:
  # Agent pane — runs the AI coding assistant
  - command: >-
      claude --append-system-prompt
      "You are running inside a git worktree managed by workmux.\\n
      Pane layout (current window):\\n
      - Pane 0: this pane (claude agent)\\n
      - Pane 1: dev server\\n\\n
      To check dev server logs: tmux capture-pane -t .1 -p -S -50\\n
      To restart dev server: tmux send-keys -t .1 C-c 'source .env.local && PORT=\\$PORT npm run dev' Enter"
    focus: true

  # Dev server — waits for .env.local (written by webmux) then starts
  - command: >-
      npm install &&
      until [ -f .env.local ]; do sleep 0.2; done;
      source .env.local;
      PORT=$PORT npm run dev
    split: horizontal
`;
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

// Step 4 — .workmux.yaml
p.log.step("Checking config files...");

const workmuxYaml = join(gitRoot, ".workmux.yaml");
if (existsSync(workmuxYaml)) {
  p.log.info(".workmux.yaml already exists, skipping");
} else {
  await Bun.write(workmuxYaml, workmuxTemplate());
  p.log.success(".workmux.yaml created");
}

// Step 5 — .webmux.yaml
const webmuxYaml = join(gitRoot, ".webmux.yaml");
if (existsSync(webmuxYaml)) {
  p.log.info(".webmux.yaml already exists, skipping");
} else {
  const name = detectProjectName(gitRoot);
  await Bun.write(webmuxYaml, webmuxTemplate(name));
  p.log.success(".webmux.yaml created");
}

// Step 6 — Summary
p.outro("You're all set! Next steps:");
console.log();
console.log("  1. Edit .workmux.yaml to configure pane layout for your project");
console.log("  2. Edit .webmux.yaml to set up service ports and profiles");
console.log("  3. Run: webmux");
console.log();
