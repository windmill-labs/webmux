import { describe, expect, it } from "vitest";

// Trivial smoke test: verifies vitest + happy-dom initialised correctly.
describe("test environment", () => {
  it("has a working DOM", () => {
    const el = document.createElement("div");
    el.textContent = "hello";
    expect(el.textContent).toBe("hello");
  });
});
