import { describe, expect, it } from "vitest";
import { searchMatch } from "../lib/utils";

describe("searchMatch", () => {
  it("matches exact substring", () => {
    expect(searchMatch("foo", "foobar")).toBe(true);
  });

  it("matches substring in the middle", () => {
    expect(searchMatch("oba", "foobar")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(searchMatch("FOO", "foobar")).toBe(true);
    expect(searchMatch("foo", "FOOBAR")).toBe(true);
  });

  it("rejects when needle is not a substring", () => {
    expect(searchMatch("baz", "foobar")).toBe(false);
  });

  it("matches empty needle against any haystack", () => {
    expect(searchMatch("", "anything")).toBe(true);
    expect(searchMatch("", "")).toBe(true);
  });

  it("rejects non-empty needle against empty haystack", () => {
    expect(searchMatch("a", "")).toBe(false);
  });
});
