import { afterEach, describe, expect, it } from "bun:test";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BunTmuxGateway,
  buildProjectSessionName,
  buildWorktreeWindowName,
  parseWindowSummaries,
  sanitizeTmuxNameSegment,
} from "../adapters/tmux";

function run(args: string[]): void {
  const result = Bun.spawnSync(args, { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    const stderr = new TextDecoder().decode(result.stderr).trim();
    throw new Error(`${args.join(" ")} failed: ${stderr || `exit ${result.exitCode}`}`);
  }
}

function read(args: string[]): string {
  const result = Bun.spawnSync(args, { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    const stderr = new TextDecoder().decode(result.stderr).trim();
    throw new Error(`${args.join(" ")} failed: ${stderr || `exit ${result.exitCode}`}`);
  }

  return new TextDecoder().decode(result.stdout).trim();
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

describe("BunTmuxGateway", () => {
  let testRoot = "";
  let originalPath: string | null = null;

  afterEach(async () => {
    if (testRoot) {
      try {
        run(["tmux", "kill-server"]);
      } catch {}

      await rm(testRoot, { recursive: true, force: true });
      testRoot = "";
    }

    if (originalPath !== null) {
      process.env.PATH = originalPath;
      originalPath = null;
    }
  });

  it("forces 0-based pane indices for new windows when the user config starts at 1", async () => {
    testRoot = await mkdtemp(join(tmpdir(), "webmux-tmux-"));

    const homeDir = join(testRoot, "home");
    const binDir = join(testRoot, "bin");
    await mkdir(homeDir, { recursive: true });
    await mkdir(binDir, { recursive: true });

    await Bun.write(join(homeDir, ".tmux.conf"), "set -g base-index 1\nsetw -g pane-base-index 1\n");

    const realTmux = read(["which", "tmux"]);
    const wrapperPath = join(binDir, "tmux");
    await Bun.write(
      wrapperPath,
      [
        "#!/bin/sh",
        "unset TMUX",
        `export HOME="${homeDir}"`,
        `export TMUX_TMPDIR="${testRoot}"`,
        `exec "${realTmux}" "$@"`,
        "",
      ].join("\n"),
    );
    await chmod(wrapperPath, 0o755);

    originalPath = process.env.PATH ?? "";
    process.env.PATH = `${binDir}:${originalPath}`;

    const gateway = new BunTmuxGateway();
    const sessionName = "wm-test-pane-index";
    const windowName = "wm-window";

    gateway.ensureServer();
    gateway.ensureSession(sessionName, testRoot);
    gateway.createWindow({
      sessionName,
      windowName,
      cwd: testRoot,
    });

    expect(read(["tmux", "show-options", "-g", "-w", "-v", "pane-base-index"])).toBe("1");
    expect(read(["tmux", "list-panes", "-t", `${sessionName}:${windowName}`, "-F", "#{pane_index}"])).toBe("0");
  });
});
