import type { PaneTemplate, PaneKind } from "../domain/config";
import type { TmuxGateway } from "../adapters/tmux";
import { buildProjectSessionName, buildWorktreeWindowName } from "../adapters/tmux";

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
  shellCommand: string;
  panes: PlannedPane[];
  focusPaneIndex: number;
}

function resolvePaneCwd(template: PaneTemplate, ctx: SessionLayoutContext): string {
  return template.cwd === "repo" ? ctx.repoRoot : ctx.worktreePath;
}

function resolvePaneStartupCommand(template: PaneTemplate, commands: PaneCommandSet): string | undefined {
  switch (template.kind) {
    case "agent":
      return commands.agent;
    case "shell":
      return undefined;
    case "command":
      if (!template.command) {
        throw new Error(`Pane "${template.id}" is kind=command but has no command`);
      }
      return template.command;
  }
}

export function planSessionLayout(
  projectRoot: string,
  branch: string,
  templates: PaneTemplate[],
  ctx: SessionLayoutContext,
): SessionLayoutPlan {
  if (templates.length === 0) {
    throw new Error("At least one pane template is required");
  }

  const panes = templates.map((template, index) => {
    const startupCommand = resolvePaneStartupCommand(template, ctx.paneCommands);
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
  tmux.setWindowOption(plan.sessionName, plan.windowName, "automatic-rename", "off");
  tmux.setWindowOption(plan.sessionName, plan.windowName, "allow-rename", "off");

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
