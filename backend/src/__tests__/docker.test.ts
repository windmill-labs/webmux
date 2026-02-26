import { describe, expect, it } from "bun:test";
import { buildDockerRunArgs, type LaunchContainerOpts } from "../docker";

const HOME = "/home/testuser";
const RPC_SECRET = "test-rpc-secret";
const RPC_PORT = "5111";

/** Minimal valid opts; individual tests override what they need. */
function makeOpts(overrides: Partial<LaunchContainerOpts> = {}): LaunchContainerOpts {
  return {
    branch: "my-branch",
    wtDir: "/repos/my-branch",
    mainRepoDir: "/repos/main",
    sandboxConfig: { name: "sandbox", image: "my-image:latest" },
    services: [],
    env: {},
    ...overrides,
  };
}

/** Pull all -v flag values out of an args array. */
function mounts(args: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === "-v") result.push(args[i + 1]!);
  }
  return result;
}

/** Pull all -p flag values out of an args array. */
function ports(args: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === "-p") result.push(args[i + 1]!);
  }
  return result;
}

/** Pull all -e flag values out of an args array. */
function envFlags(args: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === "-e") result.push(args[i + 1]!);
  }
  return result;
}

// ---------------------------------------------------------------------------
// extraMounts
// ---------------------------------------------------------------------------

describe("buildDockerRunArgs — extraMounts", () => {
  it("adds a read-only mount when writable is false", () => {
    const args = buildDockerRunArgs(
      makeOpts({ sandboxConfig: { name: "sandbox", image: "img", extraMounts: [
        { hostPath: "/data/shared", guestPath: "/mnt/shared", writable: false },
      ]}}),
      new Set(),
      HOME,
      "wm-test-123",
      RPC_SECRET,
      RPC_PORT,
    );
    expect(mounts(args)).toContain("/data/shared:/mnt/shared:ro");
  });

  it("adds a writable mount when writable is true", () => {
    const args = buildDockerRunArgs(
      makeOpts({ sandboxConfig: { name: "sandbox", image: "img", extraMounts: [
        { hostPath: "/data/shared", guestPath: "/mnt/shared", writable: true },
      ]}}),
      new Set(),
      HOME,
      "wm-test-123",
      RPC_SECRET,
      RPC_PORT,
    );
    expect(mounts(args)).toContain("/data/shared:/mnt/shared");
    expect(mounts(args)).not.toContain("/data/shared:/mnt/shared:ro");
  });

  it("defaults to read-only when writable is omitted", () => {
    const args = buildDockerRunArgs(
      makeOpts({ sandboxConfig: { name: "sandbox", image: "img", extraMounts: [
        { hostPath: "/data/shared", guestPath: "/mnt/shared" },
      ]}}),
      new Set(),
      HOME,
      "wm-test-123",
      RPC_SECRET,
      RPC_PORT,
    );
    expect(mounts(args)).toContain("/data/shared:/mnt/shared:ro");
  });

  it("uses hostPath as guestPath when guestPath is omitted", () => {
    const args = buildDockerRunArgs(
      makeOpts({ sandboxConfig: { name: "sandbox", image: "img", extraMounts: [
        { hostPath: "/data/shared" },
      ]}}),
      new Set(),
      HOME,
      "wm-test-123",
      RPC_SECRET,
      RPC_PORT,
    );
    expect(mounts(args)).toContain("/data/shared:/data/shared:ro");
  });

  it("expands ~ to the home directory", () => {
    const args = buildDockerRunArgs(
      makeOpts({ sandboxConfig: { name: "sandbox", image: "img", extraMounts: [
        { hostPath: "~/projects", guestPath: "/root/projects" },
      ]}}),
      new Set(),
      HOME,
      "wm-test-123",
      RPC_SECRET,
      RPC_PORT,
    );
    expect(mounts(args)).toContain(`${HOME}/projects:/root/projects:ro`);
  });

  it("skips mounts with non-absolute paths after ~ expansion", () => {
    const args = buildDockerRunArgs(
      makeOpts({ sandboxConfig: { name: "sandbox", image: "img", extraMounts: [
        { hostPath: "relative/path", guestPath: "/mnt/data" },
      ]}}),
      new Set(),
      HOME,
      "wm-test-123",
      RPC_SECRET,
      RPC_PORT,
    );
    expect(mounts(args).join("\n")).not.toContain("/mnt/data");
  });

  it("includes multiple extra mounts in order", () => {
    const args = buildDockerRunArgs(
      makeOpts({ sandboxConfig: { name: "sandbox", image: "img", extraMounts: [
        { hostPath: "/data/a", guestPath: "/mnt/a", writable: true },
        { hostPath: "/data/b", guestPath: "/mnt/b" },
      ]}}),
      new Set(),
      HOME,
      "wm-test-123",
      RPC_SECRET,
      RPC_PORT,
    );
    const m = mounts(args);
    expect(m).toContain("/data/a:/mnt/a");
    expect(m).toContain("/data/b:/mnt/b:ro");
  });
});

