import { describe, expect, it } from "bun:test";
import { WM_WINDOW_ROLE_OPTION, WM_WORKTREE_ID_OPTION, type TmuxGateway } from "../adapters/tmux";
import type { ComponentDefinition } from "../domain/components";
import {
  buildTmuxPaneSystemPrompt,
  ensureSessionLayout,
  isWorktreeOpen,
  planSessionLayout,
} from "../services/session-service";

class FakeTmuxGateway implements TmuxGateway {
  calls: string[] = [];
  existingWindows = new Set<string>();

  getPaneId(_target: string): string {
    return "%0";
  }

  createParkedPane(_opts: {
    sessionName: string;
    parkingWindow: string;
    cwd: string;
    command: string;
    worktreeId: string;
  }): string {
    return "%99";
  }

  swapPanes(_source: string, _destination: string): void {}

  killPane(_target: string): void {}

  ensureServer(): void {
    this.calls.push("ensureServer");
  }

  ensureSession(sessionName: string, cwd: string): void {
    this.calls.push(`ensureSession:${sessionName}:${cwd}`);
  }

  hasWindow(sessionName: string, windowName: string): boolean {
    this.calls.push(`hasWindow:${sessionName}:${windowName}`);
    return this.existingWindows.has(`${sessionName}:${windowName}`);
  }

  killWindow(sessionName: string, windowName: string): void {
    this.calls.push(`killWindow:${sessionName}:${windowName}`);
  }

  renameWindow(sessionName: string, windowName: string, newName: string): void {
    this.calls.push(`renameWindow:${sessionName}:${windowName}:${newName}`);
  }

  createWindow(opts: { sessionName: string; windowName: string; cwd: string; command?: string }): void {
    this.calls.push(`createWindow:${opts.sessionName}:${opts.windowName}:${opts.cwd}:${opts.command ?? ""}`);
  }

  splitWindow(opts: {
    target: string;
    split: "right" | "bottom";
    sizePct?: number;
    cwd: string;
    command?: string;
  }): void {
    this.calls.push(`splitWindow:${opts.target}:${opts.split}:${opts.sizePct ?? ""}:${opts.cwd}:${opts.command ?? ""}`);
  }

  setWindowOption(sessionName: string, windowName: string, option: string, value: string): void {
    this.calls.push(`setWindowOption:${sessionName}:${windowName}:${option}:${value}`);
  }

  setPaneOption(target: string, option: string, value: string): void {
    this.calls.push(`setPaneOption:${target}:${option}:${value}`);
  }

  setPaneTitle(target: string, title: string): void {
    this.calls.push(`setPaneTitle:${target}:${title}`);
  }

  selectLayout(target: string, layout: "main-vertical"): void {
    this.calls.push(`selectLayout:${target}:${layout}`);
  }

  runCommand(target: string, command: string): void {
    this.calls.push(`runCommand:${target}:${command}`);
  }

  selectPane(target: string): void {
    this.calls.push(`selectPane:${target}`);
  }

  listWindows() {
    return [];
  }
}

