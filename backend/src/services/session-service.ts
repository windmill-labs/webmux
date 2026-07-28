import { resolve } from "node:path";
import type { PaneTemplate, PaneKind } from "../domain/config";
import type { TmuxGateway } from "../adapters/tmux";
import {
  buildProjectSessionName,
  buildWorktreeWindowName,
  WM_WINDOW_ROLE_OPTION,
  WM_WORKTREE_ID_OPTION,
} from "../adapters/tmux";

export interface PaneCommandSet {
  agent: string;
  shell: string;
}

export interface SessionLayoutContext {
  repoRoot: string;
  worktreePath: string;
  paneCommands: PaneCommandSet;
}

export interface PlannedPane {
  id: string;
  index: number;
  kind: PaneKind;
  cwd: string;
  startupCommand?: string;
  focus: boolean;
  split?: "right" | "bottom";
  sizePct?: number;
}

export interface SessionLayoutPlan {
  sessionName: string;
  windowName: string;
  worktreeId: string;
  shellCommand: string;
  panes: PlannedPane[];
  focusPaneIndex: number;
}

function quoteShell(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function resolvePaneCwd(template: PaneTemplate, ctx: SessionLayoutContext): string {
  return template.cwd === "repo" ? ctx.repoRoot : ctx.worktreePath;
}

function buildCommandPaneStartupCommand(template: PaneTemplate, ctx: SessionLayoutContext): string {
  if (!template.command) {
    throw new Error(`Pane "${template.id}" is kind=command but has no command`);
  }
  if (!template.workingDir) {
    return template.command;
  }

  const workingDir = resolve(resolvePaneCwd(template, ctx), template.workingDir);
  return `cd -- ${quoteShell(workingDir)} && ${template.command}`;
}

function resolvePaneStartupCommand(template: PaneTemplate, ctx: SessionLayoutContext): string | undefined {
  switch (template.kind) {
    case "agent":
      return ctx.paneCommands.agent;
    case "shell":
      return undefined;
    case "command":
      return buildCommandPaneStartupCommand(template, ctx);
  }
}

export function buildTmuxPaneSystemPrompt(templates: PaneTemplate[]): string | undefined {
  const inspectablePanes = templates
    .map((template, index) => ({ template, index }))
    .filter(({ template }) => template.kind !== "agent");
  if (inspectablePanes.length === 0) return undefined;

  const windowTarget = "$(tmux display-message -t \"$TMUX_PANE\" -p '#{session_name}:#{window_name}')";
  return [
    "You are running inside a webmux-managed tmux window. You can inspect other panes without interrupting them:",
    ...inspectablePanes.map(({ template, index }) =>
      `- Pane ${index} (\`${template.id}\`, ${template.kind}): \`tmux capture-pane -t "${windowTarget}.${index}" -p -S -50\``
    ),
  ].join("\n");
}

export function planSessionLayout(
  projectRoot: string,
  branch: string,
  worktreeId: string,
  templates: PaneTemplate[],
  ctx: SessionLayoutContext,
): SessionLayoutPlan {
  if (templates.length === 0) {
    throw new Error("At least one pane template is required");
  }

  const panes = templates.map((template, index) => {
    const startupCommand = resolvePaneStartupCommand(template, ctx);
    return {
      id: template.id,
      index,
      kind: template.kind,
      cwd: resolvePaneCwd(template, ctx),
      ...(startupCommand ? { startupCommand } : {}),
      focus: template.focus === true,
      ...(index > 0
        ? {
            split: template.split ?? "right",
            ...(template.sizePct !== undefined ? { sizePct: template.sizePct } : {}),
          }
        : {}),
    };
  });

  const focusPaneIndex = panes.find((pane) => pane.focus)?.index ?? 0;

  return {
    sessionName: buildProjectSessionName(projectRoot),
    windowName: buildWorktreeWindowName(branch),
    worktreeId,
    shellCommand: ctx.paneCommands.shell,
    panes,
    focusPaneIndex,
  };
}

export function isWorktreeOpen(
  tmux: TmuxGateway,
  projectRoot: string,
  branch: string,
): boolean {
  const sessionName = buildProjectSessionName(projectRoot);
  const windowName = buildWorktreeWindowName(branch);
  return tmux.hasWindow(sessionName, windowName);
}

export function ensureSessionLayout(
  tmux: TmuxGateway,
  plan: SessionLayoutPlan,
): void {
  const rootPane = plan.panes[0];
  tmux.ensureServer();
  tmux.ensureSession(plan.sessionName, rootPane.cwd);

  if (tmux.hasWindow(plan.sessionName, plan.windowName)) {
    tmux.killWindow(plan.sessionName, plan.windowName);
  }

  tmux.createWindow({
    sessionName: plan.sessionName,
    windowName: plan.windowName,
    cwd: rootPane.cwd,
    command: plan.shellCommand,
  });
  tmux.setWindowOption(plan.sessionName, plan.windowName, "pane-base-index", "0");
  tmux.setWindowOption(plan.sessionName, plan.windowName, "automatic-rename", "off");
  tmux.setWindowOption(plan.sessionName, plan.windowName, "allow-rename", "off");
  // Stable identity: the window name tracks the branch and drifts on rename, this does not.
  tmux.setWindowOption(plan.sessionName, plan.windowName, WM_WORKTREE_ID_OPTION, plan.worktreeId);
  tmux.setWindowOption(plan.sessionName, plan.windowName, WM_WINDOW_ROLE_OPTION, "main");

  for (const pane of plan.panes.slice(1)) {
    const target = `${plan.sessionName}:${plan.windowName}.${pane.index - 1}`;
    tmux.splitWindow({
      target,
      split: pane.split ?? "right",
      sizePct: pane.sizePct,
      cwd: pane.cwd,
      command: plan.shellCommand,
    });
  }

  for (const pane of plan.panes) {
    if (!pane.startupCommand) continue;
    tmux.runCommand(`${plan.sessionName}:${plan.windowName}.${pane.index}`, pane.startupCommand);
  }

  tmux.selectPane(`${plan.sessionName}:${plan.windowName}.${plan.focusPaneIndex}`);
}
