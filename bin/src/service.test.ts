import { describe, expect, it } from "bun:test";
import {
  generateServiceFile,
  migrateServedRepoFromUnit,
  parseEnvCliArgs,
  parseInstalledServiceConfig,
  readEnvVarsFromUnit,
  readPortFromUnit,
  resolveConfirmDecision,
  resolveEnvVars,
  shouldPersistProject,
  type ServiceConfig,
} from "./service.ts";
import type { ProjectEntry } from "../../backend/src/domain/projects";
import type { ProjectsRegistry } from "../../backend/src/adapters/projects-registry";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** In-memory ProjectsRegistry stub so the migration is testable without
 *  touching ~/.webmux/projects.json. */
function fakeRegistry(initial: ProjectEntry[] = []): ProjectsRegistry {
  const entries = [...initial];
  return {
    list: () => [...entries],
    add: (entry) => {
      const idx = entries.findIndex((e) => e.path === entry.path);
      if (idx >= 0) entries[idx] = entry;
      else entries.push(entry);
    },
    remove: (path) => {
      const idx = entries.findIndex((e) => e.path === path);
      if (idx >= 0) entries.splice(idx, 1);
    },
  };
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "webmux-service-env-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("resolveConfirmDecision", () => {
  it("proceeds outright with --yes, regardless of TTY", () => {
    expect(resolveConfirmDecision(true, true)).toBe("proceed");
    expect(resolveConfirmDecision(true, false)).toBe("proceed");
  });

  it("prompts in an interactive shell without --yes", () => {
    expect(resolveConfirmDecision(false, true)).toBe("prompt");
  });

  it("bails in a non-interactive shell without --yes", () => {
    expect(resolveConfirmDecision(false, false)).toBe("abort-noninteractive");
  });
});

describe("shouldPersistProject", () => {
  it("persists a webmux repo that isn't registered yet", () => {
    expect(shouldPersistProject("/some/repo", true, ["/other/repo"])).toBe(true);
  });

  it("does not persist when there's no path", () => {
    expect(shouldPersistProject(null, true, [])).toBe(false);
  });

  it("does not persist a repo without a webmux config", () => {
    expect(shouldPersistProject("/some/repo", false, [])).toBe(false);
  });

  it("does not persist a repo that is already registered", () => {
    expect(shouldPersistProject("/some/repo", true, ["/some/repo"])).toBe(false);
  });
});

describe("migrateServedRepoFromUnit", () => {
  it("persists the repo an old systemd unit served via WorkingDirectory", async () => {
    await withTempDir(async (repo) => {
      await writeFile(join(repo, ".webmux.yaml"), "name: served\n");
      const unitPath = join(repo, "webmux.service");
      await writeFile(unitPath, `[Service]\nWorkingDirectory=${repo}\nExecStart=/x serve --port 5111\n`);
      const registry = fakeRegistry();

      const migrated = migrateServedRepoFromUnit(unitPath, "linux", registry);

      expect(migrated).toBe(repo);
      expect(registry.list().map((e) => e.path)).toEqual([repo]);
    });
  });

  it("is a no-op when the served dir has no webmux config (e.g. $HOME)", async () => {
    await withTempDir(async (dir) => {
      const unitPath = join(dir, "webmux.service");
      await writeFile(unitPath, `[Service]\nWorkingDirectory=${dir}\n`);
      const registry = fakeRegistry();

      expect(migrateServedRepoFromUnit(unitPath, "linux", registry)).toBeNull();
      expect(registry.list()).toEqual([]);
    });
  });

  it("is a no-op when the served repo is already registered", async () => {
    await withTempDir(async (repo) => {
      await writeFile(join(repo, ".webmux.yaml"), "name: served\n");
      const unitPath = join(repo, "webmux.service");
      await writeFile(unitPath, `[Service]\nWorkingDirectory=${repo}\n`);
      const registry = fakeRegistry([{ path: repo, name: "served", addedAt: 1 }]);

      expect(migrateServedRepoFromUnit(unitPath, "linux", registry)).toBeNull();
      expect(registry.list().length).toBe(1);
    });
  });

  it("reads WorkingDirectory out of a launchd plist", async () => {
    await withTempDir(async (repo) => {
      await writeFile(join(repo, ".webmux.yaml"), "name: served\n");
      const unitPath = join(repo, "com.webmux.webmux.plist");
      await writeFile(
        unitPath,
        `<plist><dict>\n  <key>WorkingDirectory</key>\n  <string>${repo}</string>\n</dict></plist>\n`,
      );
      const registry = fakeRegistry();

      expect(migrateServedRepoFromUnit(unitPath, "darwin", registry)).toBe(repo);
    });
  });
});

