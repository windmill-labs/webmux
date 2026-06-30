import * as p from "@clack/prompts";
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { basename, join } from "node:path";
import { homedir } from "node:os";
import { run, getGitRoot, detectProjectName } from "./shared.ts";
import type { RunResult } from "./shared.ts";
import { createProjectsRegistry, type ProjectsRegistry } from "../../backend/src/adapters/projects-registry";

// ── Types ───────────────────────────────────────────────────────────────────

export type Platform = "linux" | "darwin";
type Command = [bin: string, args: string[]];

export interface ServiceConfig {
  platform: Platform;
  serviceName: string;
  webmuxPath: string;
  port: number;
  /** Extra environment variables to bake into the unit (LINEAR_API_KEY etc.).
   *  PORT / PATH are managed by the generator and must not be passed here. */
  envVars: Record<string, string>;
}

/** Env vars webmux reads at runtime that are worth auto-detecting from the
 *  installing shell's environment. Limited to credentials/integrations users
 *  typically `export` in their dotfiles — not knobs like WEBMUX_DEBUG. */
export const AUTO_PICKUP_ENV_VARS = ["LINEAR_API_KEY"] as const;

/** Env-var names the generator owns and refuses to accept as user envVars —
 *  the unit file sets them separately. */
const RESERVED_ENV_KEYS = new Set(["PORT", "WEBMUX_PROJECT_DIR", "PATH"]);

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

/** Decide whether a repo should be persisted to projects.json. webmux is a
 *  single machine-wide service that serves everything in projects.json, so a
 *  webmux project that isn't registered yet is registered the same way
 *  `webmux project add` would. Used both by `service install` (the current repo)
 *  and by the update/reinstall migration of a unit's previously-served repo.
 *  Skipped when there's no path, when it has no webmux config, or when it is
 *  already registered. */
export function shouldPersistProject(
  root: string | null,
  hasWebmuxConfig: boolean,
  existingPaths: string[],
): boolean {
  if (!root || !hasWebmuxConfig) return false;
  return !existingPaths.includes(root);
}

/** Whether `root` is a webmux project (carries a config file). */
function hasWebmuxConfig(root: string): boolean {
  return existsSync(join(root, ".webmux.yaml")) || existsSync(join(root, ".webmux.local.yaml"));
}

/** Register `root` as a project when eligible; returns the path if newly added,
 *  else null. The registry is injectable so the migration is unit-testable. */
function persistProject(root: string | null, registry: ProjectsRegistry): string | null {
  if (!root) return null;
  const existingPaths = registry.list().map((entry) => entry.path);
  if (!shouldPersistProject(root, hasWebmuxConfig(root), existingPaths)) return null;
  registry.add({ path: root, name: detectProjectName(root), addedAt: Date.now() });
  return root;
}

/** I/O wrapper: the current repo when `service install` should register it,
 *  else null. Decided ahead of the confirmation prompt for the plan preview;
 *  the actual write happens after confirmation. */
function cwdProjectToPersist(): string | null {
  const gitRoot = getGitRoot();
  if (!gitRoot) return null;
  const existingPaths = createProjectsRegistry().list().map((entry) => entry.path);
  return shouldPersistProject(gitRoot, hasWebmuxConfig(gitRoot), existingPaths) ? gitRoot : null;
}

/** Carry a unit's previously-served repo forward into projects.json before the
 *  unit is regenerated. Older units served one repo implicitly via
 *  `WEBMUX_PROJECT_DIR` (added only ephemerally by the server), which the new
 *  unit template drops — without this, that repo would silently vanish from the
 *  dashboard on `webmux update` / reinstall. Idempotent: a regenerated unit's
 *  `WorkingDirectory=$HOME` has no webmux config, and an already-registered repo
 *  is skipped. Returns the migrated path, or null when there's nothing to do. */
