import type { AgentDefinition } from "./agent-registry";

export type AgentLaunchMode = "fresh" | "resume" | "fork";

const DOCKER_PATH_FALLBACK = "/root/.local/bin:/usr/local/bin:/root/.bun/bin:/root/.cargo/bin";

const CUSTOM_AGENT_TEMPLATE_VARS = {
  PROMPT: "WEBMUX_AGENT_PROMPT",
  SYSTEM_PROMPT: "WEBMUX_AGENT_SYSTEM_PROMPT",
  WORKTREE_PATH: "WEBMUX_AGENT_WORKTREE_PATH",
  REPO_PATH: "WEBMUX_AGENT_REPO_PATH",
  BRANCH: "WEBMUX_AGENT_BRANCH",
  PROFILE: "WEBMUX_AGENT_PROFILE",
} as const;

function quoteShell(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function buildRuntimeBootstrap(runtimeEnvPath: string): string {
  return `set -a; . ${quoteShell(runtimeEnvPath)}; set +a`;
}

function buildDockerRuntimeBootstrap(runtimeEnvPath: string): string {
  return `${buildRuntimeBootstrap(runtimeEnvPath)}; export PATH="$PATH:${DOCKER_PATH_FALLBACK}"`;
}

function buildBuiltInAgentInvocation(input: {
  agent: "claude" | "codex";
  yolo?: boolean;
  systemPrompt?: string;
  prompt?: string;
  launchMode?: AgentLaunchMode;
  resumeConversationId?: string;
  /** Session to fork from (launchMode "fork"): claude `--fork-session`, codex `fork`. */
  forkFromSessionId?: string;
  /** Claude-only: pin the forked child to a session id we generated, so we know it without disk discovery. */
  pinSessionId?: string;
}): string {
  const promptSuffix = input.prompt ? ` -- ${quoteShell(input.prompt)}` : "";

  if (input.agent === "codex") {
    const hooksFlag = " --enable hooks";
    const yoloFlag = input.yolo ? " --yolo" : "";
    if (input.launchMode === "fork" && input.forkFromSessionId) {
      // `codex fork <id>` branches the session into a fresh one with inherited history.
      return `codex${hooksFlag}${yoloFlag} fork ${quoteShell(input.forkFromSessionId)}${promptSuffix}`;
    }
    if (input.launchMode === "resume") {
      // `codex resume --last` takes the prompt after `--`, so a follow-up is
      // processed before the TUI starts — no paste/Enter race.
      const resumeTarget = input.resumeConversationId ? ` ${quoteShell(input.resumeConversationId)}` : " --last";
      return `codex${hooksFlag}${yoloFlag} resume${resumeTarget}${promptSuffix}`;
    }
    if (input.systemPrompt) {
      return `codex${hooksFlag}${yoloFlag} -c ${quoteShell(`developer_instructions=${input.systemPrompt}`)}${promptSuffix}`;
    }
    return `codex${hooksFlag}${yoloFlag}${promptSuffix}`;
  }

  const yoloFlag = input.yolo ? " --dangerously-skip-permissions" : "";
  if (input.launchMode === "fork" && input.forkFromSessionId) {
    // Fork the parent into a NEW session, pinning the child id when provided so
    // the tab service can track it deterministically.
    const pin = input.pinSessionId ? ` --session-id ${quoteShell(input.pinSessionId)}` : "";
    return `claude${yoloFlag} --resume ${quoteShell(input.forkFromSessionId)} --fork-session${pin}${promptSuffix}`;
  }
  if (input.launchMode === "resume") {
    // `--resume <id>` restores a specific session (e.g. a fork on reopen); `--continue`
    // resumes the most recent. Either way the prompt is submitted as the first new turn,
    // avoiding the tmux paste/Enter race that hits Claude's TUI before its input loop is ready.
    const resumeTarget = input.resumeConversationId
      ? ` --resume ${quoteShell(input.resumeConversationId)}`
      : " --continue";
    return `claude${yoloFlag}${resumeTarget}${promptSuffix}`;
  }
  if (input.systemPrompt) {
    return `claude${yoloFlag} --append-system-prompt ${quoteShell(input.systemPrompt)}${promptSuffix}`;
  }
  return `claude${yoloFlag}${promptSuffix}`;
}

function renderCustomCommandTemplate(template: string): string {
  return template
    .replaceAll("${PROMPT}", `$${CUSTOM_AGENT_TEMPLATE_VARS.PROMPT}`)
    .replaceAll("${SYSTEM_PROMPT}", `$${CUSTOM_AGENT_TEMPLATE_VARS.SYSTEM_PROMPT}`)
    .replaceAll("${WORKTREE_PATH}", `$${CUSTOM_AGENT_TEMPLATE_VARS.WORKTREE_PATH}`)
    .replaceAll("${REPO_PATH}", `$${CUSTOM_AGENT_TEMPLATE_VARS.REPO_PATH}`)
    .replaceAll("${BRANCH}", `$${CUSTOM_AGENT_TEMPLATE_VARS.BRANCH}`)
    .replaceAll("${PROFILE}", `$${CUSTOM_AGENT_TEMPLATE_VARS.PROFILE}`);
}

function buildCustomAgentExports(input: {
  prompt?: string;
  systemPrompt?: string;
  worktreePath: string;
  repoRoot: string;
  branch: string;
  profileName: string;
}): string {
  const envEntries: Array<[string, string]> = [
    [CUSTOM_AGENT_TEMPLATE_VARS.PROMPT, input.prompt ?? ""],
    [CUSTOM_AGENT_TEMPLATE_VARS.SYSTEM_PROMPT, input.systemPrompt ?? ""],
    [CUSTOM_AGENT_TEMPLATE_VARS.WORKTREE_PATH, input.worktreePath],
    [CUSTOM_AGENT_TEMPLATE_VARS.REPO_PATH, input.repoRoot],
    [CUSTOM_AGENT_TEMPLATE_VARS.BRANCH, input.branch],
    [CUSTOM_AGENT_TEMPLATE_VARS.PROFILE, input.profileName],
  ];

  return envEntries
    .map(([key, value]) => `export ${key}=${quoteShell(value)}`)
    .join("; ");
}

function buildCustomAgentInvocation(input: {
  agent: Extract<AgentDefinition, { kind: "custom" }>;
  systemPrompt?: string;
  prompt?: string;
  worktreePath: string;
  repoRoot: string;
  branch: string;
  profileName: string;
  launchMode?: AgentLaunchMode;
}): string {
  const template = input.launchMode === "resume" && input.agent.implementation.config.resumeCommand
    ? input.agent.implementation.config.resumeCommand
    : input.agent.implementation.config.startCommand;
  const exports = buildCustomAgentExports(input);
  const renderedCommand = renderCustomCommandTemplate(template);
  return `${exports}; ${renderedCommand}`;
}

function buildAgentInvocation(input: {
  agent: AgentDefinition;
  yolo?: boolean;
  systemPrompt?: string;
  prompt?: string;
  launchMode?: AgentLaunchMode;
  worktreePath: string;
  repoRoot: string;
  branch: string;
  profileName: string;
  resumeConversationId?: string;
  forkFromSessionId?: string;
  pinSessionId?: string;
}): string {
  if (input.agent.kind === "builtin") {
    return buildBuiltInAgentInvocation({
      agent: input.agent.implementation.agent,
      yolo: input.yolo,
      systemPrompt: input.systemPrompt,
      prompt: input.prompt,
      launchMode: input.launchMode,
      resumeConversationId: input.resumeConversationId,
      forkFromSessionId: input.forkFromSessionId,
      pinSessionId: input.pinSessionId,
    });
  }

  return buildCustomAgentInvocation({
    agent: input.agent,
    systemPrompt: input.systemPrompt,
    prompt: input.prompt,
    worktreePath: input.worktreePath,
    repoRoot: input.repoRoot,
    branch: input.branch,
    profileName: input.profileName,
    launchMode: input.launchMode,
  });
}

function buildAgentCommand(input: {
  agent: AgentDefinition;
  runtimeEnvPath: string;
  repoRoot: string;
  worktreePath: string;
  branch: string;
  profileName: string;
  yolo?: boolean;
  systemPrompt?: string;
  prompt?: string;
  launchMode?: AgentLaunchMode;
  resumeConversationId?: string;
  forkFromSessionId?: string;
  pinSessionId?: string;
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
  agent: AgentDefinition;
  runtimeEnvPath: string;
  repoRoot: string;
  worktreePath: string;
  branch: string;
  profileName: string;
  yolo?: boolean;
  systemPrompt?: string;
  prompt?: string;
  launchMode?: AgentLaunchMode;
  resumeConversationId?: string;
  forkFromSessionId?: string;
  pinSessionId?: string;
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
  agent: AgentDefinition;
  runtimeEnvPath: string;
  repoRoot: string;
  worktreePath: string;
  branch: string;
  profileName: string;
  yolo?: boolean;
  systemPrompt?: string;
  prompt?: string;
  launchMode?: AgentLaunchMode;
  resumeConversationId?: string;
  forkFromSessionId?: string;
  pinSessionId?: string;
}): string {
  return buildAgentCommand(input, buildDockerRuntimeBootstrap);
}
