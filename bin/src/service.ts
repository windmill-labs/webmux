import * as p from "@clack/prompts";
import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { basename, join } from "node:path";
import { homedir } from "node:os";
import { run, getGitRoot, detectProjectName } from "./shared.ts";
import type { RunResult } from "./shared.ts";
import { discoverTakenPorts, pickFreePort, readPortFromUnit } from "./install-ports.ts";

// ── Types ───────────────────────────────────────────────────────────────────

export type Platform = "linux" | "darwin";
type Command = [bin: string, args: string[]];

export interface ServiceConfig {
  platform: Platform;
  projectName: string;
  serviceName: string;
  webmuxPath: string;
  projectDir: string;
  port: number;
}

// ── Platform helpers ────────────────────────────────────────────────────────

function getPlatform(): Platform | null {
  const plat = process.platform;
  if (plat === "linux" || plat === "darwin") return plat;
  return null;
}

function resolveWebmuxPath(): string | null {
  const result = run("which", ["webmux"]);
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
  return join(homedir(), "Library", "LaunchAgents", `com.webmux.${serviceName}.plist`);
}

function serviceFilePath(config: ServiceConfig): string {
  if (config.platform === "linux") return systemdUnitPath(config.serviceName);
  return launchdPlistPath(config.serviceName);
}

// ── Service file content ────────────────────────────────────────────────────

function generateSystemdUnit(config: ServiceConfig): string {
  return `[Unit]
Description=webmux dashboard — ${config.projectName}

[Service]
Type=simple
ExecStart=${config.webmuxPath} serve --port ${config.port}
WorkingDirectory=${config.projectDir}
Restart=on-failure
RestartSec=5
Environment=PORT=${config.port}
Environment=WEBMUX_PROJECT_DIR=${config.projectDir}
Environment=PATH=${process.env.PATH}

[Install]
WantedBy=default.target
`;
}

