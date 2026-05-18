import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listInstalledServices, restartCommand, type InstalledService } from "./service-restart.ts";
import { generateServiceFile, parseInstalledServiceConfig, type ServiceConfig } from "./service.ts";

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