describe("buildTmuxPaneSystemPrompt", () => {
  it("maps configured pane ids to stable tmux indexes and capture commands", () => {
    const prompt = buildTmuxPaneSystemPrompt([
      { id: "agent", kind: "agent", focus: true },
      { id: "backend", kind: "command", command: "bun run dev" },
      { id: "frontend", kind: "shell" },
    ]);

    expect(prompt).toBe([
      "You are running inside a webmux-managed tmux window. You can inspect other panes without interrupting them:",
      "- Pane 1 (`backend`, command): `tmux capture-pane -t \"$(tmux display-message -t \"$TMUX_PANE\" -p '#{session_name}:#{window_name}').1\" -p -S -50`",
      "- Pane 2 (`frontend`, shell): `tmux capture-pane -t \"$(tmux display-message -t \"$TMUX_PANE\" -p '#{session_name}:#{window_name}').2\" -p -S -50`",
    ].join("\n"));
  });

  it("omits tmux context when the profile has no non-agent panes", () => {
    expect(buildTmuxPaneSystemPrompt([
      { id: "agent", kind: "agent", focus: true },
    ])).toBeUndefined();
  });

  it("maps selected components to their expanded pane indexes", () => {
    const components: ComponentDefinition[] = [
      {
        id: "service-alerts",
        label: "Alerts",
        kind: "service",
        workingDir: "services/service-alerts",
        command: "yarn dev",
        environment: {},
        ports: [],
      },
      {
        id: "gateway-web",
        label: "Web gateway",
        kind: "gateway",
        workingDir: "services/gateway-web",
        command: "yarn dev",
        environment: {},
        ports: [],
      },
    ];

    const prompt = buildTmuxPaneSystemPrompt([
      { id: "agent", kind: "agent", focus: true },
      { id: "components", kind: "componentGroup" },
    ], components);

    expect(prompt).toContain("- Pane 1 (`service-alerts`, component):");
    expect(prompt).toContain("- Pane 2 (`gateway-web`, component):");
  });
});

