import { describe, expect, it } from "bun:test";
import type { SessionGateway } from "../adapters/session-gateway";
import { ensureSessionLayout, isWorktreeOpen, planSessionLayout } from "../services/session-service";

class FakeSessionGateway implements SessionGateway {
  calls: string[] = [];
  existingWindows = new Set<string>();

  async getPaneId(_target: string): Promise<string> {
    return "%0";
  }

  async createParkedPane(_opts: { sessionName: string; parkingWindow: string; cwd: string; command: string }): Promise<string> {
    return "%99";
  }

  async swapPanes(_source: string, _destination: string): Promise<void> {}

  async killPane(_target: string): Promise<void> {}

  async ensureServer(): Promise<void> {
    this.calls.push("ensureServer");
  }

  async ensureSession(sessionName: string, cwd: string): Promise<void> {
    this.calls.push(`ensureSession:${sessionName}:${cwd}`);
  }

  async hasWindow(sessionName: string, windowName: string): Promise<boolean> {
    this.calls.push(`hasWindow:${sessionName}:${windowName}`);
    return this.existingWindows.has(`${sessionName}:${windowName}`);
  }

  async killWindow(sessionName: string, windowName: string): Promise<void> {
    this.calls.push(`killWindow:${sessionName}:${windowName}`);
  }

  async createWindow(opts: { sessionName: string; windowName: string; cwd: string; command?: string }): Promise<void> {
    this.calls.push(`createWindow:${opts.sessionName}:${opts.windowName}:${opts.cwd}:${opts.command ?? ""}`);
  }

  async splitWindow(opts: {
    target: string;
    split: "right" | "bottom";
    sizePct?: number;
    cwd: string;
    command?: string;
  }): Promise<void> {
    this.calls.push(`splitWindow:${opts.target}:${opts.split}:${opts.sizePct ?? ""}:${opts.cwd}:${opts.command ?? ""}`);
  }

  async runCommand(target: string, command: string): Promise<void> {
    this.calls.push(`runCommand:${target}:${command}`);
  }

  async selectPane(target: string): Promise<void> {
    this.calls.push(`selectPane:${target}`);
  }

  async focusWindow(_sessionName: string, _windowName: string): Promise<void> {}

  async listWindows(): Promise<[]> {
    return [];
  }
}

describe("planSessionLayout", () => {
  it("materializes pane cwd and command with a deterministic session/window name", () => {
    const plan = planSessionLayout(
      "/repo/project",
      "feature/search",
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
});

describe("ensureSessionLayout", () => {
  it("creates a fresh window and realizes all panes in order", async () => {
    const tmux = new FakeSessionGateway();
    const plan = planSessionLayout(
      "/repo/project",
      "feature/search",
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

    await ensureSessionLayout(tmux, plan);

    expect(tmux.calls).toContain("ensureServer");
    expect(
      tmux.calls.some((call) =>
        call.startsWith(`createWindow:${plan.sessionName}:${plan.windowName}:/repo/project/__worktrees/feature-search:shell-cmd`),
      ),
    ).toBe(true);
    expect(
      tmux.calls.some((call) =>
        call.startsWith(`splitWindow:${plan.sessionName}:${plan.windowName}.0:right:25:/repo/project/__worktrees/feature-search:shell-cmd`),
      ),
    ).toBe(true);
    expect(tmux.calls).toContain(`runCommand:${plan.sessionName}:${plan.windowName}.0:agent-start`);
    expect(tmux.calls.at(-1)).toBe(`selectPane:${plan.sessionName}:${plan.windowName}.0`);
  });

  it("replaces an existing window before recreating it", async () => {
    const tmux = new FakeSessionGateway();
    const plan = planSessionLayout(
      "/repo/project",
      "feature/search",
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

    await ensureSessionLayout(tmux, plan);

    expect(tmux.calls).toContain(`killWindow:${plan.sessionName}:${plan.windowName}`);
  });
});

describe("isWorktreeOpen", () => {
  it("checks the expected project session and window names", async () => {
    const tmux = new FakeSessionGateway();
    const open = await isWorktreeOpen(tmux, "/repo/project", "feature/search");

    expect(open).toBe(false);
    expect(tmux.calls.some((call) => call.includes(":wm-feature/search"))).toBe(true);
  });
});