export function migrateServedRepoFromUnit(
  filePath: string,
  platform: Platform,
  registry: ProjectsRegistry = createProjectsRegistry(),
): string | null {
  return persistProject(readWorkingDirFromUnit(filePath, platform), registry);
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
  // Sort by key so reinstalls / regenerations produce stable output regardless
  // of which order the user passed --env flags or which order Object.keys
  // happens to iterate.
  const extra = Object.keys(config.envVars).sort()
    .map((key) => `Environment=${key}=${config.envVars[key]}`)
    .join("\n");
  return `[Unit]
Description=webmux dashboard

[Service]
Type=simple
ExecStart=${config.webmuxPath} serve --port ${config.port}
WorkingDirectory=${homedir()}
Restart=on-failure
RestartSec=5
Environment=PORT=${config.port}
Environment=PATH=${process.env.PATH}${extra ? "\n" + extra : ""}

[Install]
WantedBy=default.target
`;
}

function escapePlistText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function generateLaunchdPlist(config: ServiceConfig): string {
  const logPath = join(homedir(), "Library", "Logs", `webmux-${config.serviceName}.log`);
  const extra = Object.keys(config.envVars).sort()
    .map((key) => `    <key>${escapePlistText(key)}</key>\n    <string>${escapePlistText(config.envVars[key])}</string>`)
    .join("\n");
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
  <string>${homedir()}</string>
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
    <key>PATH</key>
    <string>${process.env.PATH}</string>${extra ? "\n" + extra : ""}
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
const SYSTEMD_PORT_RE = /--port\s+(\d+)/;
const LAUNCHD_PORT_RE = /<string>--port<\/string>\s*<string>(\d+)<\/string>/;
const SYSTEMD_ENV_RE = /^Environment=([A-Za-z_][A-Za-z0-9_]*)=(.*)$/gm;
const LAUNCHD_ENV_DICT_RE = /<key>EnvironmentVariables<\/key>\s*<dict>([\s\S]*?)<\/dict>/;
const LAUNCHD_ENV_ENTRY_RE = /<key>([^<]+)<\/key>\s*<string>([^<]*)<\/string>/g;

/** Read the `WorkingDirectory` an installed unit points at. Old units set this
 *  to the served repo; new units set it to `$HOME`. Used to migrate a unit's
 *  previously-served repo into projects.json before the unit is regenerated. */
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

/** Parse the `--port N` value out of an installed unit file (systemd or
 *  launchd). Used to keep a reinstall idempotent (reuse the running port) and
 *  to regenerate units on `webmux update`. */
export function readPortFromUnit(filePath: string): number | null {
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
  const regex = filePath.endsWith(".plist") ? LAUNCHD_PORT_RE : SYSTEMD_PORT_RE;
  const match = regex.exec(text);
  return match ? parseInt(match[1], 10) : null;
}

function unescapePlistText(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Extract user-set env vars from an existing unit file. Strips out the keys
 *  the generator manages itself (PORT/WEBMUX_PROJECT_DIR/PATH) so a re-parse
 *  → re-generate cycle stays idempotent and doesn't double-emit them. */
export function readEnvVarsFromUnit(filePath: string, platform: Platform): Record<string, string> {
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch {
    return {};
  }
  const out: Record<string, string> = {};
  if (platform === "linux") {
    for (const match of text.matchAll(SYSTEMD_ENV_RE)) {
      const key = match[1];
      if (RESERVED_ENV_KEYS.has(key)) continue;
      out[key] = match[2];
    }
    return out;
  }
  const dict = LAUNCHD_ENV_DICT_RE.exec(text);
  if (!dict) return out;
  for (const match of dict[1].matchAll(LAUNCHD_ENV_ENTRY_RE)) {
    const key = unescapePlistText(match[1]);
    if (RESERVED_ENV_KEYS.has(key)) continue;
    out[key] = unescapePlistText(match[2]);
  }
  return out;
}

/** Reconstruct a ServiceConfig from an installed unit file. The serviceName
 *  is taken from the file basename (not re-derived) so the launchd Label /
 *  systemd unit name the OS is already tracking stays stable — only the
 *  regenerated *content* (paths, environment) reflects the current template.
 *  Returns null when the file is missing required fields. */
export function parseInstalledServiceConfig(
  filePath: string,
  platform: Platform,
  webmuxPath: string,
): ServiceConfig | null {
  const port = readPortFromUnit(filePath);
  if (port === null) return null;

  const fileBase = basename(filePath);
  const serviceName = platform === "linux"
    ? fileBase.replace(/\.service$/, "")
    : fileBase.replace(/^com\.webmux\./, "").replace(/\.plist$/, "");

  const envVars = readEnvVarsFromUnit(filePath, platform);

  return {
    platform,
    serviceName,
    webmuxPath,
    port,
    envVars,
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

interface EnvVarResolution {
  envVars: Record<string, string>;
  /** Human-readable lines describing where each var came from, for logging. */
  notes: string[];
}

/** Build the final env-var set for the unit by merging, in order of
 *  precedence (later wins):
 *    1. env vars already in the installed unit (so reinstall preserves them)
 *    2. auto-picked from process.env (LINEAR_API_KEY etc.)
 *    3. explicit --env KEY=VAL from the CLI
 *  Notes capture every key added so the user sees what got baked in before
 *  confirming the install. */
export function resolveEnvVars(opts: {
  cliEnv: Record<string, string>;
  processEnv: Record<string, string | undefined>;
  existing: Record<string, string>;
  autoPickup: boolean;
}): EnvVarResolution {
  const envVars: Record<string, string> = { ...opts.existing };
  const notes: string[] = [];

  for (const key of Object.keys(opts.existing).sort()) {
    notes.push(`  ${key}  (kept from existing unit)`);
  }

  if (opts.autoPickup) {
    for (const key of AUTO_PICKUP_ENV_VARS) {
      const value = opts.processEnv[key];
      if (value === undefined || value === "") continue;
      const prior = envVars[key];
      envVars[key] = value;
      notes.push(
        prior === undefined
          ? `  ${key}  (auto-picked from shell environment)`
          : prior === value
            ? `  ${key}  (auto-pick matched existing value)`
            : `  ${key}  (auto-picked from shell environment, overrides existing)`,
      );
    }
  }

  for (const [key, value] of Object.entries(opts.cliEnv)) {
    const prior = envVars[key];
    envVars[key] = value;
    notes.push(
      prior === undefined
        ? `  ${key}  (from --env)`
        : `  ${key}  (from --env, overrides previous value)`,
    );
  }

  return { envVars, notes };
}

export interface CliEnvParseResult {
  envVars: Record<string, string>;
  errors: string[];
}

/** Parse repeated `--env KEY=VAL` occurrences out of the CLI args. The split
 *  is anchored on the first `=` so values containing `=` (JWTs, base64) pass
 *  through intact. */
export function parseEnvCliArgs(args: string[]): CliEnvParseResult {
  const envVars: Record<string, string> = {};
  const errors: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== "--env") continue;
    const raw = args[i + 1];
    if (raw === undefined) {
      errors.push("--env requires a KEY=VALUE argument");
      break;
    }
    i++;
    const eq = raw.indexOf("=");
    if (eq <= 0) {
      errors.push(`--env expects KEY=VALUE (got: ${raw})`);
      continue;
    }
    const key = raw.slice(0, eq);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      errors.push(`--env key is not a valid identifier: ${key}`);
      continue;
    }
    if (RESERVED_ENV_KEYS.has(key)) {
      errors.push(`--env cannot set ${key} — it is managed by the service unit`);
      continue;
    }
    envVars[key] = raw.slice(eq + 1);
  }
  return { envVars, errors };
}

/** Replace secret-looking values in the preview output. Anything with a
 *  key suffix that smells secret (TOKEN/KEY/PASSWORD/SECRET) is shown as
 *  `••• (NN chars)` so the install note can be safely copy-pasted into a
 *  bug report without leaking credentials. */
function redactSecretsInUnit(content: string, envVars: Record<string, string>): string {
  let out = content;
  for (const [key, value] of Object.entries(envVars)) {
    if (!value) continue;
    if (!/(?:TOKEN|KEY|PASSWORD|SECRET)$/i.test(key)) continue;
    const masked = `••• (${value.length} chars)`;
    // Cheap whole-string replace — env values are unique enough in a unit
    // file that this won't collide with other content.
    out = out.split(value).join(masked);
  }
  return out;
}

/** Whether we can prompt the user. In a non-TTY (CI, a pipe, a service runner)
 *  stdin can't answer a confirm, so callers print the plan and bail with a
 *  `--yes` hint instead of hanging on a prompt nobody can see. */
function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY);
}

