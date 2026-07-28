import { describe, expect, it } from "bun:test";
import { selectDevPortPair } from "./dev-ports";

describe("selectDevPortPair", () => {
  it("uses the preferred adjacent ports when both are free", () => {
    expect(selectDevPortPair(5111, () => true)).toEqual({
      backendPort: 5111,
      frontendPort: 5112,
    });
  });

  it("skips occupied and non-adjacent ports", () => {
    const occupied = new Set([5111, 5113]);
    expect(selectDevPortPair(5111, (port) => !occupied.has(port))).toEqual({
      backendPort: 5114,
      frontendPort: 5115,
    });
  });

  it("fails when the search window has no adjacent pair", () => {
    expect(() => selectDevPortPair(5111, (port) => port % 2 === 0, 4)).toThrow(
      "Could not find two adjacent free ports starting at 5111",
    );
  });
});
