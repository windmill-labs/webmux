import { describe, expect, it } from "bun:test";
import { parseCodexAppServerThreadItem, readCodexAppServerStdoutLines } from "../adapters/codex-app-server";

describe("codex app-server adapter", () => {
  it("decodes split UTF-8 stdout chunks before splitting JSON-RPC lines", () => {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const bytes = encoder.encode("{\"text\":\"hello €\"}\n{\"text\":\"done\"}\n");
    const splitIndex = bytes.findIndex((byte) => byte === 0x82);

    const first = readCodexAppServerStdoutLines({
      decoder,
      buffer: "",
      chunk: bytes.slice(0, splitIndex),
    });
    const second = readCodexAppServerStdoutLines({
      decoder,
      buffer: first.buffer,
      chunk: bytes.slice(splitIndex),
    });

    expect(first.lines).toEqual([]);
    expect(second.lines).toEqual([
      "{\"text\":\"hello €\"}",
      "{\"text\":\"done\"}",
    ]);
  });

  it("flushes a final line without a trailing newline", () => {
    const decoder = new TextDecoder();
    const chunk = new TextEncoder().encode("{\"ok\":true}");

    const first = readCodexAppServerStdoutLines({
      decoder,
      buffer: "",
      chunk,
    });
    const flushed = readCodexAppServerStdoutLines({
      decoder,
      buffer: first.buffer,
    });

    expect(first.lines).toEqual([]);
    expect(flushed).toEqual({
      buffer: "",
      lines: ["{\"ok\":true}"],
    });
  });

  it("parses app-server tool thread items", () => {
    expect(parseCodexAppServerThreadItem({
      type: "mcpToolCall",
      id: "mcp-1",
      server: "linear",
      tool: "get_issue",
      status: "completed",
      arguments: { issueId: "ENG-123" },
      pluginId: null,
      result: {
        content: [{ type: "text", text: "Issue title" }],
        structuredContent: null,
        _meta: null,
      },
      error: null,
      durationMs: 25,
    })?.type).toBe("mcpToolCall");

    expect(parseCodexAppServerThreadItem({
      type: "fileChange",
      id: "patch-1",
      status: "completed",
      changes: [
        {
          path: "README.md",
          kind: { type: "update", move_path: null },
          diff: "--- a/README.md\n+++ b/README.md\n",
        },
      ],
    })?.type).toBe("fileChange");
  });
});