export type ConfirmDecision = "proceed" | "prompt" | "abort-noninteractive";

/** Resolve how `service install` should confirm: `--yes` proceeds outright, an
 *  interactive shell prompts, and a non-interactive shell without `--yes` bails
 *  (the caller prints the plan + a `--yes` hint instead of hanging). */
export function resolveConfirmDecision(autoConfirm: boolean, interactive: boolean): ConfirmDecision {
  if (autoConfirm) return "proceed";
  if (!interactive) return "abort-noninteractive";
  return "prompt";
}

async function install(
  config: ServiceConfig,
  portExplicit: boolean,
  envVarNotes: string[],
  autoConfirm: boolean,
): Promise<void> {
  const filePath = serviceFilePath(config);
  const alreadyInstalled = isInstalled(config);

  // Pick the port for the unit. An explicit `--port` wins; otherwise, on
  // reinstall, reuse the existing unit's port so a bare re-run is idempotent;
  // otherwise the default. webmux is one service per machine now — there's no
  // other-instance scan. If the port is taken at start it's because another
  // webmux is already running, which is the cue to `webmux project migrate`.
  const requestedPort = config.port;
  let chosenPort = requestedPort;
  let portNote: string | null = null;

  if (!portExplicit && alreadyInstalled) {
    const existingPort = readPortFromUnit(filePath);
    if (existingPort !== null && existingPort !== requestedPort) {
      chosenPort = existingPort;
      portNote = `Reusing port ${existingPort} from the existing service unit (pass --port to override).`;
    }
  }

  config = { ...config, port: chosenPort };
  const content = generateServiceFile(config);
  const commands = installCommands(config);

  // The service serves every project in projects.json, so if we're installing
  // from inside a webmux project, register it now — that repo then loads on the
  // service's next start like any other persisted project.
  const persistPath = cwdProjectToPersist();

  // Mask secret-shaped values in the preview so the dry-run note doesn't
  // splat tokens onto the terminal. The on-disk unit gets chmod 600 below.
  const displayContent = redactSecretsInUnit(content, config.envVars);

  p.note(
    [
      ...(alreadyInstalled ? ["Service is already installed — this will reinstall it.", ""] : []),
      `File: ${filePath}`,
      "",
      "Contents:",
      displayContent,
      "Commands to run:",
      ...commands.map((c) => `  $ ${formatCommand(c)}`),
      ...(persistPath ? ["", `Will also register this project: ${persistPath}`] : []),
    ].join("\n"),
    "Install service",
  );

  if (Object.keys(config.envVars).length > 0) {
    p.log.info(`Environment variables baked into the unit:\n${envVarNotes.join("\n")}`);
  }
  if (portNote) p.log.info(portNote);

  // Confirmation gate. `--yes` skips it; otherwise a TTY prompts and a non-TTY
  // (CI, pipe, service runner) prints the plan above and bails with a hint
  // rather than hanging on a confirm nobody can answer.
  const decision = resolveConfirmDecision(autoConfirm, isInteractive());
  if (decision === "abort-noninteractive") {
    p.log.info(
      `Non-interactive environment — not ${alreadyInstalled ? "reinstalling" : "installing"}. ` +
        "Re-run with --yes to confirm and apply the plan above.",
    );
    return;
  }
  if (decision === "prompt") {
    const ok = await p.confirm({ message: alreadyInstalled ? "Reinstall?" : "Proceed?" });
    if (p.isCancel(ok) || !ok) {
      p.log.info("Aborted.");
      return;
    }
  }

  if (alreadyInstalled) {
    // Carry forward any repo the old unit served implicitly via
    // WEBMUX_PROJECT_DIR before we overwrite it — the new template drops that
    // env var, so otherwise the repo would silently vanish from the dashboard.
    const migrated = migrateServedRepoFromUnit(filePath, config.platform);
    if (migrated) {
      p.log.success(`Migrated previously-served project ${detectProjectName(migrated)} (${migrated})`);
    }
    // Tear the old unit down only once we're committed to reinstalling.
    for (const cmd of uninstallCommands(config)) {
      runCommand(cmd);
    }
  }

  mkdirSync(filePath.substring(0, filePath.lastIndexOf("/")), { recursive: true });

  await Bun.write(filePath, content);
  if (Object.keys(config.envVars).length > 0) {
    try {
      chmodSync(filePath, 0o600);
    } catch (err: unknown) {
      p.log.warn(`Wrote ${filePath} but could not chmod 600: ${String(err)}`);
    }
  }
  p.log.success(`Wrote ${filePath}`);

  if (persistPath) {
    createProjectsRegistry().add({
      path: persistPath,
      name: detectProjectName(persistPath),
      addedAt: Date.now(),
    });
    p.log.success(`Registered project ${detectProjectName(persistPath)} (${persistPath})`);
  }

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

webmux runs as a single multi-project service per machine. Install it once;
add more projects from the dashboard or with \`webmux project add\`.

Usage:
  webmux service install     Install, enable, and start the service
  webmux service uninstall   Stop, disable, and remove the service
  webmux service status      Show service status
  webmux service logs        Tail service logs

Options:
  --port N                   Pin the service to a port (default: 5111). On
                             reinstall without --port the existing port is kept.
  --yes, -y                  Skip the confirmation prompt and install. In a
                             non-interactive shell (CI, pipe) install prints the
                             plan and stops unless --yes is passed.
  --env KEY=VALUE            Bake an environment variable into the service
                             unit (repeatable). Reserved keys PORT,
                             WEBMUX_PROJECT_DIR, and PATH are rejected.
  --no-auto-env              Skip auto-detection of webmux-relevant env vars
                             from the current shell (default: detect
                             ${AUTO_PICKUP_ENV_VARS.join(", ")}).
                             Useful in CI / non-interactive installs.

  When any env var is set, the unit file is written with mode 0600 so
  secrets are readable only by the installing user.
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
  let autoPickup = true;
  let autoConfirm = false;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--port" && args[i + 1]) {
      const parsed = parseInt(args[++i]);
      if (Number.isNaN(parsed)) {
        p.log.error("--port requires a numeric value");
        return;
      }
      port = parsed;
      portExplicit = true;
    } else if (args[i] === "--no-auto-env") {
      autoPickup = false;
    } else if (args[i] === "--yes" || args[i] === "-y") {
      autoConfirm = true;
    }
  }

  const cliEnv = parseEnvCliArgs(args.slice(1));
  if (cliEnv.errors.length > 0) {
    for (const err of cliEnv.errors) p.log.error(err);
    return;
  }

  // One multi-project service per machine, under a fixed name. (Older versions
  // installed one service per project as `webmux-<project>`; `webmux project
  // migrate` consolidates those into this single service.)
  const serviceName = "webmux";

  let envVars: Record<string, string> = {};
  let envVarNotes: string[] = [];
  if (action === "install") {
    const existing = isInstalledAt(platform, serviceName)
      ? readEnvVarsFromUnit(
          platform === "linux"
            ? systemdUnitPath(serviceName)
            : launchdPlistPath(serviceName),
          platform,
        )
      : {};
    const resolved = resolveEnvVars({
      cliEnv: cliEnv.envVars,
      processEnv: process.env,
      existing,
      autoPickup,
    });
    envVars = resolved.envVars;
    envVarNotes = resolved.notes;
  }

  const config: ServiceConfig = {
    platform,
    serviceName,
    webmuxPath,
    port,
    envVars,
  };

  switch (action) {
    case "install":
      await install(config, portExplicit, envVarNotes, autoConfirm);
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

function isInstalledAt(platform: Platform, serviceName: string): boolean {
  const path = platform === "linux"
    ? systemdUnitPath(serviceName)
    : launchdPlistPath(serviceName);
  return existsSync(path);
}
