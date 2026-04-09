import type { AgentKind } from "../domain/config";

export type AgentLaunchMode = "fresh" | "resume";

const DOCKER_PATH_FALLBACK = "/root/.local/bin:/usr/local/bin:/root/.bun/bin:/root/.cargo/bin";

function quoteShell(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function buildRuntimeBootstrap(runtimeEnvPath: string): string {
  return `set -a; . ${quoteShell(runtimeEnvPath)}; set +a`;
}

function buildDockerRuntimeBootstrap(runtimeEnvPath: string): string {
  return `${buildRuntimeBootstrap(runtimeEnvPath)}; export PATH="$PATH:${DOCKER_PATH_FALLBACK}"`;
}

function buildAgentInvocation(input: {
  agent: AgentKind;
  yolo?: boolean;
  systemPrompt?: string;
  prompt?: string;
  launchMode?: AgentLaunchMode;
}): string {
  if (input.agent === "codex") {
    const yoloFlag = input.yolo ? " --yolo" : "";
    if (input.launchMode === "resume") {
      return `codex${yoloFlag} resume --last`;
    }
    // Use -- to prevent prompts starting with dashes from being parsed as flags.
    const promptSuffix = input.prompt ? ` -- ${quoteShell(input.prompt)}` : "";
    if (input.systemPrompt) {
      return `codex${yoloFlag} -c ${quoteShell(`developer_instructions=${input.systemPrompt}`)}${promptSuffix}`;
    }
    return `codex${yoloFlag}${promptSuffix}`;
  }

  const yoloFlag = input.yolo ? " --dangerously-skip-permissions" : "";
  if (input.launchMode === "resume") {
    return `claude${yoloFlag} --continue`;
  }
  // Use -- to prevent prompts starting with dashes from being parsed as flags.
  const promptSuffix = input.prompt ? ` -- ${quoteShell(input.prompt)}` : "";
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
  launchMode?: AgentLaunchMode;
}, bootstrap = buildRuntimeBootstrap): string {
  return `${bootstrap(input.runtimeEnvPath)}; ${buildAgentInvocation(input)}`;
}

function buildDockerExecCommand(
  containerName: string,
  worktreePath: string,
  command: string,
): string {
  return `docker exec -it -w ${quoteShell(worktreePath)} ${quoteShell(containerName)} /bin/sh -c ${quoteShell(command)}`;
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
  launchMode?: AgentLaunchMode;
}): string {
  return buildAgentCommand(input);
}

export function buildDockerShellCommand(
  containerName: string,
  worktreePath: string,
  runtimeEnvPath: string,
  shellPath = "/bin/bash",
): string {
  return buildDockerExecCommand(
    containerName,
    worktreePath,
    `${buildDockerRuntimeBootstrap(runtimeEnvPath)}; if [ -x ${quoteShell(shellPath)} ]; then exec ${quoteShell(shellPath)} -i; elif [ -x /bin/sh ]; then exec /bin/sh -i; else echo 'webmux: no shell found in container' >&2; exit 127; fi`,
  );
}

export function buildDockerAgentPaneCommand(input: {
  agent: AgentKind;
  runtimeEnvPath: string;
  yolo?: boolean;
  systemPrompt?: string;
  prompt?: string;
  launchMode?: AgentLaunchMode;
}): string {
  return buildAgentCommand(input, buildDockerRuntimeBootstrap);
}