describe("planSessionLayout", () => {
  it("materializes pane cwd and command with a deterministic session/window name", () => {
    const plan = planSessionLayout(
      "/repo/project",
      "feature/search",
      "wt_test",
      [
        { id: "agent", kind: "agent", focus: true },
        { id: "shell", kind: "shell", split: "right", sizePct: 25 },
        {
          id: "dev",
          kind: "command",
          command: "npm run dev",
          split: "bottom",
          cwd: "repo",
          workingDir: "apps/web",
        },
      ],
      {
        repoRoot: "/repo/project",
        worktreePath: "/repo/project/__worktrees/feature-search",
        paneCommands: {
          agent: "webmux-agent --start",
          shell: "webmux-shell --shell",
        },
      },
    );

    expect(plan.windowName).toBe("wm-feature/search");
    expect(plan.shellCommand).toBe("webmux-shell --shell");
    expect(plan.panes).toEqual([
      {
        id: "agent",
        index: 0,
        kind: "agent",
        cwd: "/repo/project/__worktrees/feature-search",
        startupCommand: "webmux-agent --start",
        focus: true,
      },
      {
        id: "shell",
        index: 1,
        kind: "shell",
        cwd: "/repo/project/__worktrees/feature-search",
        focus: false,
        split: "right",
        sizePct: 25,
      },
      {
        id: "dev",
        index: 2,
        kind: "command",
        cwd: "/repo/project",
        startupCommand: "cd -- '/repo/project/apps/web' && npm run dev",
        focus: false,
        split: "bottom",
      },
    ]);
    expect(plan.focusPaneIndex).toBe(0);
  });

  it("keeps absolute command workingDir values intact", () => {
    const plan = planSessionLayout(
      "/repo/project",
      "feature/search",
      "wt_test",
      [
        {
          id: "dev",
          kind: "command",
          command: "bun run dev",
          workingDir: "/repo/shared/frontend",
        },
      ],
      {
        repoRoot: "/repo/project",
        worktreePath: "/repo/project/__worktrees/feature-search",
        paneCommands: {
          agent: "agent",
          shell: "shell",
        },
      },
    );

    expect(plan.panes[0]?.startupCommand).toBe("cd -- '/repo/shared/frontend' && bun run dev");
  });

  it("throws when a command pane has no command", () => {
    expect(() =>
      planSessionLayout(
        "/repo/project",
        "feature/search",
        "wt_test",
        [{ id: "dev", kind: "command" }],
        {
          repoRoot: "/repo/project",
          worktreePath: "/repo/project/__worktrees/feature-search",
          paneCommands: {
            agent: "agent",
            shell: "shell",
          },
        },
      ),
    ).toThrow('Pane "dev" is kind=command but has no command');
  });

  it("keeps only the agent pane when no components are selected", () => {
    const plan = planSessionLayout(
      "/repo/project",
      "feature/search",
      "wt_test",
      [
        { id: "agent", kind: "agent", focus: true },
        { id: "components", kind: "componentGroup", split: "right", layout: "tiled" },
      ],
      {
        repoRoot: "/repo/project",
        worktreePath: "/repo/project/__worktrees/feature-search",
        runtimeEnvPath: "/repo/project/__worktrees/feature-search/.webmux/runtime.env",
        paneCommands: {
          agent: "agent-start",
          shell: "shell-cmd",
        },
        components: [],
      },
    );

    expect(plan.panes.map((pane) => pane.id)).toEqual(["agent"]);
    expect(plan.componentLayout).toBe(false);
  });

  it("expands selected components into direct process panes", () => {
    const component: { definition: ComponentDefinition; ports: Record<string, number> } = {
      definition: {
        id: "service-alerts",
        label: "Alerts",
        kind: "service",
        workingDir: "services/service-alerts",
        command: "yarn dev",
        environment: { NODE_ENV: "development" },
        ports: [{
          name: "http",
          processEnv: "PORT",
          protocol: "http",
          health: { type: "tcp" },
        }],
      },
      ports: { http: 24_000 },
    };
    const plan = planSessionLayout(
      "/repo/project",
      "feature/search",
      "wt_test",
      [
        { id: "agent", kind: "agent", focus: true },
        { id: "components", kind: "componentGroup", split: "right", layout: "tiled" },
      ],
      {
        repoRoot: "/repo/project",
        worktreePath: "/repo/project/__worktrees/feature-search",
        runtimeEnvPath: "/repo/project/__worktrees/feature-search/.webmux/runtime.env",
        paneCommands: {
          agent: "agent-start",
          shell: "shell-cmd",
        },
        components: [component],
      },
    );

    expect(plan.componentLayout).toBe(true);
    expect(plan.panes[1]).toMatchObject({
      id: "service-alerts",
      index: 1,
      kind: "command",
      cwd: "/repo/project/__worktrees/feature-search/services/service-alerts",
      componentId: "service-alerts",
      title: "Alerts",
      split: "right",
    });
    expect(plan.panes[1]?.shellCommand).toContain("WEBMUX_COMPONENT_ID");
    expect(plan.panes[1]?.shellCommand).toContain("24000");
    expect(plan.panes[1]?.startupCommand).toBeUndefined();

    const threeComponentPlan = planSessionLayout(
      "/repo/project",
      "feature/search",
      "wt_test",
      [
        { id: "agent", kind: "agent", focus: true },
        { id: "components", kind: "componentGroup", split: "right", layout: "tiled" },
      ],
      {
        repoRoot: "/repo/project",
        worktreePath: "/repo/project/__worktrees/feature-search",
        runtimeEnvPath: "/repo/project/__worktrees/feature-search/.webmux/runtime.env",
        paneCommands: {
          agent: "agent-start",
          shell: "shell-cmd",
        },
        components: [component, {
          ...component,
          definition: { ...component.definition, id: "service-auth", label: "Auth" },
        }, {
          ...component,
          definition: { ...component.definition, id: "gateway-web", label: "Gateway" },
        }],
      },
    );
    expect(threeComponentPlan.panes.map((pane) => pane.id)).toEqual([
      "agent",
      "service-alerts",
      "service-auth",
      "gateway-web",
    ]);
  });
});

