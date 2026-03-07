import type { AgentKind } from "../domain/config";

function quoteShell(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function buildRuntimeBootstrap(runtimeEnvPath: string): string {
  return `set -a; . ${quoteShell(runtimeEnvPath)}; set +a`;
}

function buildAgentInvocation(input: {
  agent: AgentKind;
  yolo?: boolean;
  systemPrompt?: string;
  prompt?: string;
}): string {
  const promptSuffix = input.prompt ? ` ${quoteShell(input.prompt)}` : "";

  if (input.agent === "codex") {
    const yoloFlag = input.yolo ? " --yolo" : "";
    if (input.systemPrompt) {
      return `codex${yoloFlag} -c ${quoteShell(`developer_instructions=${input.systemPrompt}`)}${promptSuffix}`;
    }
    return `codex${yoloFlag}${promptSuffix}`;
  }

  const yoloFlag = input.yolo ? " --dangerously-skip-permissions" : "";
  if (input.systemPrompt) {
    return `claude${yoloFlag} --append-system-prompt ${quoteShell(input.systemPrompt)}${promptSuffix}`;
  }
  return `claude${yoloFlag}${promptSuffix}`;
}

function buildAgentCommand(input: {
  agent: AgentKind;
  runtimeEnvPath: string;
  yolo?: boolean;
  systemPrompt?: string;
  prompt?: string;
}): string {
  return `${buildRuntimeBootstrap(input.runtimeEnvPath)}; ${buildAgentInvocation(input)}`;
}

function buildDockerExecCommand(
  containerName: string,
  worktreePath: string,
  command: string,
): string {
  return `docker exec -it -w ${quoteShell(worktreePath)} ${quoteShell(containerName)} bash -lc ${quoteShell(command)}`;
}

export function buildManagedShellCommand(
  runtimeEnvPath: string,
  shellPath = Bun.env.SHELL || "/bin/bash",
): string {
  return `bash -lc ${quoteShell(`${buildRuntimeBootstrap(runtimeEnvPath)}; exec ${quoteShell(shellPath)} -i`)}`;
}

export function buildAgentPaneCommand(input: {
  agent: AgentKind;
  runtimeEnvPath: string;
  yolo?: boolean;
  systemPrompt?: string;
  prompt?: string;
}): string {
  return buildAgentCommand(input);
}

export function buildDockerShellCommand(
  containerName: string,
  worktreePath: string,
  runtimeEnvPath: string,
  shellPath = Bun.env.SHELL || "/bin/bash",
): string {
  return buildDockerExecCommand(
    containerName,
    worktreePath,
    `${buildRuntimeBootstrap(runtimeEnvPath)}; exec ${quoteShell(shellPath)} -i`,
  );
}

export function buildDockerAgentPaneCommand(input: {
  agent: AgentKind;
  containerName: string;
  worktreePath: string;
  runtimeEnvPath: string;
  yolo?: boolean;
  systemPrompt?: string;
  prompt?: string;
}): string {
  return buildDockerExecCommand(
    input.containerName,
    input.worktreePath,
    buildAgentCommand(input),
  );
}
