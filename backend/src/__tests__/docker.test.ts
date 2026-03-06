import { describe, expect, it } from "bun:test";
import { buildDockerRunArgs, type LaunchContainerOpts } from "../adapters/docker";
import type { DockerProfileConfig } from "../adapters/config";

const HOME = "/home/testuser";
const UID = 1000;
const GID = 1000;

/** Minimal valid opts; individual tests override what they need. */
function makeDockerProfile(overrides: Partial<DockerProfileConfig> = {}): DockerProfileConfig {
  return {
    runtime: "docker",
    image: "my-image:latest",
    envPassthrough: [],
    panes: [],
    ...overrides,
  };
}

function makeOpts(overrides: Partial<LaunchContainerOpts> = {}): LaunchContainerOpts {
  return {
    branch: "my-branch",
    wtDir: "/repos/my-branch",
    mainRepoDir: "/repos/main",
    sandboxConfig: makeDockerProfile(),
    services: [],
    runtimeEnv: {},
    ...overrides,
  };
}

/** Shorthand: call buildDockerRunArgs with test defaults for the trailing params. */
function build(
  opts: LaunchContainerOpts,
  existingPaths = new Set<string>(),
  sshAuthSock?: string,
): string[] {
  return buildDockerRunArgs(opts, existingPaths, HOME, "wm-test-123", sshAuthSock, UID, GID);
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
// --user flag
// ---------------------------------------------------------------------------

describe("buildDockerRunArgs — host user mapping", () => {
  it("passes --user with host UID:GID", () => {
    const args = build(makeOpts());
    const idx = args.indexOf("--user");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe(`${UID}:${GID}`);
  });
});

// ---------------------------------------------------------------------------
// extraMounts
// ---------------------------------------------------------------------------

describe("buildDockerRunArgs — extraMounts", () => {
  it("adds a read-only mount when writable is false", () => {
    const args = build(makeOpts({ sandboxConfig: makeDockerProfile({ image: "img", mounts: [
      { hostPath: "/data/shared", guestPath: "/mnt/shared", writable: false },
    ] }) }));
    expect(mounts(args)).toContain("/data/shared:/mnt/shared:ro");
  });

  it("adds a writable mount when writable is true", () => {
    const args = build(makeOpts({ sandboxConfig: makeDockerProfile({ image: "img", mounts: [
      { hostPath: "/data/shared", guestPath: "/mnt/shared", writable: true },
    ] }) }));
    expect(mounts(args)).toContain("/data/shared:/mnt/shared");
    expect(mounts(args)).not.toContain("/data/shared:/mnt/shared:ro");
  });

  it("defaults to read-only when writable is omitted", () => {
    const args = build(makeOpts({ sandboxConfig: makeDockerProfile({ image: "img", mounts: [
      { hostPath: "/data/shared", guestPath: "/mnt/shared" },
    ] }) }));
    expect(mounts(args)).toContain("/data/shared:/mnt/shared:ro");
  });

  it("uses hostPath as guestPath when guestPath is omitted", () => {
    const args = build(makeOpts({ sandboxConfig: makeDockerProfile({ image: "img", mounts: [
      { hostPath: "/data/shared" },
    ] }) }));
    expect(mounts(args)).toContain("/data/shared:/data/shared:ro");
  });

  it("expands ~ to the home directory", () => {
    const args = build(makeOpts({ sandboxConfig: makeDockerProfile({ image: "img", mounts: [
      { hostPath: "~/projects", guestPath: "/root/projects" },
    ] }) }));
    expect(mounts(args)).toContain(`${HOME}/projects:/root/projects:ro`);
  });

  it("skips mounts with non-absolute paths after ~ expansion", () => {
    const args = build(makeOpts({ sandboxConfig: makeDockerProfile({ image: "img", mounts: [
      { hostPath: "relative/path", guestPath: "/mnt/data" },
    ] }) }));
    expect(mounts(args).join("\n")).not.toContain("/mnt/data");
  });

  it("includes multiple extra mounts in order", () => {
    const args = build(makeOpts({ sandboxConfig: makeDockerProfile({ image: "img", mounts: [
      { hostPath: "/data/a", guestPath: "/mnt/a", writable: true },
      { hostPath: "/data/b", guestPath: "/mnt/b" },
    ] }) }));
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
    const existingPaths = new Set([`${HOME}/.ssh`]);
    const args = build(
      makeOpts({ sandboxConfig: makeDockerProfile({ image: "img", mounts: [
        { hostPath: "~/.ssh", guestPath: "/root/.ssh", writable: true },
      ] }) }),
      existingPaths,
    );
    const m = mounts(args);
    expect(m).toContain(`${HOME}/.ssh:/root/.ssh`);
    expect(m).not.toContain(`${HOME}/.ssh:/root/.ssh:ro`);
  });

  it("config ~/.ssh read-only still suppresses the credential mount (config controls it)", () => {
    const existingPaths = new Set([`${HOME}/.ssh`]);
    const args = build(
      makeOpts({ sandboxConfig: makeDockerProfile({ image: "img", mounts: [
        { hostPath: "~/.ssh", guestPath: "/root/.ssh", writable: false },
      ] }) }),
      existingPaths,
    );
    const m = mounts(args);
    const sshMounts = m.filter(v => v.includes("/root/.ssh"));
    expect(sshMounts).toHaveLength(1);
    expect(sshMounts[0]).toBe(`${HOME}/.ssh:/root/.ssh:ro`);
  });

  it("config ~/.gitconfig override does not affect unrelated credential mounts", () => {
    const existingPaths = new Set([`${HOME}/.gitconfig`, `${HOME}/.ssh`]);
    const args = build(
      makeOpts({ sandboxConfig: makeDockerProfile({ image: "img", mounts: [
        { hostPath: "~/.gitconfig", guestPath: "/root/.gitconfig", writable: true },
      ] }) }),
      existingPaths,
    );
    const m = mounts(args);
    expect(m).toContain(`${HOME}/.gitconfig:/root/.gitconfig`);
    expect(m).not.toContain(`${HOME}/.gitconfig:/root/.gitconfig:ro`);
    expect(m).toContain(`${HOME}/.ssh:/root/.ssh:ro`);
  });

  it("credential mounts are included normally when there are no extraMounts", () => {
    const existingPaths = new Set([`${HOME}/.gitconfig`, `${HOME}/.ssh`]);
    const args = build(makeOpts(), existingPaths);
    const m = mounts(args);
    expect(m).toContain(`${HOME}/.gitconfig:/root/.gitconfig:ro`);
    expect(m).toContain(`${HOME}/.ssh:/root/.ssh:ro`);
  });

  it("credential mounts are omitted for paths that do not exist on the host", () => {
    const args = build(makeOpts());
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
    const args = build(makeOpts({
      services: [{ name: "web", portEnv: "PORT" }],
      runtimeEnv: { PORT: "3000" },
    }));
    expect(ports(args)).toContain("127.0.0.1:3000:3000");
  });

  it("skips ports with non-numeric values", () => {
    const args = build(makeOpts({
      services: [{ name: "web", portEnv: "PORT" }],
      runtimeEnv: { PORT: "auto" },
    }));
    expect(ports(args)).toHaveLength(0);
  });

  it("deduplicates ports that appear more than once", () => {
    const args = build(makeOpts({
      services: [
        { name: "web", portEnv: "PORT" },
        { name: "api", portEnv: "API_PORT" },
      ],
      runtimeEnv: { PORT: "3000", API_PORT: "3000" },
    }));
    expect(ports(args).filter(p => p.startsWith("127.0.0.1:3000"))).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Reserved env var protection
// ---------------------------------------------------------------------------

describe("buildDockerRunArgs — reserved env vars", () => {
  it("HOME from runtime env does not override the hardcoded HOME=/root", () => {
    const args = build(makeOpts({ runtimeEnv: { HOME: "/attacker" } }));
    const flags = envFlags(args);
    expect(flags).toContain("HOME=/root");
    expect(flags).not.toContain("HOME=/attacker");
  });

  it("IS_SANDBOX from runtime env is silently dropped", () => {
    const args = build(makeOpts({ runtimeEnv: { IS_SANDBOX: "0" } }));
    const flags = envFlags(args);
    expect(flags).toContain("IS_SANDBOX=1");
    expect(flags.filter(f => f.startsWith("IS_SANDBOX="))).toHaveLength(1);
  });

  it("does not inject legacy workmux rpc env vars", () => {
    const flags = envFlags(build(makeOpts()));
    expect(flags.some((flag) => flag.startsWith("WORKMUX_RPC_"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SSH agent forwarding
// ---------------------------------------------------------------------------

describe("buildDockerRunArgs — SSH agent forwarding", () => {
  const SOCK = "/run/user/1000/keyring/ssh";

  it("mounts the socket via --mount and sets SSH_AUTH_SOCK when present", () => {
    const args = build(makeOpts(), new Set([SOCK]), SOCK);
    expect(args).toContain(`type=bind,source=${SOCK},target=${SOCK}`);
    expect(envFlags(args)).toContain(`SSH_AUTH_SOCK=${SOCK}`);
  });

  it("does nothing when sshAuthSock is undefined", () => {
    const args = build(makeOpts(), new Set(), undefined);
    expect(mounts(args).join("\n")).not.toContain("SSH_AUTH_SOCK");
    expect(envFlags(args).join("\n")).not.toContain("SSH_AUTH_SOCK");
  });

  it("does nothing when socket path is not in existingPaths", () => {
    const args = build(makeOpts(), new Set(), SOCK);
    expect(mounts(args).join("\n")).not.toContain(SOCK);
    expect(envFlags(args).join("\n")).not.toContain("SSH_AUTH_SOCK");
  });

  it("SSH_AUTH_SOCK from envPassthrough is blocked by reservedKeys", () => {
    const args = build(makeOpts({ sandboxConfig: makeDockerProfile({ image: "img", envPassthrough: ["SSH_AUTH_SOCK"] }) }));
    expect(envFlags(args).filter(f => f.startsWith("SSH_AUTH_SOCK="))).toHaveLength(0);
  });
});
