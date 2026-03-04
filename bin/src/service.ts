import * as p from "@clack/prompts";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { run, getGitRoot, detectProjectName } from "./shared.ts";
import type { RunResult } from "./shared.ts";

// ── Types ───────────────────────────────────────────────────────────────────

type Platform = "linux" | "darwin";
type Command = [bin: string, args: string[]];

interface ServiceConfig {
  platform: Platform;
  projectName: string;
  serviceName: string;
  wmdevPath: string;
  projectDir: string;
  port: number;
}

// ── Platform helpers ────────────────────────────────────────────────────────

function getPlatform(): Platform | null {
  const plat = process.platform;
  if (plat === "linux" || plat === "darwin") return plat;
  return null;
}

function resolveWmdevPath(): string | null {
  const result = run("which", ["wmdev"]);
  if (!result.success) return null;
  return result.stdout.toString().trim();
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function formatCommand([bin, args]: Command): string {
  return [bin, ...args].join(" ");
}

function runCommand(cmd: Command): RunResult {
  return run(cmd[0], cmd[1]);
}

function printRunResult(result: RunResult): void {
  console.log(result.stdout.toString());
  const err = result.stderr.toString().trim();
  if (err) console.error(err);
}

// ── Service file paths ──────────────────────────────────────────────────────

function systemdUnitPath(serviceName: string): string {
  return join(homedir(), ".config", "systemd", "user", `${serviceName}.service`);
}

function launchdPlistPath(serviceName: string): string {
  return join(homedir(), "Library", "LaunchAgents", `com.wmdev.${serviceName}.plist`);
}

function serviceFilePath(config: ServiceConfig): string {
  if (config.platform === "linux") return systemdUnitPath(config.serviceName);
  return launchdPlistPath(config.serviceName);
}

// ── Service file content ────────────────────────────────────────────────────

function generateSystemdUnit(config: ServiceConfig): string {
  return `[Unit]
Description=wmdev dashboard — ${config.projectName}

[Service]
Type=simple
ExecStart=${config.wmdevPath} --port ${config.port}
WorkingDirectory=${config.projectDir}
Restart=on-failure
RestartSec=5
Environment=BACKEND_PORT=${config.port}
Environment=WMDEV_PROJECT_DIR=${config.projectDir}
Environment=PATH=${process.env.PATH}

[Install]
WantedBy=default.target
`;
}

function generateLaunchdPlist(config: ServiceConfig): string {
  const logPath = join(homedir(), "Library", "Logs", `wmdev-${config.serviceName}.log`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.wmdev.${config.serviceName}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${config.wmdevPath}</string>
    <string>--port</string>
    <string>${config.port}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${config.projectDir}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>${logPath}</string>
  <key>StandardErrorPath</key>
  <string>${logPath}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>BACKEND_PORT</key>
    <string>${config.port}</string>
    <key>WMDEV_PROJECT_DIR</key>
    <string>${config.projectDir}</string>
    <key>PATH</key>
    <string>${process.env.PATH}</string>
  </dict>
</dict>
</plist>
`;
}

function generateServiceFile(config: ServiceConfig): string {
  if (config.platform === "linux") return generateSystemdUnit(config);
  return generateLaunchdPlist(config);
}

// ── Install/uninstall commands ──────────────────────────────────────────────

function installCommands(config: ServiceConfig): Command[] {
  if (config.platform === "linux") {
    return [
      ["systemctl", ["--user", "daemon-reload"]],
      ["systemctl", ["--user", "enable", "--now", config.serviceName]],
    ];
  }
  return [
    ["launchctl", ["load", "-w", launchdPlistPath(config.serviceName)]],
  ];
}

function uninstallCommands(config: ServiceConfig): Command[] {
  if (config.platform === "linux") {
    return [
      ["systemctl", ["--user", "stop", config.serviceName]],
      ["systemctl", ["--user", "disable", config.serviceName]],
    ];
  }
  return [
    ["launchctl", ["unload", "-w", launchdPlistPath(config.serviceName)]],
  ];
}

// ── Check if service exists ─────────────────────────────────────────────────

function isInstalled(config: ServiceConfig): boolean {
  return existsSync(serviceFilePath(config));
}

// ── Subcommands ─────────────────────────────────────────────────────────────

async function install(config: ServiceConfig): Promise<void> {
  const filePath = serviceFilePath(config);

  if (isInstalled(config)) {
    const reinstall = await p.confirm({ message: "Service is already installed. Reinstall?" });
    if (p.isCancel(reinstall) || !reinstall) {
      p.log.info("Aborted.");
      return;
    }
    for (const cmd of uninstallCommands(config)) {
      runCommand(cmd);
    }
  }

  const content = generateServiceFile(config);
  const commands = installCommands(config);

  p.note(
    [
      `File: ${filePath}`,
      "",
      "Contents:",
      content,
      "Commands to run:",
      ...commands.map((c) => `  $ ${formatCommand(c)}`),
    ].join("\n"),
    "Install service",
  );

  const ok = await p.confirm({ message: "Proceed?" });
  if (p.isCancel(ok) || !ok) {
    p.log.info("Aborted.");
    return;
  }

  mkdirSync(filePath.substring(0, filePath.lastIndexOf("/")), { recursive: true });

  await Bun.write(filePath, content);
  p.log.success(`Wrote ${filePath}`);

  for (const cmd of commands) {
    const result = runCommand(cmd);
    if (!result.success) {
      p.log.error(`Command failed: ${formatCommand(cmd)}\n${result.stderr.toString()}`);
      return;
    }
    p.log.success(`$ ${formatCommand(cmd)}`);
  }

  p.log.success("Service installed and started!");

  if (config.platform === "linux") {
    p.note(
      "To keep the service running after logout, run:\n  loginctl enable-linger $USER\n\n(May require admin privileges on some systems.)",
      "Tip",
    );
  }

  p.log.info(`Check status: wmdev service status`);
  p.log.info(`View logs:    wmdev service logs`);
}

async function uninstall(config: ServiceConfig): Promise<void> {
  const filePath = serviceFilePath(config);

  if (!isInstalled(config)) {
    p.log.error("Service is not installed.");
    return;
  }

  const commands = uninstallCommands(config);

  p.note(
    [
      `File to remove: ${filePath}`,
      "",
      "Commands to run:",
      ...commands.map((c) => `  $ ${formatCommand(c)}`),
    ].join("\n"),
    "Uninstall service",
  );

  const ok = await p.confirm({ message: "Proceed?" });
  if (p.isCancel(ok) || !ok) {
    p.log.info("Aborted.");
    return;
  }

  for (const cmd of commands) {
    const result = runCommand(cmd);
    if (!result.success) {
      p.log.warning(`Command failed: ${formatCommand(cmd)}\n${result.stderr.toString()}`);
    } else {
      p.log.success(`$ ${formatCommand(cmd)}`);
    }
  }

  unlinkSync(filePath);
  p.log.success(`Removed ${filePath}`);

  p.log.success("Service uninstalled.");
}

function status(config: ServiceConfig): void {
  if (!isInstalled(config)) {
    p.log.error("Service is not installed.");
    return;
  }

  if (config.platform === "linux") {
    printRunResult(run("systemctl", ["--user", "status", config.serviceName]));
  } else {
    printRunResult(run("launchctl", ["list", `com.wmdev.${config.serviceName}`]));
  }
}

function logs(config: ServiceConfig): void {
  if (!isInstalled(config)) {
    p.log.error("Service is not installed.");
    return;
  }

  let proc: ReturnType<typeof Bun.spawn>;
  if (config.platform === "linux") {
    proc = Bun.spawn(
      ["journalctl", "--user", "-u", config.serviceName, "-f", "--no-pager"],
      { stdout: "inherit", stderr: "inherit" },
    );
  } else {
    const logPath = join(homedir(), "Library", "Logs", `wmdev-${config.serviceName}.log`);
    if (!existsSync(logPath)) {
      p.log.error(`Log file not found: ${logPath}`);
      return;
    }
    proc = Bun.spawn(["tail", "-f", logPath], {
      stdout: "inherit",
      stderr: "inherit",
    });
  }
  process.on("SIGINT", () => proc.kill());
  proc.exited.then((code) => process.exit(code));
}

// ── Main ────────────────────────────────────────────────────────────────────

function usage(): void {
  console.log(`
wmdev service — Manage wmdev as a system service

Usage:
  wmdev service install     Install, enable, and start the service
  wmdev service uninstall   Stop, disable, and remove the service
  wmdev service status      Show service status
  wmdev service logs        Tail service logs
`);
}

export default async function service(args: string[]): Promise<void> {
  const action = args[0];

  if (!action || action === "--help" || action === "-h") {
    usage();
    return;
  }

  if (!["install", "uninstall", "status", "logs"].includes(action)) {
    p.log.error(`Unknown action: ${action}`);
    usage();
    return;
  }

  const platform = getPlatform();
  if (!platform) {
    p.log.error(`Unsupported platform: ${process.platform}. Only linux and macOS are supported.`);
    return;
  }

  const gitRoot = getGitRoot();
  if (!gitRoot) {
    p.log.error("Not inside a git repository.");
    return;
  }

  const wmdevPath = resolveWmdevPath();
  if (!wmdevPath) {
    p.log.error("Could not find wmdev in PATH.");
    return;
  }

  let port = parseInt(process.env.BACKEND_PORT || "5111");
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--port" && args[i + 1]) {
      const parsed = parseInt(args[++i]);
      if (Number.isNaN(parsed)) {
        p.log.error("--port requires a numeric value");
        return;
      }
      port = parsed;
    }
  }

  const projectName = detectProjectName(gitRoot);
  const serviceName = `wmdev-${sanitizeName(projectName)}`;

  const config: ServiceConfig = {
    platform,
    projectName,
    serviceName,
    wmdevPath,
    projectDir: gitRoot,
    port,
  };

  switch (action) {
    case "install":
      await install(config);
      break;
    case "uninstall":
      await uninstall(config);
      break;
    case "status":
      status(config);
      break;
    case "logs":
      logs(config);
      break;
  }
}
