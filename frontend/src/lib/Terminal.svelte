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

  let containerEl: HTMLDivElement;
  let term: Terminal;
  let fitAddon: FitAddon;
  let ws: WebSocket;
  let resizeObs: ResizeObserver;
  let resizeTimer: ReturnType<typeof setTimeout>;

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

    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(`${protocol}//${location.host}/ws/${encodeURIComponent(worktree)}`);

    ws.onmessage = (event) => {
      const raw = event.data as string;
      // Hot-path: prefix-based protocol for output ("o") and scrollback ("s")
      const prefix = raw[0];
      if (prefix === "o" || prefix === "s") {
        term.write(raw.slice(1));
        return;
      }
      // Infrequent control messages use JSON
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

    ws.onopen = () => {
      fitAddon.fit();
      const msg: Record<string, unknown> = { type: "resize", cols: term.cols, rows: term.rows };
      if (isMobile && initialPane !== undefined) {
        msg.initialPane = initialPane;
      }
      ws.send(JSON.stringify(msg));
    };

    ws.onclose = () => {
      term.writeln("\r\n\x1b[90m[Disconnected]\x1b[0m");
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data }));
      }
    });

    resizeObs = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        fitAddon.fit();
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        }
      }, 150);
    });
    resizeObs.observe(containerEl);
  });

  onDestroy(() => {
    clearTimeout(resizeTimer);
    resizeObs?.disconnect();
    ws?.close();
    term?.dispose();
  });
</script>

<div class="flex-1 min-h-0 w-full p-1 overflow-hidden" bind:this={containerEl}></div>
