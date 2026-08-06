import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HerdrGateway, isHerdrPaneId, resolveSocketPath } from "../adapters/herdr";
import { parsePaneTarget } from "../adapters/session-gateway";

interface RecordedRequest {
  method: string;
  params: Record<string, unknown>;
}

interface StubSocket {
  socketPath: string;
  requests: RecordedRequest[];
  stop: () => void;
}

/** Stand up a unix socket that speaks herdr's wire protocol: newline-delimited
 *  JSON, one request per connection. `handlers` maps a method to its `result`;
 *  a function may instead return an `error` to exercise failure paths. */
async function startStubHerdr(
  handlers: Record<string, unknown | ((params: Record<string, unknown>) => unknown)>,
): Promise<StubSocket> {
  const dir = await mkdtemp(join(tmpdir(), "webmux-herdr-stub-"));
  const socketPath = join(dir, "herdr.sock");
  const requests: RecordedRequest[] = [];

  const server = Bun.listen({
    unix: socketPath,
    socket: {
      data(socket, chunk) {
        const line = new TextDecoder().decode(chunk).trim();
        if (!line) return;
        const parsed: unknown = JSON.parse(line);
        const { id, method, params } = parsed as { id: string; method: string; params: Record<string, unknown> };
        requests.push({ method, params: params ?? {} });

        const handler = handlers[method];
        const value = typeof handler === "function"
          ? (handler as (p: Record<string, unknown>) => unknown)(params ?? {})
          : handler;

        const payload = value !== null && typeof value === "object" && "error" in (value as object)
          ? { id, error: (value as { error: unknown }).error }
          : { id, result: value ?? { type: "ok" } };
        socket.write(`${JSON.stringify(payload)}\n`);
        socket.flush();
        socket.end();
      },
    },
  });

  return {
    socketPath,
    requests,
    stop: () => {
      server.stop(true);
      void rm(dir, { recursive: true, force: true });
    },
  };
}

const WORKSPACES = {
  type: "workspace_list",
  workspaces: [{ workspace_id: "w1", label: "wm-project-abc123", number: 1 }],
};

const TABS = {
  type: "tab_list",
  tabs: [
    { tab_id: "w1:t1", workspace_id: "w1", label: "wm-feature/search", pane_count: 2 },
    { tab_id: "w1:t2", workspace_id: "w1", label: "wm-feature/search-tabs", pane_count: 1 },
  ],
};

/** Mirrors herdr 0.8.0: `pane.list` ignores its filter params and returns every
 *  pane in the session, grouped by tab. The gateway must filter by `tab_id`
 *  itself — without that, index 0 of "wm-feature/search" resolves to a pane in a
 *  completely different tab. */
const PANES = {
  type: "pane_list",
  panes: [
    { pane_id: "w1:p8", tab_id: "w1:t0", workspace_id: "w1" },
    { pane_id: "w1:p1", tab_id: "w1:t1", workspace_id: "w1" },
    { pane_id: "w1:p2", tab_id: "w1:t1", workspace_id: "w1" },
    { pane_id: "w1:p5", tab_id: "w1:t2", workspace_id: "w1" },
  ],
};

let active: StubSocket | null = null;

async function gatewayWith(
  handlers: Record<string, unknown | ((params: Record<string, unknown>) => unknown)>,
): Promise<{ gateway: HerdrGateway; stub: StubSocket }> {
  const stub = await startStubHerdr(handlers);
  active = stub;
  return { gateway: new HerdrGateway({ HERDR_SOCKET_PATH: stub.socketPath }), stub };
}

afterEach(() => {
  active?.stop();
  active = null;
});

describe("resolveSocketPath", () => {
  it("prefers an explicit socket path", () => {
    expect(resolveSocketPath({ HERDR_SOCKET_PATH: "/tmp/x.sock", HOME: "/home/u" })).toBe("/tmp/x.sock");
  });

  it("scopes named sessions under sessions/<name>", () => {
    expect(resolveSocketPath({ HOME: "/home/u", HERDR_SESSION: "spike" }))
      .toBe("/home/u/.config/herdr/sessions/spike/herdr.sock");
  });

  it("falls back to the default session socket", () => {
    expect(resolveSocketPath({ HOME: "/home/u" })).toBe("/home/u/.config/herdr/herdr.sock");
  });
});

