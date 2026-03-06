import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitGateway } from "../adapters/git";
import type { TmuxGateway } from "../adapters/tmux";
import {
  buildRuntimeEnvMap,
  getWorktreeStoragePaths,
  readWorktreeMeta,
  renderEnvFile,
} from "../adapters/fs";
import type { WorktreeMeta } from "../domain/model";
import { createManagedWorktree, initializeManagedWorktree } from "../services/worktree-service";

class FakeGitGateway implements GitGateway {
  constructor(
    private readonly gitDir: string,
    private readonly calls: string[],
  ) {}

  resolveWorktreeRoot(cwd: string): string {
    this.calls.push(`resolveWorktreeRoot:${cwd}`);
    return cwd;
  }

  resolveWorktreeGitDir(cwd: string): string {
    this.calls.push(`resolveWorktreeGitDir:${cwd}`);
    return this.gitDir;
  }

  listWorktrees() {
    return [];
  }

  createWorktree(opts: { repoRoot: string; worktreePath: string; branch: string; baseBranch?: string }): void {
    this.calls.push(`createWorktree:${opts.repoRoot}:${opts.worktreePath}:${opts.branch}:${opts.baseBranch ?? ""}`);
  }

  removeWorktree(): void {
    this.calls.push("removeWorktree");
  }

  deleteBranch(): void {
    this.calls.push("deleteBranch");
  }

  mergeBranch(): void {
    this.calls.push("mergeBranch");
  }

  currentBranch(): string {
    return "main";
  }
}

class FakeTmuxGateway implements TmuxGateway {
  constructor(private readonly calls: string[]) {}

  ensureServer(): void {
    this.calls.push("ensureServer");
  }

  ensureSession(sessionName: string, cwd: string): void {
    this.calls.push(`ensureSession:${sessionName}:${cwd}`);
  }

  hasWindow(sessionName: string, windowName: string): boolean {
    this.calls.push(`hasWindow:${sessionName}:${windowName}`);
    return false;
  }

