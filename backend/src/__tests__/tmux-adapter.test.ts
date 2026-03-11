import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildProjectSessionName,
  buildWorktreeWindowName,
  parseWindowSummaries,
  sanitizeTmuxNameSegment,
} from "../adapters/tmux";

function buildEnv(overrides: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  return {
    ...env,
    ...overrides,
  };
}

function run(args: string[], env?: Record<string, string>): void {
  const result = Bun.spawnSync(args, { env, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    const stderr = new TextDecoder().decode(result.stderr).trim();
    throw new Error(`${args.join(" ")} failed: ${stderr || `exit ${result.exitCode}`}`);
  }
}

function read(args: string[], env?: Record<string, string>): string {
  const result = Bun.spawnSync(args, { env, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    const stderr = new TextDecoder().decode(result.stderr).trim();
    throw new Error(`${args.join(" ")} failed: ${stderr || `exit ${result.exitCode}`}`);
  }

  return new TextDecoder().decode(result.stdout).trim();
}

interface LayoutResult {
  globalPaneBaseIndex: string;
  relatedPaneIndexes: string[];
  unrelatedPaneIndexes: string[];
}

function parseLayoutResult(output: string): LayoutResult {
  const value: unknown = JSON.parse(output);
  if (!value || typeof value !== "object") {
    throw new Error("layout result must be an object");
  }

  const {
    globalPaneBaseIndex,
    relatedPaneIndexes,
    unrelatedPaneIndexes,
  } = value as {
    globalPaneBaseIndex?: unknown;
    relatedPaneIndexes?: unknown;
    unrelatedPaneIndexes?: unknown;
  };

  if (typeof globalPaneBaseIndex !== "string") {
    throw new Error("layout result globalPaneBaseIndex must be a string");
  }
  if (!Array.isArray(relatedPaneIndexes) || !relatedPaneIndexes.every((entry) => typeof entry === "string")) {
    throw new Error("layout result relatedPaneIndexes must be a string array");
  }
  if (!Array.isArray(unrelatedPaneIndexes) || !unrelatedPaneIndexes.every((entry) => typeof entry === "string")) {
    throw new Error("layout result unrelatedPaneIndexes must be a string array");
  }

  return {
    globalPaneBaseIndex,
    relatedPaneIndexes,
    unrelatedPaneIndexes,
  };
}

describe("sanitizeTmuxNameSegment", () => {
  it("normalizes arbitrary path-like input", () => {
    expect(sanitizeTmuxNameSegment("Workmux Web/Desktop")).toBe("workmux-web-desktop");
  });

  it("falls back to x for empty sanitization", () => {
    expect(sanitizeTmuxNameSegment("////")).toBe("x");
  });
});

describe("buildProjectSessionName", () => {
  it("is deterministic for the same repo root", () => {
    const a = buildProjectSessionName("/tmp/my-project");
    const b = buildProjectSessionName("/tmp/my-project");
    expect(a).toBe(b);
  });

  it("changes across different repo roots", () => {
    expect(buildProjectSessionName("/tmp/project-a")).not.toBe(buildProjectSessionName("/tmp/project-b"));
  });
});

describe("buildWorktreeWindowName", () => {
  it("uses the wm- prefix", () => {
    expect(buildWorktreeWindowName("feature/search")).toBe("wm-feature/search");
  });
});

describe("parseWindowSummaries", () => {
  it("parses tmux list-windows output", () => {
    const output = [
      "wm-project-a1b2c3d4\twm-main\t2",
      "wm-project-a1b2c3d4\twm-feature/search\t3",
    ].join("\n");

    expect(parseWindowSummaries(output)).toEqual([
      {
        sessionName: "wm-project-a1b2c3d4",
        windowName: "wm-main",
        paneCount: 2,
      },
      {
        sessionName: "wm-project-a1b2c3d4",
        windowName: "wm-feature/search",
        paneCount: 3,
      },
    ]);
  });
});

describe("ensureSessionLayout", () => {
  it("keeps the tmux global default at 1 while forcing the workmux window to 0-based panes", async () => {
    const testRoot = await mkdtemp(join(tmpdir(), "webmux-tmux-"));
    const homeDir = join(testRoot, "home");
    const projectRoot = join(testRoot, "repo");
    const worktreePath = join(projectRoot, "__worktrees", "feature-search");
    await mkdir(homeDir, { recursive: true });
    await mkdir(worktreePath, { recursive: true });

    await Bun.write(join(homeDir, ".tmux.conf"), "set -g base-index 1\nsetw -g pane-base-index 1\n");
    const env = buildEnv({
      HOME: homeDir,
      TMUX: "",
      TMUX_TMPDIR: testRoot,
    });
    const runnerPath = join(testRoot, "run-layout.ts");
    const tmuxModuleUrl = new URL("../adapters/tmux.ts", import.meta.url).href;
    const sessionServiceModuleUrl = new URL("../services/session-service.ts", import.meta.url).href;

    await Bun.write(
      runnerPath,
      [
        `import { ensureSessionLayout, planSessionLayout } from ${JSON.stringify(sessionServiceModuleUrl)};`,
        `import { buildProjectSessionName, buildWorktreeWindowName, BunTmuxGateway } from ${JSON.stringify(tmuxModuleUrl)};`,
        "",
        "function run(args: string[]): void {",
        '  const result = Bun.spawnSync(args, { stdout: "pipe", stderr: "pipe" });',
        "  if (result.exitCode !== 0) {",
        "    const stderr = new TextDecoder().decode(result.stderr).trim();",
        '    throw new Error(`${args.join(" ")} failed: ${stderr || `exit ${result.exitCode}`}`);',
        "  }",
        "}",
        "",
        "function read(args: string[]): string {",
        '  const result = Bun.spawnSync(args, { stdout: "pipe", stderr: "pipe" });',
        "  if (result.exitCode !== 0) {",
        "    const stderr = new TextDecoder().decode(result.stderr).trim();",
        '    throw new Error(`${args.join(" ")} failed: ${stderr || `exit ${result.exitCode}`}`);',
        "  }",
        '  return new TextDecoder().decode(result.stdout).trim();',
        "}",
        "",
        "const projectRoot = process.argv[2];",
        "const worktreePath = process.argv[3];",
        'if (!projectRoot || !worktreePath) throw new Error("expected projectRoot and worktreePath");',
        "",
        "const gateway = new BunTmuxGateway();",
        "const plan = planSessionLayout(",
        "  projectRoot,",
        '  "feature/search",',
        "  [",
        '    { id: "agent", kind: "agent", focus: true },',
        '    { id: "shell", kind: "shell", split: "right", sizePct: 25 },',
        "  ],",
        "  {",
        "    repoRoot: projectRoot,",
        "    worktreePath,",
        "    paneCommands: {",
        '      agent: "printf agent-started",',
        '      shell: "sh",',
        "    },",
        "  },",
        ");",
        "",
        "ensureSessionLayout(gateway, plan);",
        'run(["tmux", "new-session", "-d", "-s", "unrelated", "-c", projectRoot]);',
        'run(["tmux", "new-window", "-d", "-t", "unrelated", "-n", "plain", "-c", projectRoot]);',
        "",
        "console.log(JSON.stringify({",
        '  globalPaneBaseIndex: read(["tmux", "show-options", "-g", "-w", "-v", "pane-base-index"]),',
        '  relatedPaneIndexes: read(["tmux", "list-panes", "-t", `${buildProjectSessionName(projectRoot)}:${buildWorktreeWindowName("feature/search")}`, "-F", "#{pane_index}"]).split("\\n").filter(Boolean),',
        '  unrelatedPaneIndexes: read(["tmux", "list-panes", "-t", "unrelated:plain", "-F", "#{pane_index}"]).split("\\n").filter(Boolean),',
        "}));",
        "",
      ].join("\n"),
    );

    try {
      const result = parseLayoutResult(read(["bun", runnerPath, projectRoot, worktreePath], env));
      expect(result.globalPaneBaseIndex).toBe("1");
      expect(result.relatedPaneIndexes).toEqual(["0", "1"]);
      expect(result.unrelatedPaneIndexes).toEqual(["1"]);
    } finally {
      try {
        run(["tmux", "kill-server"], env);
      } catch {}
      await rm(testRoot, { recursive: true, force: true });
    }
  });
});