describe("isHerdrPaneId", () => {
  it("recognizes herdr pane handles but not session:window targets", () => {
    expect(isHerdrPaneId("w1:p2")).toBe(true);
    expect(isHerdrPaneId("w12:p34")).toBe(true);
    expect(isHerdrPaneId("wm-project-abc:wm-feature.0")).toBe(false);
    expect(isHerdrPaneId("w1:t1")).toBe(false);
  });
});

describe("parsePaneTarget", () => {
  it("splits a session:window.index target", () => {
    expect(parsePaneTarget("wm-proj-abc:wm-feature.2"))
      .toEqual({ sessionName: "wm-proj-abc", windowName: "wm-feature", paneIndex: 2 });
  });

  it("keeps dots that belong to the branch name", () => {
    // only an all-digit trailing segment is a pane index, so a dotted branch survives
    expect(parsePaneTarget("wm-proj-abc:wm-release-1.2.x"))
      .toEqual({ sessionName: "wm-proj-abc", windowName: "wm-release-1.2.x", paneIndex: null });
  });

  it("still finds the pane index on a dotted branch", () => {
    expect(parsePaneTarget("wm-proj-abc:wm-release-1.2.0"))
      .toEqual({ sessionName: "wm-proj-abc", windowName: "wm-release-1.2", paneIndex: 0 });
  });

  it("treats a window with no pane index as index-less", () => {
    expect(parsePaneTarget("wm-proj-abc:wm-feature"))
      .toEqual({ sessionName: "wm-proj-abc", windowName: "wm-feature", paneIndex: null });
  });

  it("rejects non-targets", () => {
    expect(parsePaneTarget("nocolon")).toBeNull();
    expect(parsePaneTarget(":leading")).toBeNull();
  });
});

