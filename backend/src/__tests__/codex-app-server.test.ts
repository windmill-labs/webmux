import { describe, expect, it } from "bun:test";
import { readCodexAppServerStdoutLines } from "../adapters/codex-app-server";

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
});
