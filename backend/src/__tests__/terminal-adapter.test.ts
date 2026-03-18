import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const isolatedTmuxScriptPath = new URL("../../../scripts/run-with-isolated-tmux.sh", import.meta.url).pathname;

function buildEnv(overrides: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  return {
    ...env,
    ...overrides,
  };
}

function read(args: string[], env?: Record<string, string>): string {
  const result = Bun.spawnSync(args, { env, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    const stderr = new TextDecoder().decode(result.stderr).trim();
    throw new Error(`${args.join(" ")} failed: ${stderr || `exit ${result.exitCode}`}`);
  }

  return new TextDecoder().decode(result.stdout).trim();
}

describe("terminal adapter", () => {
  it("keeps concurrent attaches isolated by attach id", async () => {
    const testRoot = await mkdtemp(join(tmpdir(), "webmux-terminal-"));
    const env = buildEnv({
      TMUX: "",
      TMUX_TMPDIR: testRoot,
    });
    const runnerPath = join(testRoot, "run-terminal.ts");
    const terminalModuleUrl = new URL("../adapters/terminal.ts", import.meta.url).href;

    await Bun.write(
      runnerPath,
      [
        `import { attach, cleanupStaleSessions, detach } from ${JSON.stringify(terminalModuleUrl)};`,
        "",
        "function run(args: string[]): void {",
        '  const result = Bun.spawnSync(args, { stdout: "pipe", stderr: "pipe" });',
        "  if (result.exitCode !== 0) {",
        "    const stderr = new TextDecoder().decode(result.stderr).trim();",
        '    throw new Error(`${args.join(" ")} failed: ${stderr || `exit ${result.exitCode}`}`);',
        "  }",
        "}",
        "",
        "function read(args: string[]): string {",
        '  const result = Bun.spawnSync(args, { stdout: "pipe", stderr: "pipe" });',
        "  if (result.exitCode !== 0) {",
        "    const stderr = new TextDecoder().decode(result.stderr).trim();",
        '    throw new Error(`${args.join(" ")} failed: ${stderr || `exit ${result.exitCode}`}`);',
        "  }",
        '  return new TextDecoder().decode(result.stdout).trim();',
        "}",
        "",
        "function listManagedSessions(): string[] {",
        '  return read(["tmux", "list-sessions", "-F", "#{session_name}"])',
        '    .split("\\n")',
        "    .filter(Boolean)",
        '    .filter((name) => name.startsWith(`wm-dash-${Bun.env.PORT || "5111"}-`));',
        "}",
        "",
        "cleanupStaleSessions();",
        'run(["tmux", "new-session", "-d", "-s", "owner", "-n", "wm-feature/search"]);',
        'await attach("attach-a", { ownerSessionName: "owner", windowName: "wm-feature/search" }, 80, 24);',
        'await attach("attach-b", { ownerSessionName: "owner", windowName: "wm-feature/search" }, 80, 24);',
        "await Bun.sleep(200);",
        "const afterAttach = listManagedSessions();",
        'await detach("attach-a");',
        "await Bun.sleep(100);",
        "const afterFirstDetach = listManagedSessions();",
        'await detach("attach-b");',
        "await Bun.sleep(100);",
        "const afterSecondDetach = listManagedSessions();",
        'run(["tmux", "kill-session", "-t", "owner"]);',
        "console.log(JSON.stringify({ afterAttach, afterFirstDetach, afterSecondDetach }));",
      ].join("\n"),
    );

    try {
      const output = read(["bash", isolatedTmuxScriptPath, "bun", runnerPath], env);
      const jsonLine = output
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.startsWith("{") && line.endsWith("}"));
      if (!jsonLine) {
        throw new Error(`expected terminal runner output, got: ${output}`);
      }
      const result = JSON.parse(jsonLine) as {
        afterAttach: string[];
        afterFirstDetach: string[];
        afterSecondDetach: string[];
      };

      expect(result.afterAttach).toHaveLength(2);
      expect(result.afterFirstDetach).toHaveLength(1);
      expect(result.afterSecondDetach).toHaveLength(0);
    } finally {
      await rm(testRoot, { recursive: true, force: true });
    }
  });
});
