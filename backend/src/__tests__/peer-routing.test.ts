import { describe, expect, it } from "bun:test";
import { decidePeerRouting } from "../domain/peer-routing";
import type { InstanceEntry } from "../adapters/instance-registry";

function peer(overrides: Partial<InstanceEntry> = {}): InstanceEntry {
  return {
    prefix: "demo",
    port: 5111,
    projectDir: "/repo/demo",
    pid: 123,
    startedAt: 1,
    ...overrides,
  };
}

describe("decidePeerRouting", () => {
  it("passes through when there is no recognizable prefix segment", () => {
    expect(decidePeerRouting("/", [peer()], 9999).kind).toBe("passthrough");
    expect(decidePeerRouting("", [peer()], 9999).kind).toBe("passthrough");
    expect(decidePeerRouting("/Some-Caps", [peer()], 9999).kind).toBe("passthrough");
  });

  it("passes through reserved segments", () => {
    expect(decidePeerRouting("/api/config", [peer({ prefix: "api" })], 9999).kind).toBe("passthrough");
    expect(decidePeerRouting("/ws/anything", [peer({ prefix: "ws" })], 9999).kind).toBe("passthrough");
    expect(decidePeerRouting("/assets/foo.js", [peer({ prefix: "assets" })], 9999).kind).toBe("passthrough");
  });

  it("passes through when the prefix is not in the registry", () => {
    const peers = [peer({ prefix: "alpha", port: 5111 })];
    expect(decidePeerRouting("/beta", peers, 5111).kind).toBe("passthrough");
    expect(decidePeerRouting("/beta/whatever", peers, 5111).kind).toBe("passthrough");
  });

  it("redirects to the peer's port when the prefix matches a different instance", () => {
    const peers = [peer({ prefix: "windmill", port: 5112 })];
    expect(decidePeerRouting("/windmill", peers, 5111)).toEqual({
      kind: "redirect",
      port: 5112,
      path: "/",
    });
    expect(decidePeerRouting("/windmill/foo/bar", peers, 5111)).toEqual({
      kind: "redirect",
      port: 5112,
      path: "/foo/bar",
    });
  });

  it("rewrites in place when the matching peer is this instance", () => {
    const peers = [peer({ prefix: "webmux", port: 5111 })];
    expect(decidePeerRouting("/webmux", peers, 5111)).toEqual({
      kind: "rewrite",
      path: "/",
    });
    expect(decidePeerRouting("/webmux/deep/link", peers, 5111)).toEqual({
      kind: "rewrite",
      path: "/deep/link",
    });
  });

  it("preserves trailing path segments and ignores query (caller appends it)", () => {
    const peers = [peer({ prefix: "wm", port: 5113 })];
    expect(decidePeerRouting("/wm/x/y/z", peers, 5111)).toEqual({
      kind: "redirect",
      port: 5113,
      path: "/x/y/z",
    });
  });
});
