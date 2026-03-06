import type { AgentKind, RuntimeKind } from "../domain/config";

function quoteShell(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function buildRuntimeBootstrap(runtimeEnvPath: string): string {
  return `set -a; . ${quoteShell(runtimeEnvPath)}; set +a`;
}

function buildAgentInvocation(input: {
  agent: AgentKind;
  runtime: RuntimeKind;
  systemPrompt?: string;
  prompt?: string;
}): string {
  const promptSuffix = input.prompt ? ` ${quoteShell(input.prompt)}` : "";

  if (input.agent === "codex") {
    if (input.systemPrompt) {
      return `codex --yolo -c ${quoteShell(`developer_instructions=${input.systemPrompt}`)}${promptSuffix}`;
    }
    return `codex --yolo${promptSuffix}`;
  }

  const runtimeFlag = input.runtime === "docker" ? " --dangerously-skip-permissions" : "";
  if (input.systemPrompt) {
    return `claude${runtimeFlag} --append-system-prompt ${quoteShell(input.systemPrompt)}${promptSuffix}`;
  }
  return `claude${runtimeFlag}${promptSuffix}`;
}

function buildAgentLifecycleBody(input: {
  agent: AgentKind;
  runtimeEnvPath: string;
  agentCtlPath: string;
  runtime: RuntimeKind;
  systemPrompt?: string;
  prompt?: string;
}): string {
  const steps = [
    buildRuntimeBootstrap(input.runtimeEnvPath),
    ...(input.prompt
      ? [`${quoteShell(input.agentCtlPath)} title-changed --title ${quoteShell(input.prompt)}`]
      : []),
    `${quoteShell(input.agentCtlPath)} agent-started`,
    buildAgentInvocation(input),
    "status=$?",
    `if [ "$status" -ne 0 ]; then ${quoteShell(input.agentCtlPath)} runtime-error --message "${input.agent} exited with status $status"; fi`,
    ...(input.agent === "codex" ? [`if [ "$status" -eq 0 ]; then ${quoteShell(input.agentCtlPath)} agent-stopped; fi`] : []),
    'exit "$status"',
  ];

  return steps.join("; ");
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
  agentCtlPath: string;
  runtime: RuntimeKind;
  systemPrompt?: string;
  prompt?: string;
}): string {
  return `bash -lc ${quoteShell(buildAgentLifecycleBody(input))}`;
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
  agentCtlPath: string;
  runtime: RuntimeKind;
  systemPrompt?: string;
  prompt?: string;
}): string {
  return buildDockerExecCommand(
    input.containerName,
    input.worktreePath,
    buildAgentLifecycleBody(input),
  );
}
