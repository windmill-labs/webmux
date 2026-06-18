import { describe, expect, test } from "bun:test";
import { formatServerError } from "./shared";

describe("formatServerError", () => {
  test("passes HTTP errors through untouched", () => {
    expect(formatServerError(new Error("HTTP 404: not found"), 5111)).toBe("HTTP 404: not found");
  });

  test("translates legacy 'fetch failed' connection errors", () => {
    expect(formatServerError(new Error("fetch failed"), 5111)).toBe(
      "Could not connect to webmux server on port 5111. Is it running?",
    );
  });

  test("translates Bun's connection-refused message", () => {
    // Bun throws this exact message (code ConnectionRefused) when nothing is
    // listening on the port — e.g. `webmux oneshot` with no `webmux serve`.
    const err = new Error("Unable to connect. Is the computer able to access the url?");
    expect(formatServerError(err, 5111)).toBe(
      "Could not connect to webmux server on port 5111. Is it running?",
    );
  });

  test("leaves unrelated errors untouched", () => {
    expect(formatServerError(new Error("Linear team not found"), 5111)).toBe("Linear team not found");
  });
});