// ---------------------------------------------------------------------------
// extraMounts conflict resolution: config wins over credential defaults
// ---------------------------------------------------------------------------

describe("buildDockerRunArgs — extraMounts override credential mounts", () => {
  it("config ~/.ssh writable overrides the default read-only credential mount", () => {
    // Default behaviour without extraMounts: ~/.ssh is mounted :ro when it exists.
    // With an extraMount for ~/.ssh marked writable, the credential mount must be
    // suppressed so the container only sees the writable version.
    const existingPaths = new Set([`${HOME}/.ssh`]);

    const args = buildDockerRunArgs(
      makeOpts({ sandboxConfig: { name: "sandbox", image: "img", extraMounts: [
        { hostPath: "~/.ssh", guestPath: "/root/.ssh", writable: true },
      ]}}),
      existingPaths,
      HOME,
      "wm-test-123",
      RPC_SECRET,
      RPC_PORT,
    );

    const m = mounts(args);
    // The writable extraMount must be present.
    expect(m).toContain(`${HOME}/.ssh:/root/.ssh`);
    // The default read-only credential mount must NOT be present.
    expect(m).not.toContain(`${HOME}/.ssh:/root/.ssh:ro`);
  });

  it("config ~/.ssh read-only still suppresses the credential mount (config controls it)", () => {
    const existingPaths = new Set([`${HOME}/.ssh`]);

    const args = buildDockerRunArgs(
      makeOpts({ sandboxConfig: { name: "sandbox", image: "img", extraMounts: [
        { hostPath: "~/.ssh", guestPath: "/root/.ssh", writable: false },
      ]}}),
      existingPaths,
      HOME,
      "wm-test-123",
      RPC_SECRET,
      RPC_PORT,
    );

    const m = mounts(args);
    // Exactly one mount for /root/.ssh — the one from extraMounts.
    const sshMounts = m.filter(v => v.includes("/root/.ssh"));
    expect(sshMounts).toHaveLength(1);
    expect(sshMounts[0]).toBe(`${HOME}/.ssh:/root/.ssh:ro`);
  });

  it("config ~/.gitconfig override does not affect unrelated credential mounts", () => {
    const existingPaths = new Set([`${HOME}/.gitconfig`, `${HOME}/.ssh`]);

    const args = buildDockerRunArgs(
      makeOpts({ sandboxConfig: { name: "sandbox", image: "img", extraMounts: [
        { hostPath: "~/.gitconfig", guestPath: "/root/.gitconfig", writable: true },
      ]}}),
      existingPaths,
      HOME,
      "wm-test-123",
      RPC_SECRET,
      RPC_PORT,
    );

    const m = mounts(args);
    // .gitconfig should be the writable extraMount version.
    expect(m).toContain(`${HOME}/.gitconfig:/root/.gitconfig`);
    expect(m).not.toContain(`${HOME}/.gitconfig:/root/.gitconfig:ro`);
    // .ssh should still be present as the default read-only credential mount.
    expect(m).toContain(`${HOME}/.ssh:/root/.ssh:ro`);
  });

  it("credential mounts are included normally when there are no extraMounts", () => {
    const existingPaths = new Set([`${HOME}/.gitconfig`, `${HOME}/.ssh`]);

    const args = buildDockerRunArgs(
      makeOpts(),
      existingPaths,
      HOME,
      "wm-test-123",
      RPC_SECRET,
      RPC_PORT,
    );

    const m = mounts(args);
    expect(m).toContain(`${HOME}/.gitconfig:/root/.gitconfig:ro`);
    expect(m).toContain(`${HOME}/.ssh:/root/.ssh:ro`);
  });

  it("credential mounts are omitted for paths that do not exist on the host", () => {
    const args = buildDockerRunArgs(
      makeOpts(),
      new Set(), // nothing exists
      HOME,
      "wm-test-123",
      RPC_SECRET,
      RPC_PORT,
    );

    const m = mounts(args);
    expect(m).not.toContain(`${HOME}/.gitconfig:/root/.gitconfig:ro`);
    expect(m).not.toContain(`${HOME}/.ssh:/root/.ssh:ro`);
  });
});

