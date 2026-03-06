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

workspace:
  mainBranch: main
  worktreeRoot: __worktrees
  defaultAgent: claude

# Each service defines a port env var that webmux injects into pane and agent
# process environments when creating a worktree. Ports are auto-assigned:
# base + (slot × step).
services:
  - name: app
    portEnv: PORT
    portStart: 3000
    portStep: 10

profiles:
  default:
    runtime: host
    yolo: false
    envPassthrough: []
    panes:
      - id: agent
        kind: agent
        focus: true
      - id: app
        kind: command
        split: right
        command: PORT=$PORT npm run dev

  # sandbox:
  #   runtime: docker
  #   yolo: true
  #   image: my-project-sandbox
  #   envPassthrough:
  #     - DATABASE_URL
  #   panes:
  #     - id: agent
  #       kind: agent
  #       focus: true
  #     - id: app
  #       kind: command
  #       split: right
  #       command: PORT=$PORT npm run dev

integrations:
  github:
    linkedRepos: []
  linear:
    enabled: true

startupEnvs: {}
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

// Step 4 — .webmux.yaml
p.log.step("Checking config files...");

const webmuxYaml = join(gitRoot, ".webmux.yaml");
if (existsSync(webmuxYaml)) {
  p.log.info(".webmux.yaml already exists, skipping");
} else {
  const name = detectProjectName(gitRoot);
  await Bun.write(webmuxYaml, webmuxTemplate(name));
  p.log.success(".webmux.yaml created");
}

// Step 5 — Summary
p.outro("You're all set! Next steps:");
console.log();
console.log("  1. Edit .webmux.yaml to configure panes, ports, and profiles");
console.log("  2. Run: webmux");
console.log();
