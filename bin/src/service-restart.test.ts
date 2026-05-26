import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listInstalledServices,
  restartCommand,
  updateInstalledService,
  type InstalledService,
  type ServiceRunner,
} from "./service-restart.ts";
import { generateServiceFile, parseInstalledServiceConfig, type ServiceConfig } from "./service.ts";
import type { RunResult } from "./shared.ts";

interface RecordedCall {
  bin: string;
  args: string[];
}

function makeRecorder(behaviour: (call: RecordedCall) => RunResult): {
  runner: ServiceRunner;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const runner: ServiceRunner = {
    run(bin, args) {
      const call = { bin, args };
      calls.push(call);
      return behaviour(call);
    },
  };
  return { runner, calls };
}

const okResult: RunResult = {
  success: true,
  stdout: Buffer.from(""),
  stderr: Buffer.from(""),
};

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop();
    if (fn) await fn();
  }
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "webmux-service-restart-"));
  cleanups.push(async () => rm(dir, { recursive: true, force: true }));
  return dir;
}

describe("listInstalledServices", () => {
  it("picks up systemd units and strips the .service suffix", async () => {
    const systemdDir = await makeTempDir();
    await writeFile(join(systemdDir, "webmux-alpha.service"), "[Service]\nExecStart=/bin/x\n");
    await writeFile(join(systemdDir, "webmux-beta.service"), "[Service]\nExecStart=/bin/x\n");
    await writeFile(join(systemdDir, "unrelated.service"), "[Service]\nExecStart=/bin/x\n");

    const services = listInstalledServices({
      systemdDir,
      launchdDir: "/no/such/dir",
    });

    expect(services.map((s) => s.name).sort()).toEqual(["webmux-alpha", "webmux-beta"]);
    for (const svc of services) expect(svc.platform).toBe("linux");
  });

  it("picks up launchd plists and keeps the full label", async () => {
    const launchdDir = await makeTempDir();
    await writeFile(join(launchdDir, "com.webmux.alpha.plist"), "<plist></plist>");
    await writeFile(join(launchdDir, "com.other.thing.plist"), "<plist></plist>");

    const services = listInstalledServices({
      systemdDir: "/no/such/dir",
      launchdDir,
    });

    expect(services.map((s) => s.name)).toEqual(["com.webmux.alpha"]);
    expect(services[0].platform).toBe("darwin");
  });

  it("returns empty when neither directory exists", () => {
    const services = listInstalledServices({
      systemdDir: "/no/such/systemd",
      launchdDir: "/no/such/launchd",
    });
    expect(services).toEqual([]);
  });
});

describe("parseInstalledServiceConfig", () => {
  it("reconstructs a ServiceConfig from a systemd unit written by generateServiceFile", async () => {
    const dir = await makeTempDir();
    const filePath = join(dir, "webmux-roundtrip.service");
    const original: ServiceConfig = {
      platform: "linux",
      projectName: "roundtrip",
      serviceName: "webmux-roundtrip",
      webmuxPath: "/usr/local/bin/webmux",
      projectDir: dir,
      port: 5117,
      envVars: {},
    };
    await writeFile(filePath, generateServiceFile(original));

    const parsed = parseInstalledServiceConfig(filePath, "linux", "/new/path/webmux");

    expect(parsed).not.toBeNull();
    expect(parsed?.port).toBe(5117);
    expect(parsed?.projectDir).toBe(dir);
    expect(parsed?.serviceName).toBe("webmux-roundtrip");
    // webmuxPath comes from the caller (post-upgrade `which webmux`), not the unit.
    expect(parsed?.webmuxPath).toBe("/new/path/webmux");
  });

  it("reconstructs a ServiceConfig from a launchd plist written by generateServiceFile", async () => {
    const dir = await makeTempDir();
    const filePath = join(dir, "com.webmux.webmux-roundtrip.plist");
    const original: ServiceConfig = {
      platform: "darwin",
      projectName: "roundtrip",
      serviceName: "webmux-roundtrip",
      webmuxPath: "/usr/local/bin/webmux",
      projectDir: dir,
      port: 5222,
      envVars: {},
    };
    await writeFile(filePath, generateServiceFile(original));

    const parsed = parseInstalledServiceConfig(filePath, "darwin", "/new/path/webmux");

    expect(parsed).not.toBeNull();
    expect(parsed?.port).toBe(5222);
    expect(parsed?.projectDir).toBe(dir);
    expect(parsed?.serviceName).toBe("webmux-roundtrip");
  });

  it("returns null when the unit file lacks --port", async () => {
    const dir = await makeTempDir();
    const filePath = join(dir, "broken.service");
    await writeFile(filePath, "[Service]\nWorkingDirectory=/x\n");
    expect(parseInstalledServiceConfig(filePath, "linux", "/path/webmux")).toBeNull();
  });
});

describe("generateServiceFile → parseInstalledServiceConfig → generateServiceFile is idempotent", () => {
  it("regenerated content matches the original for systemd units", async () => {
    const dir = await makeTempDir();
    // `detectProjectName` reads package.json's `name` first, so seeding one
    // with a stable name guarantees the re-derived `projectName` matches the
    // original — otherwise it would fall back to the random temp-dir basename
    // and the round-trip would diverge on the `Description=` line.
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "idempotent" }));
    const filePath = join(dir, "webmux-idempotent.service");
    const original: ServiceConfig = {
      platform: "linux",
      projectName: "idempotent",
      serviceName: "webmux-idempotent",
      webmuxPath: "/usr/local/bin/webmux",
      projectDir: dir,
      port: 5333,
      envVars: {},
    };
    const originalContent = generateServiceFile(original);
    await writeFile(filePath, originalContent);

    const parsed = parseInstalledServiceConfig(filePath, "linux", "/usr/local/bin/webmux");
    expect(parsed).not.toBeNull();
    if (!parsed) throw new Error("parse failed");

    // Round-trip should produce identical content when webmuxPath is unchanged.
    expect(generateServiceFile(parsed)).toBe(originalContent);
  });
});

