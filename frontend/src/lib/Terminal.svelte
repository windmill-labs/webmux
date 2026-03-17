<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { Terminal } from "@xterm/xterm";
  import type { ITheme } from "@xterm/xterm";
  import { FitAddon } from "@xterm/addon-fit";
  import { WebLinksAddon } from "@xterm/addon-web-links";
  import { uploadFiles } from "./api";
  import "@xterm/xterm/css/xterm.css";

  let { worktree, isMobile = false, initialPane, terminalTheme }: {
    worktree: string;
    isMobile?: boolean;
    initialPane?: number;
    terminalTheme: ITheme;
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
  let canRetryVisibleClose = true;
  let isDraggingOver = $state(false);
  let dragCounter = 0;

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

  function hasDragFiles(dt: DataTransfer | null): boolean {
    if (!dt) return false;
    // During dragenter/dragover, browsers hide file details for security.
    // We can only check if "Files" is among the drag types.
    // For cross-browser images dragged from webpages, also accept uri-list.
    return dt.types.includes("Files") || dt.types.includes("text/uri-list");
  }

  function handleDragEnter(e: DragEvent): void {
    if (!hasDragFiles(e.dataTransfer)) return;
    e.preventDefault();
    dragCounter++;
    isDraggingOver = true;
  }

  function handleDragOver(e: DragEvent): void {
    if (!isDraggingOver) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  }

  function handleDragLeave(_e: DragEvent): void {
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      isDraggingOver = false;
    }
  }

  function extractImageUrlFromHtml(html: string): string | null {
    const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
    return match ? match[1] : null;
  }

  async function handleDrop(e: DragEvent): Promise<void> {
    e.preventDefault();
    e.stopPropagation();
    dragCounter = 0;
    isDraggingOver = false;

    const dt = e.dataTransfer;
    if (!dt) return;

    let files: File[] = Array.from(dt.files).filter((f) => f.type.startsWith("image/"));

    // If no direct files, try to extract an image from dropped HTML (browser image drag)
    if (files.length === 0) {
      const html = dt.getData("text/html");
      const uri = dt.getData("text/uri-list");
      const imageUrl = (html ? extractImageUrlFromHtml(html) : null) ?? uri;

      if (imageUrl) {
        try {
          const dataMatch = imageUrl.match(/^data:(image\/[^;]+);base64,(.+)/);
          if (dataMatch) {
            const byteString = atob(dataMatch[2]);
            const bytes = new Uint8Array(byteString.length);
            for (let i = 0; i < byteString.length; i++) bytes[i] = byteString.charCodeAt(i);
            const ext = dataMatch[1].split("/")[1]?.replace("+xml", "") || "png";
            files = [new File([bytes], `image.${ext}`, { type: dataMatch[1] })];
          } else if (/^https?:\/\//i.test(imageUrl)) {
            const resp = await fetch(imageUrl);
            const contentType = resp.headers.get("content-type") ?? "";
            if (contentType.startsWith("image/")) {
              const blob = await resp.blob();
              const name = imageUrl.split("/").pop()?.split("?")[0]?.split("#")[0] || "image.png";
              files = [new File([blob], name, { type: blob.type })];
            }
          }
        } catch { /* ignore fetch/decode errors for browser drags */ }
      }
    }

    if (files.length === 0) return;
    await uploadAndTypeFiles(files);
  }

  async function uploadAndTypeFiles(files: File[]): Promise<void> {
    try {
      const result = await uploadFiles(worktree, files);
      const paths = result.files.map((f) => f.path).join(" ");
      sendInput(paths);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      term.writeln(`\r\n\x1b[31m[Upload error: ${msg}]\x1b[0m`);
    }
  }

  function handlePaste(e: Event): void {
    const clipboard = (e as ClipboardEvent).clipboardData;
    if (!clipboard) return;

    const imageFiles: File[] = [];
    for (const item of clipboard.items) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length === 0) return;

    // Prevent xterm from handling the paste as text
    e.preventDefault();
    e.stopPropagation();
    uploadAndTypeFiles(imageFiles);
  }

  function buildResizeMessage(): string {
    const msg = {
      type: "resize" as const,
      cols: term.cols,
      rows: term.rows,
      ...(isMobile && initialPane !== undefined ? { initialPane } : {}),
    };
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

    nextWs.onerror = () => {};

    nextWs.onopen = () => {
      if (ws !== nextWs) return;
      canRetryVisibleClose = true;
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
      if (!document.hidden && canRetryVisibleClose) {
        canRetryVisibleClose = false;
        connect(true);
      }
    };
  }

  function reconnectIfNeeded(): void {
    if (document.hidden) return;
    connect(true);
  }

  onMount(() => {
    term = new Terminal({
      cursorBlink: true,
      theme: terminalTheme,
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

    // Upload pasted images instead of inserting clipboard text
    containerEl.addEventListener("paste", handlePaste);

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

  $effect(() => {
    if (terminalTheme && term) {
      term.options.theme = terminalTheme;
    }
  });

  onDestroy(() => {
    destroyed = true;
    clearTimeout(resizeTimer);
    manualTouchCleanup?.();
    resizeObs?.disconnect();
    containerEl?.removeEventListener("paste", handlePaste);
    document.removeEventListener("visibilitychange", reconnectIfNeeded);
    window.removeEventListener("focus", reconnectIfNeeded);
    window.removeEventListener("online", reconnectIfNeeded);
    ws?.close();
    term?.dispose();
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="flex-1 min-h-0 w-full p-1 overflow-hidden relative"
  bind:this={containerEl}
  ondragenter={handleDragEnter}
  ondragover={handleDragOver}
  ondragleave={handleDragLeave}
  ondrop={handleDrop}
>
  {#if isDraggingOver}
    <div class="absolute inset-0 z-10 flex items-center justify-center bg-black/50 border-2 border-dashed border-[var(--color-accent)] rounded pointer-events-none">
      <span class="text-white text-sm font-medium">Drop image(s) to upload</span>
    </div>
  {/if}
</div>