// ---------------------------------------------------------------------------
// Port handling
// ---------------------------------------------------------------------------

describe("buildDockerRunArgs — ports", () => {
  it("binds valid ports to loopback only", () => {
    const args = buildDockerRunArgs(
      makeOpts({
        services: [{ name: "web", portEnv: "PORT" }],
        env: { PORT: "3000" },
      }),
      new Set(),
      HOME,
      "wm-test-123",
      RPC_SECRET,
      RPC_PORT,
    );
    expect(ports(args)).toContain("127.0.0.1:3000:3000");
  });

  it("skips ports with non-numeric values", () => {
    const args = buildDockerRunArgs(
      makeOpts({
        services: [{ name: "web", portEnv: "PORT" }],
        env: { PORT: "auto" },
      }),
      new Set(),
      HOME,
      "wm-test-123",
      RPC_SECRET,
      RPC_PORT,
    );
    expect(ports(args)).toHaveLength(0);
  });

  it("deduplicates ports that appear more than once", () => {
    const args = buildDockerRunArgs(
      makeOpts({
        services: [
          { name: "web", portEnv: "PORT" },
          { name: "api", portEnv: "API_PORT" },
        ],
        env: { PORT: "3000", API_PORT: "3000" },
      }),
      new Set(),
      HOME,
      "wm-test-123",
      RPC_SECRET,
      RPC_PORT,
    );
    expect(ports(args).filter(p => p.startsWith("127.0.0.1:3000"))).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Reserved env var protection
// ---------------------------------------------------------------------------

describe("buildDockerRunArgs — reserved env vars", () => {
  it("HOME from .env.local does not override the hardcoded HOME=/root", () => {
    const args = buildDockerRunArgs(
      makeOpts({ env: { HOME: "/attacker" } }),
      new Set(),
      HOME,
      "wm-test-123",
      RPC_SECRET,
      RPC_PORT,
    );
    const flags = envFlags(args);
    expect(flags).toContain("HOME=/root");
    expect(flags).not.toContain("HOME=/attacker");
  });

  it("IS_SANDBOX from .env.local is silently dropped", () => {
    const args = buildDockerRunArgs(
      makeOpts({ env: { IS_SANDBOX: "0" } }),
      new Set(),
      HOME,
      "wm-test-123",
      RPC_SECRET,
      RPC_PORT,
    );
    const flags = envFlags(args);
    expect(flags).toContain("IS_SANDBOX=1");
    expect(flags.filter(f => f.startsWith("IS_SANDBOX="))).toHaveLength(1);
  });
});
