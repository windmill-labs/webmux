import { describe, expect, it } from "bun:test";
import { join } from "node:path";

/** Source-level regression test: every endpoint that represents "the human took
 *  over" must call `disarmOneshotIfArmed`. The unit tests for the watcher and
 *  lifecycle service prove disarm works in isolation, but they don't prove the
 *  wiring is in place. A future refactor that quietly removes one of these
 *  calls would silently break the disarm UX without breaking any test —
 *  hence this assertion on the source itself. */
describe("server.ts disarm-on-interaction wiring", () => {
  const expected = [
    "agents-send-message",
    "agents-interrupt",
    "send-prompt",
    "upload-files",
    "close-worktree",
    "archive-worktree",
    "merge-worktree",
    "terminal-ws-input",
    "terminal-ws-send-keys",
  ];

  const serverPath = join(import.meta.dir, "..", "server.ts");

  it.each(expected)("server.ts contains a disarmOneshotIfArmed(..., \"%s\") call", async (reason) => {
    const source = await Bun.file(serverPath).text();
    const pattern = new RegExp(`disarmOneshotIfArmed\\([^)]*"${reason}"`);
    expect(source).toMatch(pattern);
  });

  it("marks Codex app-server interrupts as terminal-stale after success", async () => {
    const source = await Bun.file(serverPath).text();
    const pattern = /if \(chatSupport\.data\.provider === "codex"\) \{[\s\S]*?interruptWorktreeConversation\(resolved\.worktree\)[\s\S]*?if \(!interruptResult\.ok\)[\s\S]*?setAgentTerminalStale\(resolved\.worktree, true\)[\s\S]*?jsonResponse\(interruptResult\.data\)/;
    expect(source).toMatch(pattern);
  });

  it("guards agent terminal refreshes against busy worktrees", async () => {
    const source = await Bun.file(serverPath).text();
    const pattern = /async function apiRefreshWorktreeAgentTerminal\(branch: string\): Promise<Response> \{[\s\S]*?ensureBranchNotBusy\(branch\)[\s\S]*?lifecycleService\.refreshAgentTerminal\(branch\)/;
    expect(source).toMatch(pattern);
  });
});
