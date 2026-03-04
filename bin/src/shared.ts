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