describe("parseEnvCliArgs", () => {
  it("collects multiple --env KEY=VAL pairs", () => {
    const { envVars, errors } = parseEnvCliArgs([
      "--env", "LINEAR_API_KEY=lin_xyz",
      "--env", "GITHUB_TOKEN=ghp_abc",
    ]);
    expect(errors).toEqual([]);
    expect(envVars).toEqual({ LINEAR_API_KEY: "lin_xyz", GITHUB_TOKEN: "ghp_abc" });
  });

  it("preserves '=' characters inside the value", () => {
    const { envVars, errors } = parseEnvCliArgs(["--env", "JWT=a.b=c"]);
    expect(errors).toEqual([]);
    expect(envVars).toEqual({ JWT: "a.b=c" });
  });

  it("rejects malformed pairs without dropping subsequent ones", () => {
    const { envVars, errors } = parseEnvCliArgs([
      "--env", "no_equals_here",
      "--env", "GOOD=ok",
    ]);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("KEY=VALUE");
    expect(envVars).toEqual({ GOOD: "ok" });
  });

  it("rejects keys that aren't valid identifiers", () => {
    const { envVars, errors } = parseEnvCliArgs(["--env", "1BAD=x"]);
    expect(errors.length).toBe(1);
    expect(envVars).toEqual({});
  });

  it("refuses reserved generator keys", () => {
    const { errors } = parseEnvCliArgs(["--env", "PATH=/tmp"]);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("PATH");
  });

  it("flags a trailing --env with no argument", () => {
    const { envVars, errors } = parseEnvCliArgs(["--env"]);
    expect(errors).toEqual(["--env requires a KEY=VALUE argument"]);
    expect(envVars).toEqual({});
  });

  it("ignores positional flags that aren't --env", () => {
    const { envVars, errors } = parseEnvCliArgs(["--port", "5111", "--env", "A=1"]);
    expect(errors).toEqual([]);
    expect(envVars).toEqual({ A: "1" });
  });
});

describe("resolveEnvVars", () => {
  it("merges existing + auto-pick + CLI with CLI winning", () => {
    const { envVars } = resolveEnvVars({
      cliEnv: { LINEAR_API_KEY: "cli_value" },
      processEnv: { LINEAR_API_KEY: "shell_value" },
      existing: { LINEAR_API_KEY: "old_value", OTHER: "kept" },
      autoPickup: true,
    });
    // CLI overrides everything; OTHER is preserved from existing unit.
    expect(envVars).toEqual({ LINEAR_API_KEY: "cli_value", OTHER: "kept" });
  });

  it("auto-picks LINEAR_API_KEY from process.env when set", () => {
    const { envVars, notes } = resolveEnvVars({
      cliEnv: {},
      processEnv: { LINEAR_API_KEY: "lin_shell" },
      existing: {},
      autoPickup: true,
    });
    expect(envVars).toEqual({ LINEAR_API_KEY: "lin_shell" });
    expect(notes.some((n) => n.includes("auto-picked"))).toBe(true);
  });

  it("skips auto-pickup when disabled", () => {
    const { envVars } = resolveEnvVars({
      cliEnv: {},
      processEnv: { LINEAR_API_KEY: "lin_shell" },
      existing: {},
      autoPickup: false,
    });
    expect(envVars).toEqual({});
  });

  it("preserves existing env vars when reinstalling without overrides", () => {
    const { envVars } = resolveEnvVars({
      cliEnv: {},
      processEnv: {},
      existing: { LINEAR_API_KEY: "kept" },
      autoPickup: false,
    });
    expect(envVars).toEqual({ LINEAR_API_KEY: "kept" });
  });

  it("treats empty-string env values as unset", () => {
    const { envVars } = resolveEnvVars({
      cliEnv: {},
      processEnv: { LINEAR_API_KEY: "" },
      existing: {},
      autoPickup: true,
    });
    expect(envVars).toEqual({});
  });
});

