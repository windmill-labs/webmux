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
  wmdev              Start in production mode (single port, serves built frontend)
  wmdev --dev        Start in dev mode (backend + Vite HMR on port+1)
  wmdev --port N     Set backend port (default: 5111)
  wmdev --help       Show this help message

Environment:
  DASHBOARD_PORT     Same as --port (flag takes precedence)
`);
}

// ── Parse args ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let devMode = false;
let port = parseInt(process.env.DASHBOARD_PORT || "5111");

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case "--dev":
      devMode = true;
      break;
    case "--port":
      port = parseInt(args[++i]);
      if (Number.isNaN(port)) {
        console.error("Error: --port requires a numeric value");
        process.exit(1);
      }
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

// ── Load .env from CWD ──────────────────────────────────────────────────────

const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  const lines = (await Bun.file(envPath).text()).split("\n");
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

// ── Shared env for child processes ───────────────────────────────────────────

const baseEnv = { ...process.env, DASHBOARD_PORT: String(port) };

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

if (devMode) {
  // Dev mode: backend with --watch + Vite dev server
  console.log(`Starting dev mode (backend :${port}, frontend :${port + 1})...`);

  const be = Bun.spawn(["bun", "--watch", backendEntry], {
    env: baseEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  children.push(be);
  pipeWithPrefix(be.stdout, "[BE]");
  pipeWithPrefix(be.stderr, "[BE]");

  const viteConfig = join(PKG_ROOT, "frontend", "vite.config.ts");
  const fe = Bun.spawn(
    ["bun", "x", "vite", "--host", "0.0.0.0", "--port", String(port + 1), "--config", viteConfig],
    {
      cwd: join(PKG_ROOT, "frontend"),
      env: baseEnv,
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  children.push(fe);
  pipeWithPrefix(fe.stdout, "[FE]");
  pipeWithPrefix(fe.stderr, "[FE]");

  await Promise.all([be.exited, fe.exited]);
} else {
  // Production mode: backend serves API + static frontend
  const staticDir = join(PKG_ROOT, "frontend", "dist");

  if (!existsSync(staticDir)) {
    console.error(
      `Error: frontend/dist/ not found. Run 'bun run build' first, or use --dev for development mode.`,
    );
    process.exit(1);
  }

  console.log(`Starting production mode on port ${port}...`);

  const be = Bun.spawn(["bun", backendEntry], {
    env: { ...baseEnv, WMDEV_STATIC_DIR: staticDir },
    stdout: "pipe",
    stderr: "pipe",
  });
  children.push(be);
  pipeWithPrefix(be.stdout, "[BE]");
  pipeWithPrefix(be.stderr, "[BE]");

  await be.exited;
}
