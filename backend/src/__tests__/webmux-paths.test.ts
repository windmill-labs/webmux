import { afterEach, describe, expect, it } from "bun:test";
import { webmuxConfigDir, webmuxConfigEnvPath } from "../adapters/webmux-paths";

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