  killWindow(sessionName: string, windowName: string): void {
    this.calls.push(`killWindow:${sessionName}:${windowName}`);
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

  selectPane(target: string): void {
    this.calls.push(`selectPane:${target}`);
  }

  listWindows() {
    return [];
  }
}

function makeMeta(): WorktreeMeta {
  return {
    schemaVersion: 1,
    worktreeId: "wt_test",
    branch: "feature/search-panel",
    createdAt: "2026-03-06T00:00:00.000Z",
    profile: "default",
    agent: "claude",
    runtime: "host",
    startupEnvValues: {
      NODE_ENV: "development",
    },
    allocatedPorts: {
      BACKEND_PORT: 5111,
      FRONTEND_PORT: 3010,
    },
  };
}

describe("renderEnvFile", () => {
  it("sorts keys and quotes unsafe values", () => {
    const rendered = renderEnvFile({
      Z_LAST: "two words",
      A_FIRST: "simple",
      EMPTY: "",
    });

    expect(rendered).toBe([
      "A_FIRST=simple",
      "EMPTY=''",
      "Z_LAST='two words'",
      "",
    ].join("\n"));
  });
});

describe("worktree env maps", () => {
  it("builds runtime env with metadata-derived WEBMUX fields", () => {
    const env = buildRuntimeEnvMap(makeMeta(), {
      WEBMUX_BRANCH: "override-me",
      WEBMUX_WORKTREE_PATH: "/tmp/worktree",
    });

    expect(env.FRONTEND_PORT).toBe("3010");
    expect(env.BACKEND_PORT).toBe("5111");
    expect(env.NODE_ENV).toBe("development");
    expect(env.WEBMUX_WORKTREE_PATH).toBe("/tmp/worktree");
    expect(env.WEBMUX_BRANCH).toBe("feature/search-panel");
    expect(env.WEBMUX_PROFILE).toBe("default");
  });

});

describe("initializeManagedWorktree", () => {
  let gitDir = "";
  let worktreePath = "";

  afterEach(async () => {
    if (gitDir) {
      await rm(gitDir, { recursive: true, force: true });
      gitDir = "";
    }
    if (worktreePath) {
      await rm(worktreePath, { recursive: true, force: true });
      worktreePath = "";
    }
  });

  it("writes metadata and env files into the worktree git admin dir", async () => {
    gitDir = await mkdtemp(join(tmpdir(), "webmux-gitdir-"));
    worktreePath = await mkdtemp(join(tmpdir(), "webmux-worktree-"));

    const result = await initializeManagedWorktree({
      gitDir,
      branch: "feature/search-panel",
      profile: "default",
      agent: "claude",
      runtime: "host",
      startupEnvValues: { NODE_ENV: "development" },
      allocatedPorts: { FRONTEND_PORT: 3010, BACKEND_PORT: 5111 },
      runtimeEnvExtras: { WEBMUX_WORKTREE_PATH: worktreePath },
      controlUrl: "http://127.0.0.1:5111",
      controlToken: "secret-token",
      worktreeId: "wt_test",
      now: () => new Date("2026-03-06T00:00:00.000Z"),
    });

    const paths = getWorktreeStoragePaths(gitDir);
    const meta = await readWorktreeMeta(gitDir);
    const runtimeEnvText = await Bun.file(paths.runtimeEnvPath).text();
    const controlEnvText = await Bun.file(paths.controlEnvPath).text();

    expect(result.paths).toEqual(paths);
    expect(meta).not.toBeNull();
    expect(meta?.worktreeId).toBe("wt_test");
    expect(meta?.allocatedPorts.FRONTEND_PORT).toBe(3010);

    expect(runtimeEnvText).toContain("FRONTEND_PORT=3010");
    expect(runtimeEnvText).toContain("WEBMUX_BRANCH=feature/search-panel");
    expect(runtimeEnvText).toContain(`WEBMUX_WORKTREE_PATH=${worktreePath}`);

    expect(controlEnvText).toContain("WEBMUX_CONTROL_TOKEN=secret-token");
    expect(controlEnvText).toContain("WEBMUX_CONTROL_URL=http://127.0.0.1:5111");
  });

  it("can create a managed worktree and realize a tmux layout through gateways", async () => {
    gitDir = await mkdtemp(join(tmpdir(), "webmux-create-gitdir-"));
    worktreePath = await mkdtemp(join(tmpdir(), "webmux-create-worktree-"));
    await rm(worktreePath, { recursive: true, force: true });
    await mkdir(worktreePath, { recursive: true });

    const calls: string[] = [];
    const git = new FakeGitGateway(gitDir, calls);
    const tmux = new FakeTmuxGateway(calls);

    await createManagedWorktree(
      {
        repoRoot: "/repo/project",
        worktreePath,
        branch: "feature/search-panel",
        baseBranch: "main",
        profile: "default",
        agent: "claude",
        runtime: "host",
        startupEnvValues: { NODE_ENV: "development" },
        allocatedPorts: { FRONTEND_PORT: 3010 },
        controlUrl: "http://127.0.0.1:5111",
        controlToken: "secret-token",
        worktreeId: "wt_test",
        now: () => new Date("2026-03-06T00:00:00.000Z"),
        sessionLayoutPlan: {
          sessionName: "wm-project-12345678",
          windowName: "wm-feature/search-panel",
          focusPaneIndex: 0,
          panes: [
            {
              id: "agent",
              index: 0,
              kind: "agent",
              cwd: worktreePath,
              command: "agent-cmd",
              focus: true,
            },
          ],
        },
      },
      { git, tmux },
    );

    expect(calls[0]).toBe(`createWorktree:/repo/project:${worktreePath}:feature/search-panel:main`);
    expect(calls).toContain("ensureServer");
    expect(calls.some((call) => call.startsWith("createWindow:wm-project-12345678:wm-feature/search-panel"))).toBe(true);

    const meta = await readWorktreeMeta(gitDir);
    expect(meta?.branch).toBe("feature/search-panel");
  });
});
