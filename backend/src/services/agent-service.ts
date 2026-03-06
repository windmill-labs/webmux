import type { AgentKind } from "../domain/config";

function quoteShell(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function buildManagedShellCommand(
  runtimeEnvPath: string,
  shellPath = Bun.env.SHELL || "/bin/bash",
): string {
  return `bash -lc '. ${quoteShell(runtimeEnvPath)}; exec ${quoteShell(shellPath)} -i'`;
}

export function buildManagedCommand(
  runtimeEnvPath: string,
  command: string,
): string {
  return `bash -lc '. ${quoteShell(runtimeEnvPath)}; exec ${command}'`;
}

export function buildAgentPaneCommand(
  agent: AgentKind,
  runtimeEnvPath: string,
  prompt?: string,
): string {
  const base = agent === "codex" ? "codex --yolo" : "claude";
  const suffix = prompt ? ` ${quoteShell(prompt)}` : "";
  return `bash -lc '. ${quoteShell(runtimeEnvPath)}; exec ${base}${suffix}'`;
}
