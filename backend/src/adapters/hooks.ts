import { join } from "node:path";
import { log } from "../lib/log";

export interface RunLifecycleHookInput {
  command: string;
  cwd: string;
  env: Record<string, string>;
  name: "postCreate" | "preRemove";
}

export interface LifecycleHookRunner {
  run(input: RunLifecycleHookInput): Promise<void>;
}

function buildErrorMessage(
  name: RunLifecycleHookInput["name"],
  exitCode: number,
  stdout: string,
  stderr: string,
): string {
  const output = stderr.trim() || stdout.trim();
  if (output) {
    return `${name} hook failed (exit ${exitCode}): ${output}`;
  }
  return `${name} hook failed (exit ${exitCode})`;
}

function hasDirenv(): boolean {
  try {
    return Bun.spawnSync(["direnv", "version"], { stdout: "pipe", stderr: "pipe" }).exitCode === 0;
  } catch {
    return false;
  }
}

export class BunLifecycleHookRunner implements LifecycleHookRunner {
  private direnvAvailable: boolean | null = null;

  private checkDirenv(): boolean {
    if (this.direnvAvailable === null) {
      this.direnvAvailable = hasDirenv();
    }
    return this.direnvAvailable;
  }

  private async buildCommand(cwd: string, command: string): Promise<string[]> {
    if (this.checkDirenv() && await Bun.file(join(cwd, ".envrc")).exists()) {
      Bun.spawnSync(["direnv", "allow"], { cwd, stdout: "pipe", stderr: "pipe" });
      return ["direnv", "exec", cwd, "bash", "-c", command];
    }
    return ["bash", "-c", command];
  }

  async run(input: RunLifecycleHookInput): Promise<void> {
    const cmd = await this.buildCommand(input.cwd, input.command);
    log.debug(`[hook-runner] Spawning: ${cmd.join(" ")} cwd=${input.cwd}`);
    log.debug(`[hook-runner] envKeys=${Object.keys(input.env).length}`);
    const proc = Bun.spawn(cmd, {
      cwd: input.cwd,
      env: {
        ...Bun.env,
        ...input.env,
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    log.debug(`[hook-runner] ${input.name} exitCode=${exitCode}`);
    if (stdout.trim()) log.debug(`[hook-runner] stdout: ${stdout.trim()}`);
    if (stderr.trim()) log.debug(`[hook-runner] stderr: ${stderr.trim()}`);

    if (exitCode !== 0) {
      throw new Error(buildErrorMessage(input.name, exitCode, stdout, stderr));
    }
  }
}
