import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expandTemplate, getDefaultProfileName, loadConfig } from "../adapters/config";

describe("expandTemplate", () => {
  it("replaces known placeholders", () => {
    expect(expandTemplate("Hello ${NAME}", { NAME: "world" })).toBe("Hello world");
  });

  it("leaves unknown placeholders as empty string", () => {
    expect(expandTemplate("Hello ${MISSING}", {})).toBe("Hello ");
  });

  it("replaces multiple placeholders in one string", () => {
    expect(expandTemplate("${A}-${B}", { A: "foo", B: "bar" })).toBe("foo-bar");
  });

  it("returns the string unchanged when there are no placeholders", () => {
    expect(expandTemplate("no placeholders", {})).toBe("no placeholders");
  });
});

describe("loadConfig", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("loads the final .webmux.yaml shape into ProjectConfig", async () => {
    const dir = await mkdtemp(join(tmpdir(), "webmux-config-"));
    tempDirs.push(dir);
    Bun.spawnSync(["git", "init"], { cwd: dir });

    await Bun.write(
      join(dir, ".webmux.yaml"),
      [
        "name: Example",
        "workspace:",
        "  mainBranch: trunk",
        "  worktreeRoot: worktrees",
        "  defaultAgent: codex",
        "services:",
        "  - name: API",
        "    portEnv: API_PORT",
        "    portStart: 4100",
        "profiles:",
        "  default:",
        "    runtime: host",
        "    yolo: true",
        "    envPassthrough: [GITHUB_TOKEN]",
        "    panes:",
        "      - id: agent",
        "        kind: agent",
        "        focus: true",
        "  sandbox:",
        "    runtime: docker",
        "    yolo: false",
        "    image: webmux-sandbox",
        "    envPassthrough: [AWS_ACCESS_KEY_ID]",
        "    panes:",
        "      - id: agent",
        "        kind: agent",
        "        focus: true",
        "startupEnvs:",
        "  FEATURE_FLAG: true",
        "lifecycleHooks:",
        "  postCreate: scripts/post-create.sh",
        "  preRemove: scripts/pre-remove.sh",
        "integrations:",
        "  github:",
        "    linkedRepos:",
        "      - repo: acme/linked",
        "        alias: linked",
        "  linear:",
        "    enabled: false",
        "",
      ].join("\n"),
    );

    const config = loadConfig(dir);

    expect(config.name).toBe("Example");
    expect(config.workspace.mainBranch).toBe("trunk");
    expect(config.workspace.worktreeRoot).toBe("worktrees");
    expect(config.workspace.defaultAgent).toBe("codex");
    expect(config.services).toEqual([{ name: "API", portEnv: "API_PORT", portStart: 4100 }]);
    expect(config.profiles.default.runtime).toBe("host");
    expect(config.profiles.default.yolo).toBe(true);
    expect(config.profiles.default.envPassthrough).toEqual(["GITHUB_TOKEN"]);
    expect(config.profiles.sandbox?.runtime).toBe("docker");
    expect(config.profiles.sandbox?.yolo).toBeUndefined();
    expect(config.profiles.sandbox?.image).toBe("webmux-sandbox");
    expect(config.startupEnvs).toEqual({ FEATURE_FLAG: true });
    expect(config.lifecycleHooks).toEqual({
      postCreate: "scripts/post-create.sh",
      preRemove: "scripts/pre-remove.sh",
    });
    expect(config.integrations.github.linkedRepos).toEqual([{ repo: "acme/linked", alias: "linked" }]);
    expect(config.integrations.linear.enabled).toBe(false);
  });

  it("uses the first configured profile when no default profile exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "webmux-config-"));
    tempDirs.push(dir);
    Bun.spawnSync(["git", "init"], { cwd: dir });

    await Bun.write(
      join(dir, ".webmux.yaml"),
      [
        "profiles:",
        "  slim:",
        "    runtime: host",
        "    envPassthrough: []",
        "    panes:",
        "      - id: agent",
        "        kind: agent",
        "        focus: true",
        "  full:",
        "    runtime: host",
        "    envPassthrough: []",
        "    panes:",
        "      - id: agent",
        "        kind: agent",
        "        focus: true",
        "",
      ].join("\n"),
    );

    const config = loadConfig(dir);

    expect(getDefaultProfileName(config)).toBe("slim");
  });
});
