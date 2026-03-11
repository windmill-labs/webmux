#!/usr/bin/env bun

import { resolve, dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Subprocess } from "bun";
import pkg from "../../package.json";

// ── Helpers ──────────────────────────────────────────────────────────────────

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function usage() {
  console.log(`
webmux — Dev dashboard for managing Git worktrees

Usage:
  webmux serve        Start the dashboard server
  webmux init         Interactive project setup
  webmux service      Manage webmux as a system service
  webmux update       Update webmux to the latest version
  webmux add          Create a worktree using the dashboard lifecycle
  webmux list         List worktrees and their status
  webmux open         Open an existing worktree session
  webmux close        Close a worktree session without removing it
  webmux remove       Remove a worktree
  webmux merge        Merge a worktree into the main branch and remove it

Options:
  --port N            Set port (default: 5111)
  --debug             Show debug-level logs
  --version           Show version number
  --help              Show this help message

Environment:
  BACKEND_PORT     Same as --port (flag takes precedence)
`);
}

type RootCommand = "serve" | "init" | "service" | "update" | "add" | "list" | "open" | "close" | "remove" | "merge" | null;

interface ParsedRootArgs {
  port: number;
  debug: boolean;
  command: RootCommand;
  commandArgs: string[];
}

function isRootCommand(value: string): value is NonNullable<RootCommand> {
  return value === "serve"
    || value === "init"
    || value === "service"
    || value === "update"
    || value === "add"
    || value === "list"
    || value === "open"
    || value === "close"
    || value === "remove"
    || value === "merge";
}

function isServeRootOption(value: string): boolean {
  return value === "--port" || value === "--debug" || value === "--help" || value === "-h" || value === "--version" || value === "-V";
}

export function parseRootArgs(args: string[]): ParsedRootArgs {
  let port = parseInt(process.env.BACKEND_PORT || "5111", 10);
  let debug = false;
  let command: RootCommand = null;
  const commandArgs: string[] = [];

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg) continue;

    if (command && (command !== "serve" || !isServeRootOption(arg))) {
      commandArgs.push(arg);
      continue;
    }

    switch (arg) {
      case "--port": {
        const value = args[index + 1];
        if (!value) {
          throw new Error("Error: --port requires a numeric value");
        }
        port = parseInt(value, 10);
        if (Number.isNaN(port)) {
          throw new Error("Error: --port requires a numeric value");
        }
        index += 1;
        break;
      }
      case "--debug":
        debug = true;
        break;
      case "--version":
      case "-V":
        console.log(pkg.version);
        process.exit(0);
      case "--help":
      case "-h":
        usage();
        process.exit(0);
      default:
        if (!isRootCommand(arg)) {
          throw new Error(`Unknown command or option: ${arg}\nRun webmux --help for usage.`);
        }
        command = arg;
    }
  }

  return {
    port,
    debug,
    command,
    commandArgs,
  };
}

function isWorktreeCommand(command: RootCommand): command is "add" | "list" | "open" | "close" | "remove" | "merge" {
  return command === "add"
    || command === "list"
    || command === "open"
    || command === "close"
    || command === "remove"
    || command === "merge";
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

async function main(args: string[] = process.argv.slice(2)): Promise<void> {
  let parsed: ParsedRootArgs;

  try {
    parsed = parseRootArgs(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  if (parsed.command === "init") {
    await import("./init.ts");
    process.exit(0);
  }

  if (parsed.command === "service") {
    const { default: service } = await import("./service.ts");
    await service(parsed.commandArgs);
    process.exit(0);
  }

  if (parsed.command === "update") {
    console.log("Updating webmux to the latest version...");
    const proc = Bun.spawn(["bun", "install", "--global", "webmux@latest"], {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    const code = await proc.exited;
    process.exit(code);
  }

  await loadEnvFile(resolve(process.cwd(), ".env.local"));
  await loadEnvFile(resolve(process.cwd(), ".env"));

  if (isWorktreeCommand(parsed.command)) {
    const { runWorktreeCommand } = await import("./worktree-commands.ts");
    const exitCode = await runWorktreeCommand({
      command: parsed.command,
      args: parsed.commandArgs,
      projectDir: process.cwd(),
      port: parsed.port,
    });
    process.exit(exitCode);
  }

  if (parsed.command === null) {
    usage();
    process.exit(0);
  }

  if (!existsSync(resolve(process.cwd(), ".webmux.yaml"))) {
    console.error("No .webmux.yaml found in this directory.\nRun `webmux init` to set up your project.");
    process.exit(1);
  }

  const baseEnv = {
    ...process.env,
    BACKEND_PORT: String(parsed.port),
    WEBMUX_PROJECT_DIR: process.cwd(),
    ...(parsed.debug ? { WEBMUX_DEBUG: "1" } : {}),
  };

  const children: Subprocess[] = [];
  let exiting = false;

  function cleanup() {
    if (exiting) return;
    exiting = true;
    for (const child of children) {
      try { child.kill("SIGTERM"); } catch {}
    }
    setTimeout(() => {
      for (const child of children) {
        try { child.kill("SIGKILL"); } catch {}
      }
      process.exit(0);
    }, 1000).unref();
  }

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  const backendEntry = join(PKG_ROOT, "backend", "dist", "server.js");
  const staticDir = join(PKG_ROOT, "frontend", "dist");

  if (!existsSync(staticDir)) {
    console.error(
      `Error: frontend/dist/ not found. Run 'bun run build' first.`,
    );
    process.exit(1);
  }

  console.log(`Starting webmux on port ${parsed.port}...`);

  const be = Bun.spawn(["bun", backendEntry], {
    env: { ...baseEnv, WEBMUX_STATIC_DIR: staticDir },
    stdout: "pipe",
    stderr: "pipe",
  });
  children.push(be);
  pipeWithPrefix(be.stdout, "[BE]");
  pipeWithPrefix(be.stderr, "[BE]");

  await be.exited;
}

if (import.meta.main) {
  await main();
}
