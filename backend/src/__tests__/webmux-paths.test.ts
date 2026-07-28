import { afterEach, describe, expect, it } from "bun:test";
import {
  resolveRuntimeStateDir,
  webmuxConfigDir,
  webmuxConfigEnvPath,
} from "../adapters/webmux-paths";

const originalHome = Bun.env.HOME;

afterEach(() => {
  if (originalHome === undefined) delete Bun.env.HOME;
  else Bun.env.HOME = originalHome;
});

describe("webmuxConfigDir", () => {
  it("resolves the XDG config dir under $HOME", () => {
    Bun.env.HOME = "/home/alice";
    expect(webmuxConfigDir()).toBe("/home/alice/.config/webmux");
  });

  it("falls back to /root when HOME is unset", () => {
    delete Bun.env.HOME;
    expect(webmuxConfigDir()).toBe("/root/.config/webmux");
  });
});

describe("webmuxConfigEnvPath", () => {
  it("points at .env inside the config dir", () => {
    Bun.env.HOME = "/home/alice";
    expect(webmuxConfigEnvPath()).toBe("/home/alice/.config/webmux/.env");
  });
});

describe("resolveRuntimeStateDir", () => {
  it("keeps production state in the existing home directory", () => {
    expect(resolveRuntimeStateDir({
      homeDir: "/home/user",
      tempDir: "/tmp",
      projectDir: "/repo/alpha",
      isolatedDev: false,
    })).toBe("/home/user/.webmux");
  });

  it("gives each development worktree a stable isolated directory", () => {
    const alpha = resolveRuntimeStateDir({
      homeDir: "/home/user",
      tempDir: "/tmp",
      projectDir: "/repo/alpha",
      isolatedDev: true,
    });
    const sameAlpha = resolveRuntimeStateDir({
      homeDir: "/another/home",
      tempDir: "/tmp",
      projectDir: "/repo/alpha",
      isolatedDev: true,
    });
    const beta = resolveRuntimeStateDir({
      homeDir: "/home/user",
      tempDir: "/tmp",
      projectDir: "/repo/beta",
      isolatedDev: true,
    });

    expect(alpha).toBe(sameAlpha);
    expect(alpha.startsWith("/tmp/webmux-dev/")).toBe(true);
    expect(beta.startsWith("/tmp/webmux-dev/")).toBe(true);
    expect(alpha).not.toBe(beta);
  });
});
