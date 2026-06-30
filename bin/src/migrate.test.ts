import { describe, expect, test } from "bun:test";
import type { InstanceEntry } from "../../backend/src/adapters/instance-registry";
import type { InstalledService, ServiceRunner } from "./service-restart.ts";
import type { RunResult } from "./shared.ts";
import { disableUnitCommands, findUnitForPort, otherInstances, runMigrate } from "./migrate.ts";

function instance(overrides: Partial<InstanceEntry>): InstanceEntry {
  return { port: 5111, projectDir: "/repo/a", pid: 100, ...overrides };
}

function service(overrides: Partial<InstalledService>): InstalledService {
  return { name: "webmux-a", filePath: "/units/webmux-a.service", platform: "linux", ...overrides };
}

const okRun: RunResult = { success: true, stdout: Buffer.from(""), stderr: Buffer.from("") };

describe("otherInstances", () => {
  test("excludes the survivor port", () => {
    const all = [instance({ port: 5111 }), instance({ port: 5112 }), instance({ port: 5113 })];
    expect(otherInstances(all, 5111).map((e) => e.port)).toEqual([5112, 5113]);
  });
});

describe("findUnitForPort", () => {
  test("matches the unit whose --port equals the target", () => {
    const services = [
      service({ name: "webmux-a", filePath: "/units/a.service" }),
      service({ name: "webmux-b", filePath: "/units/b.service" }),
    ];
    const portOf = (path: string): number | null => (path === "/units/b.service" ? 5112 : 5111);
    expect(findUnitForPort(services, 5112, portOf)?.name).toBe("webmux-b");
    expect(findUnitForPort(services, 9999, portOf)).toBeNull();
  });
});

describe("disableUnitCommands", () => {
  test("systemd: stop then disable by unit name", () => {
    expect(disableUnitCommands(service({ name: "webmux-a", platform: "linux" }))).toEqual([
      ["systemctl", ["--user", "stop", "webmux-a"]],
      ["systemctl", ["--user", "disable", "webmux-a"]],
    ]);
  });

  test("launchd: unload -w by file path", () => {
    expect(
      disableUnitCommands(service({ filePath: "/units/com.webmux.a.plist", platform: "darwin" })),
    ).toEqual([["launchctl", ["unload", "-w", "/units/com.webmux.a.plist"]]]);
  });
});

describe("runMigrate", () => {
  test("no other instances: nothing to do", async () => {
    const code = await runMigrate(5111, {
      listLive: () => [instance({ port: 5111 })],
      listServices: () => [],
    });
    expect(code).toBe(0);
  });

  test("registers other repos first, then retires their units", async () => {
    const calls: string[] = [];
    const removed: string[] = [];
    const runner: ServiceRunner = {
      run: (bin, args) => {
        calls.push(`${bin} ${args.join(" ")}`);
        return okRun;
      },
    };
    const live = [instance({ port: 5111, projectDir: "/repo/survivor" }), instance({ port: 5112, projectDir: "/repo/other" })];
    const services = [service({ name: "webmux-other", filePath: "/units/other.service" })];

    const order: string[] = [];
    const code = await runMigrate(5111, {
      listLive: () => live,
      listServices: () => services,
      runner,
      portOf: (path) => (path === "/units/other.service" ? 5112 : null),
      removeFile: (path) => {
        order.push("remove");
        removed.push(path);
      },
      migrate: async (port, paths) => {
        order.push("register");
        expect(port).toBe(5111);
        expect(paths).toEqual(["/repo/other"]);
        return { migrated: [{ prefix: "other", name: "Other", path: "/repo/other", active: false }], failed: [] };
      },
    });

    expect(code).toBe(0);
    // Register must happen before the unit is stopped/removed (no service gap).
    expect(order[0]).toBe("register");
    expect(calls).toEqual([
      "systemctl --user stop webmux-other",
      "systemctl --user disable webmux-other",
    ]);
    expect(removed).toEqual(["/units/other.service"]);
  });

  test("does not retire a unit whose repo failed to register", async () => {
    const calls: string[] = [];
    const removed: string[] = [];
    const runner: ServiceRunner = {
      run: (bin, args) => {
        calls.push(`${bin} ${args.join(" ")}`);
        return okRun;
      },
    };
    const live = [
      instance({ port: 5111, projectDir: "/repo/survivor" }),
      instance({ port: 5112, projectDir: "/repo/ok" }),
      instance({ port: 5113, projectDir: "/repo/gone" }),
    ];
    const services = [
      service({ name: "webmux-ok", filePath: "/units/ok.service" }),
      service({ name: "webmux-gone", filePath: "/units/gone.service" }),
    ];

    const code = await runMigrate(5111, {
      listLive: () => live,
      listServices: () => services,
      runner,
      portOf: (path) => ({ "/units/ok.service": 5112, "/units/gone.service": 5113 })[path] ?? null,
      removeFile: (path) => removed.push(path),
      migrate: async () => ({
        migrated: [{ prefix: "ok", name: "Ok", path: "/repo/ok", active: false }],
        failed: [{ path: "/repo/gone", error: "Not a git repository: /repo/gone" }],
      }),
    });

    expect(code).toBe(0);
    // Only the successfully-migrated unit is retired; the failed one is left running.
    expect(calls).toEqual([
      "systemctl --user stop webmux-ok",
      "systemctl --user disable webmux-ok",
    ]);
    expect(removed).toEqual(["/units/ok.service"]);
  });

  test("returns 1 when the survivor can't be reached", async () => {
    const code = await runMigrate(5111, {
      listLive: () => [instance({ port: 5111 }), instance({ port: 5112 })],
      listServices: () => [],
      migrate: async () => {
        throw new Error("Unable to connect. Is the computer able to access the url?");
      },
    });
    expect(code).toBe(1);
  });
});
