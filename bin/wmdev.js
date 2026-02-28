#!/usr/bin/env bun

import { resolve, dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// ── Helpers ──────────────────────────────────────────────────────────────────

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function usage() {
  console.log(`
wmdev — Dev dashboard for managing Git worktrees

Usage:
  wmdev              Start the dashboard
  wmdev --port N     Set port (default: 5111)
  wmdev --debug      Show debug-level logs
  wmdev --help       Show this help message

Environment:
  DASHBOARD_PORT     Same as --port (flag takes precedence)
`);
}

// ── Parse args ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let port = parseInt(process.env.DASHBOARD_PORT || "5111");
let debug = false;

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case "--port":
      port = parseInt(args[++i]);
      if (Number.isNaN(port)) {
        console.error("Error: --port requires a numeric value");
        process.exit(1);
      }
      break;
    case "--debug":
      debug = true;
      break;
    case "--help":
    case "-h":
      usage();
      process.exit(0);
      break;
    default:
      console.error(`Unknown option: ${args[i]}\nRun wmdev --help for usage.`);
      process.exit(1);
  }
}

// ── Load env files from CWD (.env.local overrides .env) ─────────────────────

async function loadEnvFile(path) {
  if (!existsSync(path)) return;
  const lines = (await Bun.file(path).text()).split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) {
      process.env[key] = val;
    }
  }
}

await loadEnvFile(resolve(process.cwd(), ".env.local"));
await loadEnvFile(resolve(process.cwd(), ".env"));

// ── Shared env for child processes ───────────────────────────────────────────

const baseEnv = { ...process.env, DASHBOARD_PORT: String(port), WMDEV_PROJECT_DIR: process.cwd(), ...(debug ? { WMDEV_DEBUG: "1" } : {}) };

// ── Prefixed output ──────────────────────────────────────────────────────────

function pipeWithPrefix(stream, prefix) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  (async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        console.log(`${prefix} ${line}`);
      }
    }
    if (buffer) {
      console.log(`${prefix} ${buffer}`);
    }
  })();
}

// ── Process management ───────────────────────────────────────────────────────

const children = [];
let exiting = false;

function cleanup() {
  if (exiting) return;
  exiting = true;
  for (const child of children) {
    try { child.kill("SIGTERM"); } catch {}
  }
  // Force-kill stragglers after 1s, then exit
  setTimeout(() => {
    for (const child of children) {
      try { child.kill("SIGKILL"); } catch {}
    }
    process.exit(0);
  }, 1000).unref();
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

// ── Start ────────────────────────────────────────────────────────────────────

const backendEntry = join(PKG_ROOT, "backend", "src", "server.ts");
const staticDir = join(PKG_ROOT, "frontend", "dist");

if (!existsSync(staticDir)) {
  console.error(
    `Error: frontend/dist/ not found. Run 'bun run build' first.`,
  );
  process.exit(1);
}

console.log(`Starting wmdev on port ${port}...`);

const be = Bun.spawn(["bun", backendEntry], {
  env: { ...baseEnv, WMDEV_STATIC_DIR: staticDir },
  stdout: "pipe",
  stderr: "pipe",
});
children.push(be);
pipeWithPrefix(be.stdout, "[BE]");
pipeWithPrefix(be.stderr, "[BE]");

await be.exited;
