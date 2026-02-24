/**
 * Docker container lifecycle for sandbox worktrees.
 *
 * Replaces workmux's `-S` sandbox flag with direct `docker run -p` management.
 * Containers run as root with published ports (no socat needed).
 */

import { $ } from "bun";
import { type SandboxProfileConfig, type ServiceConfig } from "./config";

/** Container naming: wm-{branch}-{timestamp} */
function containerName(branch: string): string {
  return `wm-${branch}-${Date.now()}`;
}

export interface LaunchContainerOpts {
  branch: string;
  wtDir: string;
  mainRepoDir: string;
  sandboxConfig: SandboxProfileConfig;
  services: ServiceConfig[];
  env: Record<string, string>;
}

/** Launch a sandbox container for a worktree. Returns the container name. */
export async function launchContainer(opts: LaunchContainerOpts): Promise<string> {
  const { branch, wtDir, mainRepoDir, sandboxConfig, services, env } = opts;
  const name = containerName(branch);

  const args: string[] = [
    "docker", "run", "-d",
    "--name", name,
    "-w", wtDir,
    "--add-host", "host.docker.internal:host-gateway",
  ];

  // Publish service ports from .env.local
  for (const svc of services) {
    const port = env[svc.portEnv];
    if (port) {
      args.push("-p", `${port}:${port}`);
    }
  }

  // Core env vars
  args.push("-e", "HOME=/root");
  args.push("-e", "TERM=xterm-256color");
  args.push("-e", "IS_SANDBOX=1");

  // Git safe.directory config so git works in mounted worktrees
  args.push("-e", "GIT_CONFIG_COUNT=2");
  args.push("-e", `GIT_CONFIG_KEY_0=safe.directory`);
  args.push("-e", `GIT_CONFIG_VALUE_0=${wtDir}`);
  args.push("-e", `GIT_CONFIG_KEY_1=safe.directory`);
  args.push("-e", `GIT_CONFIG_VALUE_1=${mainRepoDir}`);

  // Pass through env vars from sandboxConfig
  if (sandboxConfig.envPassthrough) {
    for (const key of sandboxConfig.envPassthrough) {
      const val = process.env[key];
      if (val) {
        args.push("-e", `${key}=${val}`);
      }
    }
  }

  // Pass through .env.local vars so they're available inside the container
  for (const [key, val] of Object.entries(env)) {
    args.push("-e", `${key}=${val}`);
  }

  // Core mounts
  args.push("-v", `${wtDir}:${wtDir}`);
  args.push("-v", `${mainRepoDir}/.git:${mainRepoDir}/.git`);
  args.push("-v", `${mainRepoDir}:${mainRepoDir}:ro`);

  // Claude config mounts
  const home = process.env.HOME ?? "/root";
  args.push("-v", `${home}/.claude:/root/.claude`);
  args.push("-v", `${home}/.claude.json:/root/.claude.json`);

  // Extra mounts from config
  if (sandboxConfig.extraMounts) {
    for (const mount of sandboxConfig.extraMounts) {
      const hostPath = mount.hostPath.replace(/^~/, home);
      const guestPath = mount.guestPath ?? hostPath;
      const suffix = mount.writable ? "" : ":ro";
      args.push("-v", `${hostPath}:${guestPath}${suffix}`);
    }
  }

  // Image + command
  args.push(sandboxConfig.image, "sleep", "infinity");

  console.log(`[docker] launching container: ${name}`);
  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(`docker run failed (exit ${exitCode}): ${stderr}`);
  }

  console.log(`[docker] container ${name} ready`);
  return name;
}

/** Find a running container for a branch. Returns container name or null. */
export async function findContainer(branch: string): Promise<string | null> {
  try {
    const result = await $`docker ps --filter name=wm-${branch}- --format {{.Names}}`.text();
    const name = result.trim().split("\n")[0];
    return name || null;
  } catch {
    return null;
  }
}

/** Remove all containers matching a branch. */
export async function removeContainer(branch: string): Promise<void> {
  try {
    const result = await $`docker ps -a --filter name=wm-${branch}- --format {{.Names}}`.text();
    const names = result.trim().split("\n").filter(Boolean);
    for (const name of names) {
      console.log(`[docker] removing container: ${name}`);
      await $`docker rm -f ${name}`.quiet();
    }
  } catch (err) {
    console.error(`[docker] removeContainer failed for ${branch}:`, err);
  }
}