describe("ensureSessionLayout", () => {
  it("creates a fresh window and realizes all panes in order", () => {
    const tmux = new FakeTmuxGateway();
    const plan = planSessionLayout(
      "/repo/project",
      "feature/search",
      "wt_test",
      [
        { id: "agent", kind: "agent", focus: true },
        { id: "shell", kind: "shell", split: "right", sizePct: 25 },
      ],
      {
        repoRoot: "/repo/project",
        worktreePath: "/repo/project/__worktrees/feature-search",
        paneCommands: {
          agent: "agent-start",
          shell: "shell-cmd",
        },
      },
    );

    ensureSessionLayout(tmux, plan);

    expect(tmux.calls).toContain("ensureServer");
    expect(
      tmux.calls.some((call) =>
        call.startsWith(`createWindow:${plan.sessionName}:${plan.windowName}:/repo/project/__worktrees/feature-search:shell-cmd`),
      ),
    ).toBe(true);
    expect(tmux.calls).toContain(`setWindowOption:${plan.sessionName}:${plan.windowName}:pane-base-index:0`);
    // The stable identity anchor: survives a branch rename, unlike the window name.
    expect(tmux.calls).toContain(
      `setWindowOption:${plan.sessionName}:${plan.windowName}:${WM_WORKTREE_ID_OPTION}:wt_test`,
    );
    expect(tmux.calls).toContain(
      `setWindowOption:${plan.sessionName}:${plan.windowName}:${WM_WINDOW_ROLE_OPTION}:main`,
    );
    expect(
      tmux.calls.some((call) =>
        call.startsWith(`splitWindow:${plan.sessionName}:${plan.windowName}.0:right:25:/repo/project/__worktrees/feature-search:shell-cmd`),
      ),
    ).toBe(true);
    expect(tmux.calls).toContain(`runCommand:${plan.sessionName}:${plan.windowName}.0:agent-start`);
    expect(tmux.calls.at(-1)).toBe(`selectPane:${plan.sessionName}:${plan.windowName}.0`);
  });

  it("replaces an existing window before recreating it", () => {
    const tmux = new FakeTmuxGateway();
    const plan = planSessionLayout(
      "/repo/project",
      "feature/search",
      "wt_test",
      [{ id: "agent", kind: "agent", focus: true }],
      {
        repoRoot: "/repo/project",
        worktreePath: "/repo/project/__worktrees/feature-search",
        paneCommands: {
          agent: "agent-start",
          shell: "shell-cmd",
        },
      },
    );
    tmux.existingWindows.add(`${plan.sessionName}:${plan.windowName}`);

    ensureSessionLayout(tmux, plan);

    expect(tmux.calls).toContain(`killWindow:${plan.sessionName}:${plan.windowName}`);
  });

  it("tags component panes and applies the main-vertical layout", () => {
    const tmux = new FakeTmuxGateway();
    const plan = planSessionLayout(
      "/repo/project",
      "feature/search",
      "wt_test",
      [
        { id: "agent", kind: "agent", focus: true },
        { id: "components", kind: "componentGroup", split: "right", layout: "tiled" },
      ],
      {
        repoRoot: "/repo/project",
        worktreePath: "/repo/project/__worktrees/feature-search",
        runtimeEnvPath: "/repo/project/__worktrees/feature-search/.webmux/runtime.env",
        paneCommands: {
          agent: "agent-start",
          shell: "shell-cmd",
        },
        components: [{
          definition: {
            id: "service-alerts",
            label: "Alerts",
            kind: "service",
            workingDir: "services/service-alerts",
            command: "yarn dev",
            environment: {},
            ports: [],
          },
          ports: {},
        }],
      },
    );

    ensureSessionLayout(tmux, plan);

    const componentTarget = `${plan.sessionName}:${plan.windowName}.1`;
    expect(tmux.calls).toContain(`setPaneOption:${componentTarget}:remain-on-exit:on`);
    expect(tmux.calls).toContain(`setPaneOption:${componentTarget}:@wm_component_id:service-alerts`);
    expect(tmux.calls).toContain(`setPaneTitle:${componentTarget}:Alerts`);
    expect(tmux.calls).toContain(
      `setWindowOption:${plan.sessionName}:${plan.windowName}:main-pane-width:50%`,
    );
    expect(tmux.calls).toContain(
      `selectLayout:${plan.sessionName}:${plan.windowName}.0:main-vertical`,
    );
  });
});

describe("isWorktreeOpen", () => {
  it("checks the expected project session and window names", () => {
    const tmux = new FakeTmuxGateway();
    const open = isWorktreeOpen(tmux, "/repo/project", "feature/search");

    expect(open).toBe(false);
    expect(tmux.calls.some((call) => call.includes(":wm-feature/search"))).toBe(true);
  });
});
