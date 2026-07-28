import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadComponentCatalog, parseComponentCatalog } from "../adapters/component-catalog";

const pathExists = async (): Promise<boolean> => true;
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("parseComponentCatalog", () => {
  it("normalizes and sorts valid components", async () => {
    const components = await parseComponentCatalog([
      {
        id: "service-z",
        kind: "service",
        workingDir: "services/service-z",
        command: "yarn dev",
        ports: [{ name: "http", processEnv: "PORT", health: { type: "tcp" } }],
      },
      {
        id: "gateway-a",
        label: "Gateway A",
        kind: "gateway",
        workingDir: "services/gateway-a",
        command: "yarn dev",
        environment: { NODE_ENV: "development" },
      },
    ], "/repo", pathExists);

    expect(components).toEqual([
      {
        id: "gateway-a",
        label: "Gateway A",
        kind: "gateway",
        workingDir: "services/gateway-a",
        command: "yarn dev",
        environment: { NODE_ENV: "development" },
        ports: [],
      },
      {
        id: "service-z",
        label: "service-z",
        kind: "service",
        workingDir: "services/service-z",
        command: "yarn dev",
        environment: {},
        ports: [{
          name: "http",
          processEnv: "PORT",
          protocol: "http",
          health: { type: "tcp" },
        }],
      },
    ]);
  });

  it("rejects duplicate IDs", async () => {
    expect(parseComponentCatalog([
      { id: "service-a", kind: "service", workingDir: "a", command: "dev" },
      { id: "service-a", kind: "service", workingDir: "b", command: "dev" },
    ], "/repo", pathExists)).rejects.toThrow('Duplicate component id "service-a"');
  });

  it("rejects working directories outside the repository", async () => {
    expect(parseComponentCatalog([
      { id: "service-a", kind: "service", workingDir: "../outside", command: "dev" },
    ], "/repo", pathExists)).rejects.toThrow("workingDir escapes the project root");
  });

  it("accepts an existing component directory with the default filesystem check", async () => {
    const root = await mkdtemp(join(tmpdir(), "webmux-catalog-"));
    tempRoots.push(root);
    await mkdir(join(root, "services", "service-a"), { recursive: true });

    const components = await parseComponentCatalog([
      {
        id: "service-a",
        kind: "service",
        workingDir: "services/service-a",
        command: "yarn dev",
      },
    ], root);

    expect(components[0]?.workingDir).toBe("services/service-a");
  });
});

describe("loadComponentCatalog", () => {
  it("keeps the project available when the command fails", async () => {
    const state = await loadComponentCatalog(
      { command: "catalog" },
      "/repo",
      {
        runCommand: async () => ({ exitCode: 1, stdout: "", stderr: "boom" }),
        pathExists,
      },
    );

    expect(state).toEqual({
      status: "error",
      components: [],
      error: "Catalog command failed: boom",
    });
  });
});
