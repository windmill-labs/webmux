import { describe, expect, it } from "vitest";
import { fuzzyMatch } from "../lib/utils";

describe("fuzzyMatch", () => {
  it("matches exact substring", () => {
    expect(fuzzyMatch("foo", "foobar")).toBe(true);
  });

  it("matches characters in order but not contiguous", () => {
    expect(fuzzyMatch("fb", "foobar")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(fuzzyMatch("FOO", "foobar")).toBe(true);
    expect(fuzzyMatch("foo", "FOOBAR")).toBe(true);
  });

  it("rejects when characters are out of order", () => {
    expect(fuzzyMatch("bf", "foobar")).toBe(false);
  });

  it("rejects when needle has characters not in haystack", () => {
    expect(fuzzyMatch("fz", "foobar")).toBe(false);
  });

  it("matches empty needle against any haystack", () => {
    expect(fuzzyMatch("", "anything")).toBe(true);
    expect(fuzzyMatch("", "")).toBe(true);
  });

  it("rejects non-empty needle against empty haystack", () => {
    expect(fuzzyMatch("a", "")).toBe(false);
  });
});
