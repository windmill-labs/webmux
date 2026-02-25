/**
 * Docker container lifecycle for sandbox worktrees.
 *
 * Replaces workmux's `-S` sandbox flag with direct `docker run -p` management.
 * Containers run as root with published ports (no socat needed).
 */

import { stat } from "node:fs/promises";
import { type SandboxProfileConfig, type ServiceConfig } from "./config";

const DOCKER_RUN_TIMEOUT_MS = 60_000;

/** Check if a path (file or directory) exists on the host. */
async function pathExists(p: string): Promise<boolean> {
  try { await stat(p); return true; } catch { return false; }
}

/**
 * Sanitise a branch name into a Docker-safe segment.
 * Docker container names must match [a-zA-Z0-9][a-zA-Z0-9_.\-]*.
 * The "wm-" prefix (3) and "-<13-digit-ts>" suffix (14) consume 17 chars,
 * leaving 46 for the branch segment (total ≤ 63).
 */
function sanitiseBranchForName(branch: string): string {
  const s = branch
    .replace(/[^a-zA-Z0-9_.-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[^a-zA-Z0-9]+/, "")
    .slice(0, 46);
  return s || "x";
}

/** Container naming: wm-{sanitised-branch}-{timestamp} */
function containerName(branch: string): string {
  return `wm-${sanitiseBranchForName(branch)}-${Date.now()}`;
}

/** Return true if s is a valid port number string (integer 1–65535). */
function isValidPort(s: string): boolean {
  const n = Number(s);
  return Number.isInteger(n) && n >= 1 && n <= 65535;
}

/** Return true if s is a valid environment variable key. */
function isValidEnvKey(s: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(s);
}

export interface LaunchContainerOpts {
  branch: string;
  wtDir: string;
  mainRepoDir: string;
  sandboxConfig: SandboxProfileConfig;
  services: ServiceConfig[];
  env: Record<string, string>;
}

/**
 * Launch a sandbox container for a worktree. Returns the container name.
 * If a container for this branch is already running, returns its name without launching a second one.
 */
export async function launchContainer(opts: LaunchContainerOpts): Promise<string> {
  const { branch, wtDir, mainRepoDir, sandboxConfig, services, env } = opts;

  // Idempotency: reuse an already-running container for this branch.
  const existing = await findContainer(branch);
  if (existing) {
    console.log(`[docker] reusing existing container ${existing} for branch ${branch}`);
    return existing;
  }

  if (!sandboxConfig.image) {
    throw new Error("sandboxConfig.image is required but was empty");
  }

  const name = containerName(branch);

  const args: string[] = [
    "docker", "run", "-d",
    "--name", name,
    "-w", wtDir,
    "--add-host", "host.docker.internal:host-gateway",
  ];

  // Publish service ports bound to loopback only to avoid exposing dev services
  // on external interfaces. Skip invalid or duplicate port values.
  const seenPorts = new Set<string>();
  for (const svc of services) {
    const port = env[svc.portEnv];
    if (!port) continue;
    if (!isValidPort(port)) {
      console.warn(`[docker] skipping invalid port for ${svc.portEnv}: ${JSON.stringify(port)}`);
      continue;
    }
    if (seenPorts.has(port)) continue;
    seenPorts.add(port);
    args.push("-p", `127.0.0.1:${port}:${port}`);
  }

  // Core env vars — defined first so .env.local passthrough cannot override them.
  const reservedKeys = new Set([
    "HOME", "TERM", "IS_SANDBOX",
    "GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0",
    "GIT_CONFIG_KEY_1", "GIT_CONFIG_VALUE_1",
  ]);
  args.push("-e", "HOME=/root");
  args.push("-e", "TERM=xterm-256color");
  args.push("-e", "IS_SANDBOX=1");

  // Git safe.directory config so git works in mounted worktrees.
  args.push("-e", "GIT_CONFIG_COUNT=2");
  args.push("-e", `GIT_CONFIG_KEY_0=safe.directory`);
  args.push("-e", `GIT_CONFIG_VALUE_0=${wtDir}`);
  args.push("-e", `GIT_CONFIG_KEY_1=safe.directory`);
  args.push("-e", `GIT_CONFIG_VALUE_1=${mainRepoDir}`);

  // Pass through host env vars listed in sandboxConfig.
  if (sandboxConfig.envPassthrough) {
    for (const key of sandboxConfig.envPassthrough) {
      if (!isValidEnvKey(key)) {
        console.warn(`[docker] skipping invalid envPassthrough key: ${JSON.stringify(key)}`);
        continue;
      }
      const val = Bun.env[key];
      if (val !== undefined) {
        args.push("-e", `${key}=${val}`);
      }
    }
  }

  // Pass through .env.local vars; skip reserved keys and invalid key names.
  for (const [key, val] of Object.entries(env)) {
    if (!isValidEnvKey(key)) {
      console.warn(`[docker] skipping invalid .env.local key: ${JSON.stringify(key)}`);
      continue;
    }
    if (reservedKeys.has(key)) continue;
    args.push("-e", `${key}=${val}`);
  }

  // Core mounts.
  args.push("-v", `${wtDir}:${wtDir}`);
  args.push("-v", `${mainRepoDir}/.git:${mainRepoDir}/.git`);
  args.push("-v", `${mainRepoDir}:${mainRepoDir}:ro`);

  const home = Bun.env.HOME ?? "/root";

  // Claude config mounts.
  args.push("-v", `${home}/.claude:/root/.claude`);
  args.push("-v", `${home}/.claude.json:/root/.claude.json`);

  // Git/GitHub credential mounts (read-only, only if they exist on host).
  const credentialMounts = [
    { hostPath: `${home}/.gitconfig`, guestPath: "/root/.gitconfig" },
    { hostPath: `${home}/.ssh`, guestPath: "/root/.ssh" },
    { hostPath: `${home}/.config/gh`, guestPath: "/root/.config/gh" },
  ];
  for (const { hostPath, guestPath } of credentialMounts) {
    if (await pathExists(hostPath)) {
      args.push("-v", `${hostPath}:${guestPath}:ro`);
    }
  }

  // Extra mounts from config; require absolute host paths after ~ expansion.
  if (sandboxConfig.extraMounts) {
    for (const mount of sandboxConfig.extraMounts) {
      const hostPath = mount.hostPath.replace(/^~/, home);
      if (!hostPath.startsWith("/")) {
        console.warn(`[docker] skipping extra mount with non-absolute host path: ${JSON.stringify(hostPath)}`);
        continue;
      }
      const guestPath = mount.guestPath ?? hostPath;
      const suffix = mount.writable ? "" : ":ro";
      args.push("-v", `${hostPath}:${guestPath}${suffix}`);
    }
  }

  // Image + command.
  args.push(sandboxConfig.image, "sleep", "infinity");

  console.log(`[docker] launching container: ${name}`);
  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });

  // Race process exit against a hard timeout so a hung daemon or slow image
  // pull does not block the server indefinitely.
  const timeout = Bun.sleep(DOCKER_RUN_TIMEOUT_MS).then(() => {
    proc.kill();
    return "timeout" as const;
  });

  const [exitResult, stderr, containerId] = await Promise.all([
    Promise.race([proc.exited, timeout]),
    new Response(proc.stderr).text(),
    new Response(proc.stdout).text(),
  ]);

  if (exitResult === "timeout") {
    Bun.spawn(["docker", "rm", "-f", name], { stdout: "ignore", stderr: "ignore" });
    throw new Error(`docker run timed out after ${DOCKER_RUN_TIMEOUT_MS / 1000}s`);
  }

  if (exitResult !== 0) {
    // Clean up any stopped container docker may have left behind.
    Bun.spawn(["docker", "rm", "-f", name], { stdout: "ignore", stderr: "ignore" });
    throw new Error(`docker run failed (exit ${exitResult}): ${stderr}`);
  }

  console.log(`[docker] container ${name} ready (id=${containerId.trim().slice(0, 12)})`);
  return name;
}

