import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

export interface RunResult {
  success: boolean;
  stdout: Buffer;
  stderr: Buffer;
}

export function run(cmd: string, args: string[], opts?: { cwd?: string }): RunResult {
  const result = Bun.spawnSync([cmd, ...args], { stdout: "pipe", stderr: "pipe", ...opts });
  return {
    success: result.success,
    stdout: result.stdout as Buffer,
    stderr: result.stderr as Buffer,
  };
}

export function which(tool: string): boolean {
  return run("which", [tool]).success;
}

export function getGitRoot(): string | null {
  const result = run("git", ["rev-parse", "--show-toplevel"]);
  if (!result.success) return null;
  return result.stdout.toString().trim();
}

/**
 * Thrown by argparse functions to signal usage errors (e.g. missing flag value,
 * unknown option). Caught at the command entry point so the CLI can print the
 * help banner alongside the message.
 */
export class CommandUsageError extends Error {}

export function detectProjectName(gitRoot: string): string {
  const pkgPath = join(gitRoot, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      if (pkg.name) return pkg.name;
    } catch {} // malformed package.json, fall back to dir name
  }
  return basename(gitRoot);
}

/**
 * When the webmux server isn't reachable the bare error message is unhelpful to
 * users. Older Bun threw a `TypeError: fetch failed`; current Bun throws
 * "Unable to connect. Is the computer able to access the url?" (code
 * ConnectionRefused). This returns a friendly "Is the server running?" hint for
 * either case and leaves HTTP/other errors untouched.
 */
export function formatServerError(error: unknown, port: number): string {
  if (error instanceof Error) {
    if (error.message.startsWith("HTTP")) return error.message;
    if (error.message.includes("fetch") || error.message.includes("Unable to connect")) {
      return `Could not connect to webmux server on port ${port}. Is it running?`;
    }
    return error.message;
  }
  return String(error);
}

export async function withServerConnection<T>(port: number, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw new Error(formatServerError(error, port));
  }
}