describe("generateServiceFile + readEnvVarsFromUnit (round-trip)", () => {
  it("round-trips env vars through a systemd unit", async () => {
    await withTempDir(async (dir) => {
      const filePath = join(dir, "webmux-roundtrip.service");
      const config: ServiceConfig = {
        platform: "linux",
        serviceName: "webmux-roundtrip",
        webmuxPath: "/usr/local/bin/webmux",
        port: 5111,
        envVars: { LINEAR_API_KEY: "lin_xyz", FOO: "bar=baz" },
      };
      await writeFile(filePath, generateServiceFile(config));
      const back = readEnvVarsFromUnit(filePath, "linux");
      expect(back).toEqual({ LINEAR_API_KEY: "lin_xyz", FOO: "bar=baz" });
    });
  });

  it("strips reserved generator keys from the parsed result", async () => {
    await withTempDir(async (dir) => {
      const filePath = join(dir, "webmux-roundtrip.service");
      const config: ServiceConfig = {
        platform: "linux",
        serviceName: "webmux-roundtrip",
        webmuxPath: "/usr/local/bin/webmux",
        port: 5111,
        envVars: { LINEAR_API_KEY: "x" },
      };
      await writeFile(filePath, generateServiceFile(config));
      const back = readEnvVarsFromUnit(filePath, "linux");
      // PORT / WEBMUX_PROJECT_DIR / PATH stay out of the user-env view.
      expect(back).toEqual({ LINEAR_API_KEY: "x" });
    });
  });

  it("round-trips env vars through a launchd plist (XML-escaped)", async () => {
    await withTempDir(async (dir) => {
      const filePath = join(dir, "com.webmux.webmux-roundtrip.plist");
      const config: ServiceConfig = {
        platform: "darwin",
        serviceName: "webmux-roundtrip",
        webmuxPath: "/usr/local/bin/webmux",
        port: 5222,
        envVars: { TOKEN: "needs <escaping> & a&mp", PLAIN: "ok" },
      };
      await writeFile(filePath, generateServiceFile(config));
      const back = readEnvVarsFromUnit(filePath, "darwin");
      expect(back).toEqual({ TOKEN: "needs <escaping> & a&mp", PLAIN: "ok" });
    });
  });

  it("parseInstalledServiceConfig surfaces envVars on the returned config", async () => {
    await withTempDir(async (dir) => {
      const filePath = join(dir, "webmux-roundtrip.service");
      await writeFile(join(dir, "package.json"), JSON.stringify({ name: "roundtrip" }));
      const original: ServiceConfig = {
        platform: "linux",
        serviceName: "webmux-roundtrip",
        webmuxPath: "/usr/local/bin/webmux",
        port: 5117,
        envVars: { LINEAR_API_KEY: "lin_xyz" },
      };
      await writeFile(filePath, generateServiceFile(original));
      const parsed = parseInstalledServiceConfig(filePath, "linux", "/usr/local/bin/webmux");
      expect(parsed).not.toBeNull();
      expect(parsed?.envVars).toEqual({ LINEAR_API_KEY: "lin_xyz" });
      // Idempotent regeneration: generate(parse(generate(x))) === generate(x)
      expect(generateServiceFile(parsed!)).toBe(generateServiceFile(original));
    });
  });
});

describe("readPortFromUnit", () => {
  it("parses --port out of a systemd unit", async () => {
    await withTempDir(async (dir) => {
      const filePath = join(dir, "webmux.service");
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
  });

  it("parses --port out of a launchd plist", async () => {
    await withTempDir(async (dir) => {
      const filePath = join(dir, "com.webmux.webmux.plist");
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
  });

  it("returns null for a unit file without --port", async () => {
    await withTempDir(async (dir) => {
      const filePath = join(dir, "other.service");
      await writeFile(filePath, "ExecStart=/usr/bin/something else\n");

      expect(readPortFromUnit(filePath)).toBeNull();
    });
  });

  it("returns null for a missing file", () => {
    expect(readPortFromUnit("/no/such/path.service")).toBeNull();
  });

  // Round-trips against the exact strings service.ts emits, so a future
  // re-indent or wrapping change in the unit generators surfaces as a failing
  // test rather than a silent regression.
  it("round-trips against the unit format generateServiceFile writes", async () => {
    await withTempDir(async (dir) => {
      const config: ServiceConfig = {
        platform: "linux",
        serviceName: "webmux",
        webmuxPath: "/usr/local/bin/webmux",
        port: 5117,
        envVars: {},
      };
      const filePath = join(dir, "webmux.service");
      await writeFile(filePath, generateServiceFile(config));

      expect(readPortFromUnit(filePath)).toBe(5117);
    });
  });

  it("round-trips against the launchd plist generateServiceFile writes", async () => {
    await withTempDir(async (dir) => {
      const config: ServiceConfig = {
        platform: "darwin",
        serviceName: "webmux",
        webmuxPath: "/usr/local/bin/webmux",
        port: 5222,
        envVars: {},
      };
      const filePath = join(dir, "com.webmux.webmux.plist");
      await writeFile(filePath, generateServiceFile(config));

      expect(readPortFromUnit(filePath)).toBe(5222);
    });
  });
});