/**
 * Find the most-recently-started running container for a branch.
 * Returns the container name, or null if none is running.
 * Throws if the Docker daemon cannot be reached.
 */
export async function findContainer(branch: string): Promise<string | null> {
  const sanitised = sanitiseBranchForName(branch);
  const prefix = `wm-${sanitised}-`;
  const proc = Bun.spawn(
    ["docker", "ps", "--filter", `name=${prefix}`, "--format", "{{.Names}}"],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  if (exitCode !== 0) {
    throw new Error(`docker ps failed (exit ${exitCode}): ${stderr}`);
  }

  // Filter to exact prefix matches: the part after the prefix must be only
  // the numeric timestamp. This prevents "main" from matching "main-v2" containers.
  const names = stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .filter(n => n.startsWith(prefix) && /^\d+$/.test(n.slice(prefix.length)));

  // docker ps lists containers oldest-first; return the last (most recently started).
  return names.at(-1) ?? null;
}

/**
 * Remove all containers (running or stopped) for a branch.
 * Individual removal errors are logged but do not abort remaining removals.
 */
export async function removeContainer(branch: string): Promise<void> {
  const sanitised = sanitiseBranchForName(branch);
  const prefix = `wm-${sanitised}-`;
  const listProc = Bun.spawn(
    ["docker", "ps", "-a", "--filter", `name=${prefix}`, "--format", "{{.Names}}"],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [listExit, listOut, listErr] = await Promise.all([
    listProc.exited,
    new Response(listProc.stdout).text(),
    new Response(listProc.stderr).text(),
  ]);

  if (listExit !== 0) {
    console.error(`[docker] removeContainer: docker ps failed for ${branch}: ${listErr}`);
    return;
  }

  const names = listOut
    .trim()
    .split("\n")
    .filter(Boolean)
    .filter(n => n.startsWith(prefix) && /^\d+$/.test(n.slice(prefix.length)));

  await Promise.all(
    names.map(async (cname) => {
      console.log(`[docker] removing container: ${cname}`);
      const rmProc = Bun.spawn(["docker", "rm", "-f", cname], { stdout: "ignore", stderr: "pipe" });
      const [rmExit, rmErr] = await Promise.all([
        rmProc.exited,
        new Response(rmProc.stderr).text(),
      ]);
      if (rmExit !== 0) {
        console.error(`[docker] failed to remove container ${cname}: ${rmErr}`);
      }
    }),
  );
}
