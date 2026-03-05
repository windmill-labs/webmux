#!/usr/bin/env bun

import { resolve, dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Subprocess } from "bun";

// ── Helpers ──────────────────────────────────────────────────────────────────

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function usage() {
  console.log(`
webmux — Dev dashboard for managing Git worktrees

Usage:
  webmux              Start the dashboard
  webmux init         Interactive project setup
  webmux service      Manage webmux as a system service
  webmux --port N     Set port (default: 5111)
  webmux --debug      Show debug-level logs
  webmux --help       Show this help message

Environment:
  BACKEND_PORT     Same as --port (flag takes precedence)
`);
}

// ── Parse args ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args[0] === "init") {
  await import("./init.ts");
  process.exit(0);
}

if (args[0] === "service") {
  const { default: service } = await import("./service.ts");
  await service(args.slice(1));
  process.exit(0);
}

let port = parseInt(process.env.BACKEND_PORT || "5111");
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
      console.error(`Unknown option: ${args[i]}\nRun webmux --help for usage.`);
      process.exit(1);
  }
}

// ── Check for .webmux.yaml ───────────────────────────────────────────────────

if (!existsSync(resolve(process.cwd(), ".webmux.yaml"))) {
  console.error("No .webmux.yaml found in this directory.\nRun `webmux init` to set up your project.");
  process.exit(1);
}

// ── Load env files from CWD (.env.local overrides .env) ─────────────────────

async function loadEnvFile(path: string) {
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

const baseEnv = { ...process.env, BACKEND_PORT: String(port), WEBMUX_PROJECT_DIR: process.cwd(), ...(debug ? { WEBMUX_DEBUG: "1" } : {}) };

// ── Prefixed output ──────────────────────────────────────────────────────────

function pipeWithPrefix(stream: ReadableStream<Uint8Array>, prefix: string) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  (async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop()!;
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

const children: Subprocess[] = [];
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

const backendEntry = join(PKG_ROOT, "backend", "dist", "server.js");
const staticDir = join(PKG_ROOT, "frontend", "dist");

if (!existsSync(staticDir)) {
  console.error(
    `Error: frontend/dist/ not found. Run 'bun run build' first.`,
  );
  process.exit(1);
}

console.log(`Starting webmux on port ${port}...`);

const be = Bun.spawn(["bun", backendEntry], {
  env: { ...baseEnv, WEBMUX_STATIC_DIR: staticDir },
  stdout: "pipe",
  stderr: "pipe",
});
children.push(be);
pipeWithPrefix(be.stdout, "[BE]");
pipeWithPrefix(be.stderr, "[BE]");

await be.exited;
