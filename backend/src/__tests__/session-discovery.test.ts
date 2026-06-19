import { describe, expect, it } from "bun:test";
import { captureNewSessionId, type SessionDiscoveryGateway } from "../adapters/session-discovery";

/** Returns a fresh list of ids on each call, simulating a session file appearing late. */
function scriptedDiscovery(sequence: string[][]): SessionDiscoveryGateway {
  let call = 0;
  return {
    async listSessionIds(): Promise<string[]> {
      const result = sequence[Math.min(call, sequence.length - 1)] ?? [];
      call += 1;
      return result;
    },
  };
}

const noSleep = async (): Promise<void> => {};

describe("captureNewSessionId", () => {
  it("returns the id that appears after the spawn", async () => {
    const discovery = scriptedDiscovery([["new-1", "old-1"]]);
    const id = await captureNewSessionId(discovery, "claude", "/cwd", ["old-1"], { sleep: noSleep });
    expect(id).toBe("new-1");
  });

  it("polls until the new session file shows up", async () => {
    // First two polls see only the pre-existing session, third sees the fork.
    const discovery = scriptedDiscovery([["old-1"], ["old-1"], ["fork-2", "old-1"]]);
    const id = await captureNewSessionId(discovery, "codex", "/cwd", ["old-1"], { sleep: noSleep, attempts: 5 });
    expect(id).toBe("fork-2");
  });

  it("returns the newest of multiple new ids (listing is newest-first)", async () => {
    const discovery = scriptedDiscovery([["newest", "older-new", "old-1"]]);
    const id = await captureNewSessionId(discovery, "claude", "/cwd", ["old-1"], { sleep: noSleep });
    expect(id).toBe("newest");
  });

  it("returns null when nothing new appears within the retry budget", async () => {
    const discovery = scriptedDiscovery([["old-1"]]);
    const id = await captureNewSessionId(discovery, "claude", "/cwd", ["old-1"], { sleep: noSleep, attempts: 3 });
    expect(id).toBeNull();
  });
});
