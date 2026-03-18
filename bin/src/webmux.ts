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
  webmux serve        Start the dashboard server (--app opens in app mode)
  webmux init         Interactive project setup
  webmux service      Manage webmux as a system service
  webmux update       Update webmux to the latest version
  webmux add          Create a worktree using the dashboard lifecycle
  webmux list         List worktrees and their status
  webmux open         Open an existing worktree session
  webmux close        Close a worktree session without removing it
  webmux remove       Remove a worktree
  webmux merge        Merge a worktree into the main branch and remove it
  webmux prune        Remove all worktrees in the current project
  webmux completion   Generate shell completion script (bash, zsh)

Options:
  --port N            Set port (default: 5111)
  --app               Open dashboard in browser app mode (minimal window)
  --debug             Show debug-level logs
  --version           Show version number
  --help              Show this help message

Environment:
  PORT             Same as --port (flag takes precedence)
`);
}

type RootCommand = "serve" | "init" | "service" | "update" | "add" | "list" | "open" | "close" | "remove" | "merge" | "prune" | "completion" | null;

interface ParsedRootArgs {
  port: number;
  debug: boolean;
  app: boolean;
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
    || value === "merge"
    || value === "prune"
    || value === "completion";
}

function isServeRootOption(value: string): boolean {
  return value === "--port" || value === "--app" || value === "--debug" || value === "--help" || value === "-h" || value === "--version" || value === "-V";
}

export function parseRootArgs(args: string[]): ParsedRootArgs {
  let port = parseInt(process.env.PORT || "5111", 10);
  let debug = false;
  let app = false;
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
      case "--app":
        app = true;
        break;
      case "--debug":
        debug = true;
        break;
      case "--version":
      case "-V":
        console.log(pkg.version);
        process.exit(0);
        break;
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
    app,
    command,
    commandArgs,
  };
}

function isWorktreeCommand(command: RootCommand): command is "add" | "list" | "open" | "close" | "remove" | "merge" | "prune" {
  return command === "add"
    || command === "list"
    || command === "open"
    || command === "close"
    || command === "remove"
    || command === "merge"
    || command === "prune";
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

// ── Browser app mode ─────────────────────────────────────────────────────────

function findBrowserBinary(): string | null {
  const candidates =
    process.platform === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Chromium.app/Contents/MacOS/Chromium",
          "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
          "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
        ]
      : [
          "google-chrome",
          "google-chrome-stable",
          "chromium",
          "chromium-browser",
          "microsoft-edge",
          "brave-browser",
        ];

  for (const candidate of candidates) {
    const found = candidate.startsWith("/")
      ? existsSync(candidate)
      : Bun.spawnSync(["which", candidate], { stdout: "pipe", stderr: "pipe" }).success;
    if (found) return candidate;
  }
  return null;
}

function openAppMode(url: string): void {
  const browser = findBrowserBinary();
  if (!browser) {
    console.log(`[app] No Chromium-based browser found — open ${url} manually`);
    return;
  }
  console.log(`[app] Opening ${url} in app mode`);
  Bun.spawn([browser, `--app=${url}`], {
    stdout: "ignore",
    stderr: "ignore",
  });
}

// ── Prefixed output ──────────────────────────────────────────────────────────

function pipeWithPrefix(
  stream: ReadableStream<Uint8Array>,
  prefix: string,
  onTrigger?: { text: string; callback: () => void },
): void {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fired = false;

  (async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop()!;
      for (const line of lines) {
        console.log(`${prefix} ${line}`);
        if (onTrigger && !fired && line.includes(onTrigger.text)) {
          fired = true;
          onTrigger.callback();
        }
      }
    }
    if (buffer) {
      console.log(`${prefix} ${buffer}`);
    }
  })();
}

async function main(args: string[] = process.argv.slice(2)): Promise<void> {
  // Internal: called by shell completion scripts
  if (args[0] === "--completions") {
    const { handleCompletions } = await import("./completions.ts");
    handleCompletions(args.slice(1));
    return;
  }

  let parsed: ParsedRootArgs;

  try {
    parsed = parseRootArgs(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  if (parsed.command === "completion") {
    const { runCompletionCommand } = await import("./completions.ts");
    process.exit(runCompletionCommand(parsed.commandArgs));
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
    PORT: String(parsed.port),
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

  if (parsed.app) {
    pipeWithPrefix(be.stdout, "[BE]", {
      text: "Dev Dashboard API running at",
      callback: () => openAppMode(`http://localhost:${parsed.port}`),
    });
  } else {
    pipeWithPrefix(be.stdout, "[BE]");
  }
  pipeWithPrefix(be.stderr, "[BE]");

  await be.exited;
}

if (import.meta.main) {
  await main();
}
