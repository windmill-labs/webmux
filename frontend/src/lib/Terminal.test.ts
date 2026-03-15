import { cleanup, render } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTheme } from "./themes";

const { MockFitAddon, MockTerminal } = vi.hoisted(() => {
  class MockFitAddon {
    static instances: MockFitAddon[] = [];

    fit = vi.fn();

    constructor() {
      MockFitAddon.instances.push(this);
    }
  }

  class MockTerminal {
    static instances: MockTerminal[] = [];

    options: { theme?: unknown } = {};
    cols = 80;
    rows = 24;
    modes = { mouseTrackingMode: "none" };
    parser = { registerOscHandler: vi.fn(() => true) };
    loadAddon = vi.fn();
    onSelectionChange = vi.fn();
    attachCustomKeyEventHandler = vi.fn();
    focus = vi.fn();
    writeln = vi.fn();
    write = vi.fn();
    clearSelection = vi.fn();
    dispose = vi.fn();

    constructor(_options: unknown) {
      MockTerminal.instances.push(this);
    }

    open(container: HTMLElement): void {
      const xterm = document.createElement("div");
      xterm.className = "xterm";
      const viewport = document.createElement("div");
      viewport.className = "xterm-viewport";
      xterm.appendChild(viewport);
      container.appendChild(xterm);
    }

    onData(_handler: (data: string) => void): void {}

    getSelection(): string {
      return "";
    }

    hasSelection(): boolean {
      return false;
    }
  }

  return { MockFitAddon, MockTerminal };
});

vi.mock("@xterm/xterm", () => ({ Terminal: MockTerminal }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: MockFitAddon }));
vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: class MockWebLinksAddon {},
}));

import Terminal from "./Terminal.svelte";

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readonly url: string;
  readyState = MockWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string | URL) {
    this.url = String(url);
    MockWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code = 1000, reason = ""): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new CloseEvent("close", { code, reason, wasClean: true }));
  }

  emitOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.(new Event("open"));
  }

  emitClose(code = 1006, reason = ""): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new CloseEvent("close", { code, reason, wasClean: false }));
  }
}

class MockResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

describe("Terminal reconnect", () => {
  let documentHidden = false;

  beforeEach(() => {
    MockTerminal.instances = [];
    MockFitAddon.instances = [];
    MockWebSocket.instances = [];

    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => documentHidden,
    });

    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
    globalThis.ResizeObserver = MockResizeObserver as typeof ResizeObserver;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    }) as typeof requestAnimationFrame;
  });

  afterEach(() => {
    cleanup();
    documentHidden = false;
  });

  it("reconnects immediately after a visible-tab socket close", () => {
    render(Terminal, { props: { worktree: "feature/reconnect", terminalTheme: getTheme("github-dark").terminal } });

    expect(MockWebSocket.instances).toHaveLength(1);
    const firstSocket = MockWebSocket.instances[0]!;
    firstSocket.emitOpen();

    expect(firstSocket.sent).toContain('{"type":"resize","cols":80,"rows":24}');

    firstSocket.emitClose();

    expect(MockWebSocket.instances).toHaveLength(2);
    const secondSocket = MockWebSocket.instances[1]!;
    secondSocket.emitOpen();

    const terminal = MockTerminal.instances[0]!;
    expect(terminal.writeln).toHaveBeenCalledWith("\r\n\x1b[90m[Disconnected]\x1b[0m");
    expect(terminal.writeln).toHaveBeenCalledWith("\r\n\x1b[32m[Reconnected]\x1b[0m");
  });

  it("only retries once automatically for a visible-tab close", () => {
    render(Terminal, { props: { worktree: "feature/retry-once", terminalTheme: getTheme("github-dark").terminal } });

    const firstSocket = MockWebSocket.instances[0]!;
    firstSocket.emitOpen();
    firstSocket.emitClose();

    expect(MockWebSocket.instances).toHaveLength(2);

    const secondSocket = MockWebSocket.instances[1]!;
    secondSocket.emitClose();

    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it("waits for the tab to become visible before reconnecting hidden closes", () => {
    render(Terminal, { props: { worktree: "feature/visible", terminalTheme: getTheme("github-dark").terminal } });

    const firstSocket = MockWebSocket.instances[0]!;
    firstSocket.emitOpen();

    documentHidden = true;
    firstSocket.emitClose();

    expect(MockWebSocket.instances).toHaveLength(1);

    documentHidden = false;
    document.dispatchEvent(new Event("visibilitychange"));

    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it("applies theme updates to the terminal instance", async () => {
    const initialTheme = getTheme("github-dark").terminal;
    const nextTheme = getTheme("github-light").terminal;
    const rendered = render(Terminal, {
      props: {
        worktree: "feature/theme",
        terminalTheme: initialTheme,
      },
    });

    const terminal = MockTerminal.instances[0]!;
    expect(terminal.options.theme).toBe(initialTheme);

    await rendered.rerender({
      worktree: "feature/theme",
      terminalTheme: nextTheme,
    });

    expect(terminal.options.theme).toBe(nextTheme);
  });
});
