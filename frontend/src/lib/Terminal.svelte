<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { Terminal } from "@xterm/xterm";
  import { FitAddon } from "@xterm/addon-fit";
  import { WebLinksAddon } from "@xterm/addon-web-links";
  import "@xterm/xterm/css/xterm.css";

  let { worktree, isMobile = false, initialPane }: {
    worktree: string;
    isMobile?: boolean;
    initialPane?: number;
  } = $props();

  const DISCONNECTED_NOTICE = "\r\n\x1b[90m[Disconnected]\x1b[0m";
  const RECONNECTED_NOTICE = "\r\n\x1b[32m[Reconnected]\x1b[0m";
  let containerEl: HTMLDivElement;
  let term: Terminal;
  let fitAddon: FitAddon;
  let ws: WebSocket | null = null;
  let resizeObs: ResizeObserver;
  let resizeTimer: ReturnType<typeof setTimeout>;
  let xtermEl: HTMLElement | null = null;
  let viewportEl: HTMLElement | null = null;
  let manualTouchCleanup: (() => void) | null = null;
  let lastTouchX = 0;
  let lastTouchY = 0;
  let touchScrollLocked = false;
  let destroyed = false;

  function copyToClipboard(text: string): void {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
      return;
    }
    // Fallback for non-secure contexts (HTTP on non-localhost)
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }

  export function sendSelectPane(pane: number) {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "selectPane", pane }));
    }
  }

  export function sendInput(data: string) {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "input", data }));
    }
  }

  function handleTouchGestureEnd(): void {
    touchScrollLocked = false;
  }

  function shouldUseManualTouchScroll(): boolean {
    return isMobile && !!viewportEl && term.modes.mouseTrackingMode !== "none";
  }

  function handleManualTouchStart(event: TouchEvent): void {
    if (!shouldUseManualTouchScroll()) return;
    const touch = event.touches[0];
    if (!touch) return;
    lastTouchX = touch.pageX;
    lastTouchY = touch.pageY;
    touchScrollLocked = false;
  }

  function handleManualTouchMove(event: TouchEvent): void {
    const touch = event.touches[0];
    if (!shouldUseManualTouchScroll() || !viewportEl || !touch) return;

    const deltaX = lastTouchX - touch.pageX;
    const deltaY = lastTouchY - touch.pageY;
    lastTouchX = touch.pageX;
    lastTouchY = touch.pageY;

    if (!touchScrollLocked) {
      if (Math.abs(deltaY) <= Math.abs(deltaX)) return;
      touchScrollLocked = true;
    }
    if (deltaY === 0) return;

    const canScrollViewport = viewportEl.scrollHeight > viewportEl.clientHeight;
    if (!canScrollViewport) {
      dispatchSyntheticWheel(deltaY, touch);
      event.preventDefault();
      return;
    }

    viewportEl.scrollTop += deltaY;
    // Keep the swipe owned by the terminal so the app shell never steals it at the top/bottom edge.
    event.preventDefault();
  }

  function dispatchSyntheticWheel(deltaY: number, touch: Touch): void {
    if (!xtermEl) return;

    const wheelEvent = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: touch.clientX,
      clientY: touch.clientY,
      deltaMode: WheelEvent.DOM_DELTA_PIXEL,
      deltaY,
    });
    xtermEl.dispatchEvent(wheelEvent);
  }

  function attachManualTouchScroll(): void {
    const nextXtermEl = containerEl.querySelector(".xterm");
    const nextViewportEl = containerEl.querySelector(".xterm-viewport");
    if (!(nextXtermEl instanceof HTMLElement) || !(nextViewportEl instanceof HTMLElement)) return;

    xtermEl = nextXtermEl;
    viewportEl = nextViewportEl;
    nextXtermEl.addEventListener("touchstart", handleManualTouchStart, { passive: true });
    nextXtermEl.addEventListener("touchmove", handleManualTouchMove, { passive: false });
    nextXtermEl.addEventListener("touchend", handleTouchGestureEnd);
    nextXtermEl.addEventListener("touchcancel", handleTouchGestureEnd);
    manualTouchCleanup = () => {
      nextXtermEl.removeEventListener("touchstart", handleManualTouchStart);
      nextXtermEl.removeEventListener("touchmove", handleManualTouchMove);
      nextXtermEl.removeEventListener("touchend", handleTouchGestureEnd);
      nextXtermEl.removeEventListener("touchcancel", handleTouchGestureEnd);
      xtermEl = null;
      viewportEl = null;
    };
  }

  function buildResizeMessage(): string {
    const msg: Record<string, unknown> = { type: "resize", cols: term.cols, rows: term.rows };
    if (isMobile && initialPane !== undefined) {
      msg.initialPane = initialPane;
    }
    return JSON.stringify(msg);
  }

  function connect(announceReconnect = false): void {
    if (destroyed || ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) return;
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const nextWs = new WebSocket(`${protocol}//${location.host}/ws/${encodeURIComponent(worktree)}`);
    ws = nextWs;

    nextWs.onmessage = (event) => {
      const raw = event.data as string;
      const prefix = raw[0];
      if (prefix === "o" || prefix === "s") {
        term.write(raw.slice(1));
        return;
      }
      try {
        const msg = JSON.parse(raw);
        switch (msg.type) {
          case "exit":
            term.writeln(`\r\n\x1b[33m[Process exited with code ${msg.exitCode}]\x1b[0m`);
            break;
          case "error":
            term.writeln(`\r\n\x1b[31m[Error: ${msg.message}]\x1b[0m`);
            break;
        }
      } catch {
        // Ignore malformed messages
      }
    };

    nextWs.onopen = () => {
      if (ws !== nextWs) return;
      fitAddon.fit();
      if (announceReconnect) {
        term.writeln(RECONNECTED_NOTICE);
      }
      requestAnimationFrame(() => {
        fitAddon.fit();
        term.focus();
      });
      nextWs.send(buildResizeMessage());
    };

    nextWs.onclose = () => {
      if (ws !== nextWs) return;
      ws = null;
      if (destroyed) return;
      term.writeln(DISCONNECTED_NOTICE);
    };
  }

  function reconnectIfNeeded(): void {
    if (document.hidden) return;
    connect(true);
  }

  onMount(() => {
    term = new Terminal({
      cursorBlink: true,
      theme: {
        background: "#0d1117",
        foreground: "#e6edf3",
        cursor: "#58a6ff",
        selectionBackground: "#264f78",
      },
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
      fontSize: isMobile ? 13 : 11,
      scrollback: 10000,
    });

    fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(containerEl);
    attachManualTouchScroll();

    // Prevent browser context menu so tmux right-click works unobstructed
    containerEl.addEventListener("contextmenu", (e) => e.preventDefault());

    // Handle OSC 52 sequences from tmux → write to system clipboard
    term.parser.registerOscHandler(52, (data) => {
      const idx = data.indexOf(";");
      if (idx !== -1) {
        const b64 = data.slice(idx + 1);
        try {
          copyToClipboard(atob(b64));
        } catch {}
      }
      return true;
    });

    // Auto-copy on xterm.js selection (e.g. when user Shift+drags to bypass tmux mouse)
    term.onSelectionChange(() => {
      const sel = term.getSelection();
      if (sel) {
        copyToClipboard(sel);
      }
    });

    // Let app-level shortcuts (Cmd+Arrow, Cmd+K, Cmd+M, Cmd+D) bubble up
    // instead of being consumed by xterm.  Return false → xterm ignores the event.
    term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      // Shift+Enter: send CSI u escape sequence so apps like Claude Code
      // can distinguish it from plain Enter (xterm.js sends \r for both).
      // Block all event types (keydown, keypress, keyup) to prevent xterm
      // from also emitting \r on the keypress phase.
      if (e.key === "Enter" && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.type === "keydown" && ws?.readyState === WebSocket.OPEN) {
          // CSI u for Shift+Enter: \x1b[13;2u = hex 1b 5b 31 33 3b 32 75
          // Use sendKeys (tmux send-keys -H) to bypass tmux's input parser
          ws.send(JSON.stringify({ type: "sendKeys", hexBytes: ["1b", "5b", "31", "33", "3b", "32", "75"] }));
        }
        return false;
      }

      if (e.type !== "keydown") return true;

      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === "c" || e.key === "C")) {
        if (term.hasSelection()) {
          copyToClipboard(term.getSelection());
          term.clearSelection();
          return false;
        }
        return true;
      }
      if (mod && (e.key === "ArrowUp" || e.key === "ArrowDown")) return false;
      if (mod && (e.key === "k" || e.key === "K")) return false;
      if (mod && (e.key === "m" || e.key === "M")) return false;
      if (mod && (e.key === "d" || e.key === "D")) return false;
      return true;
    });

    requestAnimationFrame(() => {
      fitAddon.fit();
      term.focus();
    });

    connect();

    term.onData((data) => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data }));
      }
    });

    resizeObs = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        fitAddon.fit();
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        }
      }, 150);
    });
    resizeObs.observe(containerEl);

    document.addEventListener("visibilitychange", reconnectIfNeeded);
    window.addEventListener("focus", reconnectIfNeeded);
    window.addEventListener("online", reconnectIfNeeded);
  });

  onDestroy(() => {
    destroyed = true;
    clearTimeout(resizeTimer);
    manualTouchCleanup?.();
    resizeObs?.disconnect();
    document.removeEventListener("visibilitychange", reconnectIfNeeded);
    window.removeEventListener("focus", reconnectIfNeeded);
    window.removeEventListener("online", reconnectIfNeeded);
    ws?.close();
    term?.dispose();
  });
</script>

<div class="flex-1 min-h-0 w-full p-1 overflow-hidden" bind:this={containerEl}></div>
