import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `apiBase` is derived from `window.location.pathname` at module load, so each
 * case sets the URL and re-imports `api.ts` fresh. Regression guard for the
 * notifications SSE + file-upload calls, which must be scoped under the active
 * project's `/<prefix>` like every other request — otherwise they fall through
 * to the hub and get `index.html` back instead of the real endpoint.
 */
async function loadApiAt(pathname: string): Promise<typeof import("./api")> {
  window.history.replaceState({}, "", pathname);
  vi.resetModules();
  return import("./api");
}

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe("project-prefixed network calls", () => {
  it("derives apiBase from the first path segment", async () => {
    expect((await loadApiAt("/myproject/")).apiBase).toBe("/myproject");
    expect((await loadApiAt("/")).apiBase).toBe("");
  });

  it("subscribeNotifications opens the SSE stream under the active prefix", async () => {
    const urls: string[] = [];
    class MockEventSource {
      constructor(url: string) {
        urls.push(url);
      }
      addEventListener(): void {}
      close(): void {}
    }
    vi.stubGlobal("EventSource", MockEventSource);

    const api = await loadApiAt("/myproject/");
    api.subscribeNotifications(
      () => {},
      () => {},
    );

    expect(urls).toEqual(["/myproject/api/notifications/stream"]);
  });

  it("uploadFiles posts under the active prefix", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ uploaded: [], dir: "x" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const api = await loadApiAt("/myproject/");
    await api.uploadFiles("feat/x", [new File(["a"], "a.txt")]);

    expect(fetchMock).toHaveBeenCalledWith(
      "/myproject/api/worktrees/feat%2Fx/upload",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
