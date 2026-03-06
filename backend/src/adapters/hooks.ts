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

export class BunLifecycleHookRunner implements LifecycleHookRunner {
  async run(input: RunLifecycleHookInput): Promise<void> {
    const proc = Bun.spawn(["bash", "-lc", input.command], {
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

    if (exitCode !== 0) {
      throw new Error(buildErrorMessage(input.name, exitCode, stdout, stderr));
    }
  }
}