describe("HerdrGateway", () => {
  it("matches workspaces and tabs by label, not id", async () => {
    const { gateway } = await gatewayWith({ "workspace.list": WORKSPACES, "tab.list": TABS });

    expect(await gateway.hasWindow("wm-project-abc123", "wm-feature/search")).toBe(true);
    expect(await gateway.hasWindow("wm-project-abc123", "wm-nonexistent")).toBe(false);
    expect(await gateway.hasWindow("wm-other-project", "wm-feature/search")).toBe(false);
  });

  it("does not recreate a workspace that already exists", async () => {
    const { gateway, stub } = await gatewayWith({ "workspace.list": WORKSPACES });

    await gateway.ensureSession("wm-project-abc123", "/repo");

    expect(stub.requests.map((r) => r.method)).toEqual(["workspace.list"]);
  });

  it("creates a workspace labelled with the session name", async () => {
    const { gateway, stub } = await gatewayWith({
      "workspace.list": { type: "workspace_list", workspaces: [] },
      "workspace.create": { type: "workspace_created", workspace: { workspace_id: "w9" } },
    });

    await gateway.ensureSession("wm-new-session", "/repo/path");

    const create = stub.requests.find((r) => r.method === "workspace.create");
    expect(create?.params).toMatchObject({ cwd: "/repo/path", label: "wm-new-session" });
  });

  it("resolves a session:window.index target to the pane at that index", async () => {
    const { gateway } = await gatewayWith({
      "workspace.list": WORKSPACES,
      "tab.list": TABS,
      "pane.list": PANES,
    });

    expect(await gateway.getPaneId("wm-project-abc123:wm-feature/search.1")).toBe("w1:p2");
    expect(await gateway.getPaneId("wm-project-abc123:wm-feature/search.0")).toBe("w1:p1");
  });

  it("ignores panes from other tabs when indexing (pane.list does not filter)", async () => {
    const { gateway } = await gatewayWith({
      "workspace.list": WORKSPACES,
      "tab.list": TABS,
      "pane.list": PANES,
    });

    // w1:p8 sorts first in the raw response but belongs to another tab
    expect(await gateway.getPaneId("wm-project-abc123:wm-feature/search.0")).toBe("w1:p1");
    // the parking tab's own pane, not the first pane in the session
    expect(await gateway.getPaneId("wm-project-abc123:wm-feature/search-tabs.0")).toBe("w1:p5");
  });

  it("passes an opaque pane handle straight through without a lookup", async () => {
    const { gateway, stub } = await gatewayWith({ "pane.send_text": { type: "ok" } });

    await gateway.runCommand("w1:p2", "echo hi");

    expect(stub.requests).toEqual([
      { method: "pane.send_text", params: { pane_id: "w1:p2", text: "echo hi\n" } },
    ]);
  });

  it("submits commands with a trailing newline", async () => {
    const { gateway, stub } = await gatewayWith({ "pane.send_text": { type: "ok" } });

    await gateway.runCommand("w1:p1", "bun test");

    expect(stub.requests[0]?.params.text).toBe("bun test\n");
  });

  it("splits with a ratio derived from sizePct and maps bottom to down", async () => {
    const { gateway, stub } = await gatewayWith({
      "workspace.list": WORKSPACES,
      "tab.list": TABS,
      "pane.list": PANES,
      "pane.split": { type: "pane_info", pane: { pane_id: "w1:p3" } },
      "pane.send_text": { type: "ok" },
    });

    await gateway.splitWindow({
      target: "wm-project-abc123:wm-feature/search.0",
      split: "bottom",
      sizePct: 25,
      cwd: "/repo",
      command: "sh",
    });

    const split = stub.requests.find((r) => r.method === "pane.split");
    expect(split?.params).toMatchObject({ pane_id: "w1:p1", direction: "down", ratio: 0.25, cwd: "/repo" });
    // the new pane, not the split anchor, receives the startup command
    expect(stub.requests.find((r) => r.method === "pane.send_text")?.params.pane_id).toBe("w1:p3");
  });

  it("swaps panes using source/target ids", async () => {
    const { gateway, stub } = await gatewayWith({ "pane.swap": { type: "pane_swap" } });

    await gateway.swapPanes("w1:p1", "w1:p2");

    expect(stub.requests).toEqual([
      { method: "pane.swap", params: { source_pane_id: "w1:p1", target_pane_id: "w1:p2" } },
    ]);
  });

  it("flattens workspaces and tabs into window summaries", async () => {
    const { gateway } = await gatewayWith({ "workspace.list": WORKSPACES, "tab.list": TABS });

    expect(await gateway.listWindows()).toEqual([
      { sessionName: "wm-project-abc123", windowName: "wm-feature/search", paneCount: 2 },
      { sessionName: "wm-project-abc123", windowName: "wm-feature/search-tabs", paneCount: 1 },
    ]);
  });

  it("treats killing an absent window as success", async () => {
    const { gateway, stub } = await gatewayWith({ "workspace.list": WORKSPACES, "tab.list": TABS });

    await gateway.killWindow("wm-project-abc123", "wm-already-gone");

    expect(stub.requests.some((r) => r.method === "tab.close")).toBe(false);
  });

  it("tolerates a not_found when closing a pane that just died", async () => {
    const { gateway } = await gatewayWith({
      "pane.close": { error: { code: "not_found", message: "pane not found" } },
    });

    expect(await gateway.killPane("w1:p7").then(() => "ok")).toBe("ok");
  });

  it("surfaces non-recoverable errors", async () => {
    const { gateway } = await gatewayWith({
      "pane.close": { error: { code: "internal", message: "boom" } },
    });

    expect(gateway.killPane("w1:p7")).rejects.toThrow("boom");
  });

  it("focuses the workspace before the tab", async () => {
    const { gateway, stub } = await gatewayWith({
      "workspace.list": WORKSPACES,
      "tab.list": TABS,
      "workspace.focus": { type: "ok" },
      "tab.focus": { type: "ok" },
    });

    await gateway.focusWindow("wm-project-abc123", "wm-feature/search");

    const focusOrder = stub.requests.map((r) => r.method).filter((m) => m.endsWith(".focus"));
    expect(focusOrder).toEqual(["workspace.focus", "tab.focus"]);
    expect(stub.requests.find((r) => r.method === "tab.focus")?.params).toEqual({ tab_id: "w1:t1" });
  });

  it("splits the last parked pane when the parking tab already exists", async () => {
    const { gateway, stub } = await gatewayWith({
      "workspace.list": WORKSPACES,
      "tab.list": TABS,
      "pane.list": PANES,
      "pane.split": { type: "pane_info", pane: { pane_id: "w1:p9" } },
      "pane.send_text": { type: "ok" },
    });

    const paneId = await gateway.createParkedPane({
      sessionName: "wm-project-abc123",
      parkingWindow: "wm-feature/search-tabs",
      cwd: "/repo/wt",
      command: "start-agent",
    });

    expect(paneId).toBe("w1:p9");
    // anchored on the parking tab's own last pane so parked panes accumulate there
    expect(stub.requests.find((r) => r.method === "pane.split")?.params.pane_id).toBe("w1:p5");
  });
});
