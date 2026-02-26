import { describe, expect, it } from "bun:test";
import { expandTemplate } from "../config";

describe("expandTemplate", () => {
  it("replaces known placeholders", () => {
    expect(expandTemplate("Hello ${NAME}", { NAME: "world" })).toBe("Hello world");
  });

  it("leaves unknown placeholders as empty string", () => {
    expect(expandTemplate("Hello ${MISSING}", {})).toBe("Hello ");
  });

  it("replaces multiple placeholders in one string", () => {
    expect(expandTemplate("${A}-${B}", { A: "foo", B: "bar" })).toBe("foo-bar");
  });

  it("returns the string unchanged when there are no placeholders", () => {
    expect(expandTemplate("no placeholders", {})).toBe("no placeholders");
  });
});
