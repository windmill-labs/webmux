import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listInstalledServices, restartCommand, type InstalledService } from "./service-restart.ts";

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
