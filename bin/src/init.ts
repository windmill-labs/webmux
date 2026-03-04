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
      p.log.success(`${dep.tool} — found`);
    } else if (dep.required) {
      p.log.error(`${dep.tool} — not found (required)`);
      missing.push(dep);
    } else {
      p.log.warning(`${dep.tool} — not found (optional: ${dep.hint})`);
    }
  }
  return missing;
}

function wmdevTemplate(name: string): string {
  return `# Project display name in the dashboard
name: ${name}

# Service health monitoring — tracks port status for each worktree
# Each worktree gets its own port range: base + (slot × step)
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

// ── Main ─────────────────────────────────────────────────────────────────────

p.intro("wmdev init");

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
  p.note(lines, "Install these required dependencies, then re-run wmdev init");
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
  const s = p.spinner();
  s.start("Running workmux init...");
  const result = run("workmux", ["init"], { cwd: gitRoot });
  if (result.success) {
    s.stop(".workmux.yaml created");
  } else {
    s.stop("workmux init failed");
    p.log.warning("Could not create .workmux.yaml. Run 'workmux init' manually.");
  }
}

// Step 5 — .wmdev.yaml
const wmdevYaml = join(gitRoot, ".wmdev.yaml");
if (existsSync(wmdevYaml)) {
  p.log.info(".wmdev.yaml already exists, skipping");
} else {
  const name = detectProjectName(gitRoot);
  await Bun.write(wmdevYaml, wmdevTemplate(name));
  p.log.success(".wmdev.yaml created");
}

// Step 6 — Summary
p.note(
  `1. Edit .workmux.yaml to configure pane layout for your project
2. Edit .wmdev.yaml to set up service ports and profiles
3. Run: wmdev`,
  "Next steps",
);

p.outro("You're all set!");
