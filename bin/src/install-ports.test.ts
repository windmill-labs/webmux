import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  discoverTakenPorts,
  pickFreePort,
  readInstalledServicePorts,
  readPortFromUnit,
} from "./install-ports.ts";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop();
    if (fn) await fn();
  }
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "webmux-install-ports-"));
  cleanups.push(async () => rm(dir, { recursive: true, force: true }));
  return dir;
}

describe("pickFreePort", () => {
  it("returns start when nothing is taken", () => {
    expect(pickFreePort(5111, [])).toBe(5111);
  });

  it("returns the lowest free port at or above start", () => {
    expect(pickFreePort(5111, [5111, 5112, 5114])).toBe(5113);
  });

  it("ignores taken ports below start", () => {
    expect(pickFreePort(5111, [5000, 5001, 5111])).toBe(5112);
  });
});

describe("readPortFromUnit", () => {
  it("parses --port out of a systemd unit", async () => {
    const dir = await makeTempDir();
    const filePath = join(dir, "webmux-foo.service");
    await writeFile(
      filePath,
      [
        "[Service]",
        "Type=simple",
        "ExecStart=/usr/local/bin/webmux serve --port 5117",
        "WorkingDirectory=/home/x/proj",
      ].join("\n"),
    );

    expect(readPortFromUnit(filePath)).toBe(5117);
  });

  it("parses --port out of a launchd plist", async () => {
    const dir = await makeTempDir();
    const filePath = join(dir, "com.webmux.foo.plist");
    await writeFile(
      filePath,
      [
        "<plist version=\"1.0\"><dict>",
        "  <key>ProgramArguments</key>",
        "  <array>",
        "    <string>/usr/local/bin/webmux</string>",
        "    <string>serve</string>",
        "    <string>--port</string>",
        "    <string>5222</string>",
        "  </array>",
        "</dict></plist>",
      ].join("\n"),
    );

    expect(readPortFromUnit(filePath)).toBe(5222);
  });

  it("returns null for a unit file without --port", async () => {
    const dir = await makeTempDir();
    const filePath = join(dir, "other.service");
    await writeFile(filePath, "ExecStart=/usr/bin/something else\n");

    expect(readPortFromUnit(filePath)).toBeNull();
  });

  it("returns null for a missing file", () => {
    expect(readPortFromUnit("/no/such/path.service")).toBeNull();
  });

  // Round-trips against the exact strings `service.ts` emits, so a future
  // re-indent or wrapping change in `generateLaunchdPlist` / `generateSystemdUnit`
  // surfaces as a failing test rather than a silent regression to "auto-pick".
  it("round-trips against the systemd unit format service.ts writes", async () => {
    const dir = await makeTempDir();
    const filePath = join(dir, "webmux-roundtrip.service");
    const content = [
      "[Unit]",
      "Description=webmux dashboard — roundtrip",
      "",
      "[Service]",
      "Type=simple",
      "ExecStart=/usr/local/bin/webmux serve --port 5117",
      "WorkingDirectory=/home/x/proj",
      "Restart=on-failure",
      "RestartSec=5",
      "Environment=PORT=5117",
      "Environment=WEBMUX_PROJECT_DIR=/home/x/proj",
      "Environment=PATH=/usr/local/bin",
      "",
      "[Install]",
      "WantedBy=default.target",
      "",
    ].join("\n");
    await writeFile(filePath, content);

    expect(readPortFromUnit(filePath)).toBe(5117);
  });

  it("round-trips against the launchd plist format service.ts writes", async () => {
    const dir = await makeTempDir();
    const filePath = join(dir, "com.webmux.roundtrip.plist");
    const content = [
      "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
      "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">",
      "<plist version=\"1.0\">",
      "<dict>",
      "  <key>Label</key>",
      "  <string>com.webmux.roundtrip</string>",
      "  <key>ProgramArguments</key>",
      "  <array>",
      "    <string>/usr/local/bin/webmux</string>",
      "    <string>serve</string>",
      "    <string>--port</string>",
      "    <string>5222</string>",
      "  </array>",
      "  <key>WorkingDirectory</key>",
      "  <string>/Users/x/proj</string>",
      "</dict>",
      "</plist>",
      "",
    ].join("\n");
    await writeFile(filePath, content);

    expect(readPortFromUnit(filePath)).toBe(5222);
  });
});

describe("readInstalledServicePorts", () => {
  it("picks up webmux systemd units and ignores unrelated files", async () => {
    const systemdDir = await makeTempDir();
    await writeFile(
      join(systemdDir, "webmux-alpha.service"),
      "ExecStart=/usr/local/bin/webmux serve --port 5111\n",
    );
    await writeFile(
      join(systemdDir, "webmux-beta.service"),
      "ExecStart=/usr/local/bin/webmux serve --port 5112\n",
    );
    await writeFile(
      join(systemdDir, "other-app.service"),
      "ExecStart=/usr/bin/other --port 9999\n",
    );

    const ports = readInstalledServicePorts({
      systemdDir,
      launchdDir: "/no/such/dir",
    }).sort();
    expect(ports).toEqual([5111, 5112]);
  });

  it("picks up webmux launchd plists", async () => {
    const launchdDir = await makeTempDir();
    await writeFile(
      join(launchdDir, "com.webmux.alpha.plist"),
      [
        "<plist><dict><array>",
        "<string>--port</string><string>5300</string>",
        "</array></dict></plist>",
      ].join("\n"),
    );

    const ports = readInstalledServicePorts({
      systemdDir: "/no/such/dir",
      launchdDir,
    });
    expect(ports).toEqual([5300]);
  });

  it("excludes the unit file being replaced", async () => {
    const systemdDir = await makeTempDir();
    const target = join(systemdDir, "webmux-alpha.service");
    await writeFile(target, "ExecStart=/usr/local/bin/webmux serve --port 5111\n");
    await writeFile(
      join(systemdDir, "webmux-beta.service"),
      "ExecStart=/usr/local/bin/webmux serve --port 5112\n",
    );

    const ports = readInstalledServicePorts({
      systemdDir,
      launchdDir: "/no/such/dir",
      excludePath: target,
    });
    expect(ports).toEqual([5112]);
  });
});

describe("discoverTakenPorts", () => {
  it("merges live registry ports with installed-unit ports", async () => {
    const registryDir = await makeTempDir();
    const systemdDir = await makeTempDir();

    await writeFile(
      join(registryDir, "5400.json"),
      JSON.stringify({
        prefix: "live-one",
        port: 5400,
        projectDir: "/tmp/x",
        pid: process.pid,
        startedAt: Date.now(),
      }),
    );
    await writeFile(
      join(systemdDir, "webmux-other.service"),
      "ExecStart=/usr/local/bin/webmux serve --port 5401\n",
    );

    const taken = discoverTakenPorts({
      registryDir,
      systemdDir,
      launchdDir: "/no/such/dir",
    });
    expect(taken.has(5400)).toBe(true);
    expect(taken.has(5401)).toBe(true);
  });

  it("excludes the unit being replaced so reinstall can keep its port", async () => {
    const registryDir = await makeTempDir();
    const systemdDir = await makeTempDir();
    const target = join(systemdDir, "webmux-self.service");
    await writeFile(target, "ExecStart=/usr/local/bin/webmux serve --port 5500\n");

    const taken = discoverTakenPorts({
      registryDir,
      systemdDir,
      launchdDir: "/no/such/dir",
      excludeUnitPath: target,
    });
    expect(taken.has(5500)).toBe(false);
  });
});