describe("updateInstalledService", () => {
  async function setupSystemdService(): Promise<{ service: InstalledService; dir: string; originalContent: string }> {
    const dir = await makeTempDir();
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "orch" }));
    const filePath = join(dir, "webmux-orch.service");
    const original: ServiceConfig = {
      platform: "linux",
      projectName: "orch",
      serviceName: "webmux-orch",
      webmuxPath: "/old/path/webmux",
      projectDir: dir,
      port: 5500,
      envVars: {},
    };
    const originalContent = generateServiceFile(original);
    await writeFile(filePath, originalContent);
    return {
      service: { name: "webmux-orch", filePath, platform: "linux" },
      dir,
      originalContent,
    };
  }

  it("skips regeneration entirely when webmuxPath is empty", async () => {
    const { service, originalContent } = await setupSystemdService();
    const { runner, calls } = makeRecorder(() => okResult);

    const outcome = await updateInstalledService(service, "", runner);

    expect(outcome.regenerated).toBe(false);
    expect(outcome.restarted).toBe(true);
    // The unit file must be untouched — a stale `which webmux` failure must
    // never corrupt ExecStart.
    expect(await Bun.file(service.filePath).text()).toBe(originalContent);
    // Only the restart should fire — no daemon-reload.
    expect(calls).toEqual([
      { bin: "systemctl", args: ["--user", "restart", "webmux-orch"] },
    ]);
  });

  it("skips reload when regenerated content matches existing", async () => {
    const { service } = await setupSystemdService();
    const { runner, calls } = makeRecorder(() => okResult);

    // Same path → generated content identical → no rewrite, no daemon-reload.
    const outcome = await updateInstalledService(service, "/old/path/webmux", runner);

    expect(outcome.regenerated).toBe(false);
    expect(outcome.restarted).toBe(true);
    expect(calls).toEqual([
      { bin: "systemctl", args: ["--user", "restart", "webmux-orch"] },
    ]);
  });

  it("regenerates + reloads + restarts when webmuxPath changes", async () => {
    const { service } = await setupSystemdService();
    const { runner, calls } = makeRecorder(() => okResult);

    const outcome = await updateInstalledService(service, "/new/path/webmux", runner);

    expect(outcome.regenerated).toBe(true);
    expect(outcome.restarted).toBe(true);
    expect(calls).toEqual([
      { bin: "systemctl", args: ["--user", "daemon-reload"] },
      { bin: "systemctl", args: ["--user", "restart", "webmux-orch"] },
    ]);
    expect(await Bun.file(service.filePath).text()).toContain("/new/path/webmux");
  });

  it("does not attempt a restart when daemon-reload fails", async () => {
    const { service } = await setupSystemdService();
    const { runner, calls } = makeRecorder((call) => {
      if (call.args.includes("daemon-reload")) {
        return {
          success: false,
          stdout: Buffer.from(""),
          stderr: Buffer.from("reload broke"),
        };
      }
      return okResult;
    });

    const outcome = await updateInstalledService(service, "/new/path/webmux", runner);

    expect(outcome.regenerated).toBe(true);
    expect(outcome.restarted).toBe(false);
    expect(outcome.error).toContain("reload broke");
    expect(calls).toEqual([
      { bin: "systemctl", args: ["--user", "daemon-reload"] },
    ]);
  });

  it("surfaces a launchctl load recovery hint when reload fails", async () => {
    const dir = await makeTempDir();
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "darwin-orch" }));
    const filePath = join(dir, "com.webmux.webmux-darwin-orch.plist");
    const original: ServiceConfig = {
      platform: "darwin",
      projectName: "darwin-orch",
      serviceName: "webmux-darwin-orch",
      webmuxPath: "/old/path/webmux",
      projectDir: dir,
      port: 5600,
      envVars: {},
    };
    await writeFile(filePath, generateServiceFile(original));
    const service: InstalledService = {
      name: "com.webmux.webmux-darwin-orch",
      filePath,
      platform: "darwin",
    };

    const { runner } = makeRecorder((call) => {
      if (call.args[0] === "load") {
        return {
          success: false,
          stdout: Buffer.from(""),
          stderr: Buffer.from("plist load failed"),
        };
      }
      return okResult;
    });

    const outcome = await updateInstalledService(service, "/new/path/webmux", runner);

    expect(outcome.regenerated).toBe(true);
    expect(outcome.restarted).toBe(false);
    expect(outcome.error).toContain("plist load failed");
    expect(outcome.error).toContain("launchctl load -w");
  });
});

describe("restartCommand", () => {
  it("builds the systemctl --user restart command for linux", () => {
    const svc: InstalledService = {
      name: "webmux-foo",
      filePath: "/x/webmux-foo.service",
      platform: "linux",
    };
    expect(restartCommand(svc, 1000)).toEqual({
      bin: "systemctl",
      args: ["--user", "restart", "webmux-foo"],
    });
  });

  it("builds the launchctl kickstart command for darwin", () => {
    const svc: InstalledService = {
      name: "com.webmux.foo",
      filePath: "/x/com.webmux.foo.plist",
      platform: "darwin",
    };
    expect(restartCommand(svc, 501)).toEqual({
      bin: "launchctl",
      args: ["kickstart", "-k", "gui/501/com.webmux.foo"],
    });
  });
});
