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
    // The busy-guard is now provided by withMutatingTab (which calls
    // ensureBranchNotBusy internally) — see the serialization wiring test below.
    const pattern = /async function apiRefreshWorktreeAgentTerminal\(branch: string\): Promise<Response> \{[\s\S]*?withMutatingTab\(branch[\s\S]*?lifecycleService\.refreshAgentTerminal\(branch\)/;
    expect(source).toMatch(pattern);
  });
});

/** Source-level regression test for tab-mutation serialization. open and
 *  agent-terminal refresh both rewrite the whole tabs array (via
 *  restoreWorktreeTabs), so they must hold the same per-branch lock as
 *  tab create/select/delete — otherwise a reopen racing a fork creation can
 *  clobber tab bookkeeping. A future refactor that drops the lock from one of
 *  these paths would silently reopen that race without failing any other test. */
describe("server.ts tab-mutation serialization wiring", () => {
  const serverPath = join(import.meta.dir, "..", "server.ts");
  const expected = [
    "apiCreateWorktreeTab",
    "apiSelectWorktreeTab",
    "apiDeleteWorktreeTab",
    "apiOpenWorktree",
    "apiRefreshWorktreeAgentTerminal",
  ];

  it.each(expected)("%s acquires the tab-mutation lock via withMutatingTab", async (fn) => {
    const source = await Bun.file(serverPath).text();
    const pattern = new RegExp(`async function ${fn}\\([^)]*\\): Promise<Response> \\{[\\s\\S]*?withMutatingTab\\(`);
    expect(source).toMatch(pattern);
  });
});
