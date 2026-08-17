import { resolve } from "node:path";
import type { PaneTemplate, PaneKind } from "../domain/config";
import type { SessionGateway } from "../adapters/session-gateway";
import { buildPaneTarget, buildProjectSessionName, buildWorktreeWindowName } from "../adapters/session-gateway";

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
    shellCommand: ctx.paneCommands.shell,
    panes,
    focusPaneIndex,
  };
}

export async function isWorktreeOpen(
  sessions: SessionGateway,
  projectRoot: string,
  branch: string,
): Promise<boolean> {
  const sessionName = buildProjectSessionName(projectRoot);
  const windowName = buildWorktreeWindowName(branch);
  return await sessions.hasWindow(sessionName, windowName);
}

export async function ensureSessionLayout(
  sessions: SessionGateway,
  plan: SessionLayoutPlan,
): Promise<void> {
  const rootPane = plan.panes[0];
  await sessions.ensureServer();
  await sessions.ensureSession(plan.sessionName, rootPane.cwd);

  if (await sessions.hasWindow(plan.sessionName, plan.windowName)) {
    await sessions.killWindow(plan.sessionName, plan.windowName);
  }

  await sessions.createWindow({
    sessionName: plan.sessionName,
    windowName: plan.windowName,
    cwd: rootPane.cwd,
    command: plan.shellCommand,
  });

  for (const pane of plan.panes.slice(1)) {
    await sessions.splitWindow({
      target: buildPaneTarget(plan.sessionName, plan.windowName, pane.index - 1),
      split: pane.split ?? "right",
      sizePct: pane.sizePct,
      cwd: pane.cwd,
      command: plan.shellCommand,
    });
  }

  for (const pane of plan.panes) {
    if (!pane.startupCommand) continue;
    await sessions.runCommand(buildPaneTarget(plan.sessionName, plan.windowName, pane.index), pane.startupCommand);
  }

  await sessions.selectPane(buildPaneTarget(plan.sessionName, plan.windowName, plan.focusPaneIndex));
}
