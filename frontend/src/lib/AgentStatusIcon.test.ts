import { describe, expect, it } from "vitest";
import { agentIconVisible } from "./AgentStatusIcon.svelte";

describe("agentIconVisible", () => {
  it("is visible for working, waiting and error regardless of unread", () => {
    expect(agentIconVisible("working", false)).toBe(true);
    expect(agentIconVisible("waiting", false)).toBe(true);
    expect(agentIconVisible("error", false)).toBe(true);
  });

  it("is visible for done only when unread", () => {
    expect(agentIconVisible("done", true)).toBe(true);
    expect(agentIconVisible("done", false)).toBe(false);
  });

  it("is hidden for idle and unknown statuses", () => {
    expect(agentIconVisible("idle", true)).toBe(false);
    expect(agentIconVisible("", false)).toBe(false);
  });
});