function generateLaunchdPlist(config: ServiceConfig): string {
  const logPath = join(homedir(), "Library", "Logs", `webmux-${config.serviceName}.log`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.webmux.${config.serviceName}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${config.webmuxPath}</string>
    <string>serve</string>
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
    <key>PORT</key>
    <string>${config.port}</string>
    <key>WEBMUX_PROJECT_DIR</key>
    <string>${config.projectDir}</string>
    <key>PATH</key>
    <string>${process.env.PATH}</string>
  </dict>
</dict>
</plist>
`;
}

export function generateServiceFile(config: ServiceConfig): string {
  if (config.platform === "linux") return generateSystemdUnit(config);
  return generateLaunchdPlist(config);
}

const SYSTEMD_WORKDIR_RE = /^WorkingDirectory=(.+)$/m;
const LAUNCHD_WORKDIR_RE = /<key>WorkingDirectory<\/key>\s*<string>([^<]+)<\/string>/;

function readWorkingDirFromUnit(filePath: string, platform: Platform): string | null {
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
  const regex = platform === "linux" ? SYSTEMD_WORKDIR_RE : LAUNCHD_WORKDIR_RE;
  const match = regex.exec(text);
  return match ? match[1].trim() : null;
}

/** Reconstruct a ServiceConfig from an installed unit file. The serviceName
 *  is taken from the file basename (not re-derived) so a renamed project dir
 *  doesn't change the launchd Label / systemd unit name that the OS is
 *  already tracking — only the regenerated *content* (description, paths,
 *  environment) reflects the current state. Returns null when the file is
 *  missing required fields. */
export function parseInstalledServiceConfig(
  filePath: string,
  platform: Platform,
  webmuxPath: string,
): ServiceConfig | null {
  const port = readPortFromUnit(filePath);
  if (port === null) return null;

  const projectDir = readWorkingDirFromUnit(filePath, platform);
  if (projectDir === null) return null;

  const fileBase = basename(filePath);
  const serviceName = platform === "linux"
    ? fileBase.replace(/\.service$/, "")
    : fileBase.replace(/^com\.webmux\./, "").replace(/\.plist$/, "");

  const projectName = detectProjectName(projectDir);

  return {
    platform,
    projectName,
    serviceName,
    webmuxPath,
    projectDir,
    port,
  };
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

async function install(config: ServiceConfig, portExplicit: boolean): Promise<void> {
  const filePath = serviceFilePath(config);
  const alreadyInstalled = isInstalled(config);

  if (alreadyInstalled) {
    const reinstall = await p.confirm({ message: "Service is already installed. Reinstall?" });
    if (p.isCancel(reinstall) || !reinstall) {
      p.log.info("Aborted.");
      return;
    }
    for (const cmd of uninstallCommands(config)) {
      runCommand(cmd);
    }
  }

  // Pick the port that will go into the unit file. With an explicit `--port`,
  // the user wins. On reinstall, reuse the existing unit's port so a re-run
  // without flags is idempotent. Otherwise scan the live registry + already
  // installed unit files and find the lowest free port at or above the
  // requested start, so installing in a second project doesn't silently
  // collide on 5111.
  const requestedPort = config.port;
  let chosenPort = requestedPort;
  let portNote: string | null = null;
  let portWarning: string | null = null;

  if (!portExplicit) {
    const existingPort = alreadyInstalled ? readPortFromUnit(filePath) : null;
    if (existingPort !== null) {
      chosenPort = existingPort;
      if (existingPort !== requestedPort) {
        portNote = `Reusing port ${existingPort} from the existing service unit (pass --port to override).`;
      }
    } else {
      const taken = discoverTakenPorts({ excludeUnitPath: filePath });
      chosenPort = pickFreePort(requestedPort, taken);
      if (chosenPort !== requestedPort) {
        portNote = `Port ${requestedPort} is already used by another webmux instance — picked ${chosenPort} instead (pass --port to override).`;
      }
    }
  } else {
    // Explicit `--port` always wins, but the service will fail to bind on
    // start if something else is already there — surface it now rather than
    // making the user dig through `journalctl` / `launchctl` logs later.
    const taken = discoverTakenPorts({ excludeUnitPath: filePath });
    if (taken.has(requestedPort)) {
      portWarning = `Port ${requestedPort} is already claimed by another webmux instance. The service will fail to bind on start; omit --port to auto-pick a free port.`;
    }
  }

  config = { ...config, port: chosenPort };
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

  if (portNote) p.log.info(portNote);
  if (portWarning) p.log.warn(portWarning);

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

  p.log.info(`Check status: webmux service status`);
  p.log.info(`View logs:    webmux service logs`);
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
    printRunResult(run("launchctl", ["list", `com.webmux.${config.serviceName}`]));
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
    const logPath = join(homedir(), "Library", "Logs", `webmux-${config.serviceName}.log`);
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
webmux service — Manage webmux as a system service

Usage:
  webmux service install     Install, enable, and start the service
  webmux service uninstall   Stop, disable, and remove the service
  webmux service status      Show service status
  webmux service logs        Tail service logs

Options:
  --port N                   Pin the service to a specific port. When omitted,
                             a free port is picked automatically by scanning
                             other webmux instances and installed services
                             — second-project installs no longer collide on 5111.
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

  const serviceManager = platform === "linux" ? "systemctl" : "launchctl";
  const smResult = run("which", [serviceManager]);
  if (!smResult.success) {
    p.log.error(`${serviceManager} not found. Cannot manage services on this system.`);
    return;
  }

  const webmuxPath = resolveWebmuxPath();
  if (!webmuxPath) {
    p.log.error("Could not find webmux in PATH.");
    return;
  }

  let port = parseInt(process.env.PORT || "5111");
  let portExplicit = false;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--port" && args[i + 1]) {
      const parsed = parseInt(args[++i]);
      if (Number.isNaN(parsed)) {
        p.log.error("--port requires a numeric value");
        return;
      }
      port = parsed;
      portExplicit = true;
    }
  }

  const projectName = detectProjectName(gitRoot);
  const serviceName = `webmux-${sanitizeName(projectName)}`;

  const config: ServiceConfig = {
    platform,
    projectName,
    serviceName,
    webmuxPath,
    projectDir: gitRoot,
    port,
  };

  switch (action) {
    case "install":
      await install(config, portExplicit);
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
