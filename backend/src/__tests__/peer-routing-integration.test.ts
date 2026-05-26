import { afterEach, describe, expect, it } from "bun:test";
import { resolvePeerRedirect } from "../domain/peer-routing";
import type { InstanceEntry } from "../adapters/instance-registry";

/** Spin a tiny Bun.serve mirroring the production wiring: peer-redirect
 *  check → fallback to a 200 "ok" SPA stub. Exercises the actual HTTP
 *  surface (status codes, Location header shape, query preservation). */
function startTestServer(peers: InstanceEntry[], selfPort: number): {
  port: number;
  stop: () => void;
} {
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      const redirect = resolvePeerRedirect(url, peers, selfPort);
      if (redirect) return redirect;
      // SPA fallback stub.
      return new Response(`ok ${url.pathname}`, { headers: { "Content-Type": "text/plain" } });
    },
  });
  return {
    port: server.port ?? 0,
    stop: () => { void server.stop(true); },
  };
}

function peer(overrides: Partial<InstanceEntry> = {}): InstanceEntry {
  return {
    prefix: "demo",
    port: 5111,
    projectDir: "/repo/demo",
    pid: process.pid,
    startedAt: Date.now(),
    ...overrides,
  };
}

describe("peer-routing HTTP integration", () => {
  const teardown: Array<() => void> = [];
  afterEach(() => {
    while (teardown.length > 0) teardown.pop()?.();
  });

  it("returns a 302 with Location pointing to the peer port", async () => {
    const PEER_PORT = 12000;
    const { port, stop } = startTestServer([peer({ prefix: "alpha", port: PEER_PORT })], 5111);
    teardown.push(stop);

    const res = await fetch(`http://127.0.0.1:${port}/alpha/foo/bar?x=1&y=2`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(`http://127.0.0.1:${PEER_PORT}/foo/bar?x=1&y=2`);
  });

  it("redirects to the request hostname, not 127.0.0.1, when accessed via a name", async () => {
    const { port, stop } = startTestServer([peer({ prefix: "beta", port: 12001 })], 5111);
    teardown.push(stop);

    const res = await fetch(`http://localhost:${port}/beta`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(`http://localhost:12001/`);
  });

  it("rewrites same-instance prefix and serves the SPA fallback", async () => {
    const { port, stop } = startTestServer([peer({ prefix: "self", port: 0 })], 0);
    teardown.push(stop);

    const res = await fetch(`http://127.0.0.1:${port}/self/deep/link`, { redirect: "manual" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok /deep/link");
  });

  it("passes unknown prefixes through to the SPA fallback (no 404 spam)", async () => {
    const { port, stop } = startTestServer([peer({ prefix: "alpha", port: 12000 })], 5111);
    teardown.push(stop);

    const res = await fetch(`http://127.0.0.1:${port}/unknownproject`, { redirect: "manual" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok /unknownproject");
  });

  it("does not redirect for reserved segments even if a peer registers one", async () => {
    const { port, stop } = startTestServer([peer({ prefix: "api", port: 99999 })], 5111);
    teardown.push(stop);

    const res = await fetch(`http://127.0.0.1:${port}/api/config`, { redirect: "manual" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok /api/config");
  });
});
