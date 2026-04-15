import { afterEach, describe, expect, it } from "bun:test";
import {
  attach,
  cleanupStaleSessions,
  detach,
  interruptPrompt,
  sendPrompt,
  setTerminalAdapterDependenciesForTests,
} from "../adapters/terminal";

interface DeferredNumber {
  promise: Promise<number>;
  resolve: (value: number) => void;
}

function deferredNumber(): DeferredNumber {
  let resolve!: (value: number) => void;
  return {
    promise: new Promise<number>((res) => {
      resolve = res;
    }),
    resolve,
  };
}

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function closedStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close();
    },
  });
}

function createFakePtyProcess(pid: number, onKill: () => void) {
  const exit = deferredNumber();
  let killed = false;

  return {
    pid,
    stdin: {
      write(_data: Uint8Array): void {},
      flush(): void {},
    },
    stdout: closedStream(),
    stderr: closedStream(),
    exited: exit.promise,
    kill(): void {
      if (killed) return;
      killed = true;
      onKill();
      exit.resolve(0);
    },
  };
}

function extractGroupedSessionName(args: string[]): string {
  const joined = args.join(" ");
  const match = /new-session -d -s "([^"]+)"/.exec(joined);
  if (!match?.[1]) {
    throw new Error(`expected grouped session name in args: ${joined}`);
  }
  return match[1];
}

describe("terminal adapter", () => {
  afterEach(async () => {
    await detach("attach-a");
    await detach("attach-b");
    cleanupStaleSessions();
    setTerminalAdapterDependenciesForTests();
  });

  it("keeps concurrent attaches isolated by attach id", async () => {
    const managedSessions = new Set<string>();
    let nextPid = 1000;

    setTerminalAdapterDependenciesForTests({
      spawnPtyProcess: (args) => {
        const groupedSessionName = extractGroupedSessionName(args);
        managedSessions.add(groupedSessionName);
        return createFakePtyProcess(nextPid++, () => {
          managedSessions.delete(groupedSessionName);
        });
      },
      spawnSyncCommand: (args) => {
        if (args[0] === "tmux" && args[1] === "list-sessions") {
          return {
            exitCode: 0,
            stdout: encode([...managedSessions].join("\n")),
            stderr: encode(""),
          };
        }

        if (args[0] === "tmux" && args[1] === "kill-session") {
          const name = args[3];
          if (name && managedSessions.delete(name)) {
            return {
              exitCode: 0,
              stdout: encode(""),
              stderr: encode(""),
            };
          }
          return {
            exitCode: 1,
            stdout: encode(""),
            stderr: encode("can't find session"),
          };
        }

        return {
          exitCode: 0,
          stdout: encode(""),
          stderr: encode(""),
        };
      },
    });

    cleanupStaleSessions();
    await attach("attach-a", { ownerSessionName: "owner", windowName: "wm-feature/search" }, 80, 24);
    await attach("attach-b", { ownerSessionName: "owner", windowName: "wm-feature/search" }, 80, 24);
    const afterAttach = [...managedSessions];
    await detach("attach-a");
    const afterFirstDetach = [...managedSessions];
    await detach("attach-b");
    const afterSecondDetach = [...managedSessions];

    expect(afterAttach).toHaveLength(2);
    expect(new Set(afterAttach).size).toBe(2);
    expect(afterFirstDetach).toHaveLength(1);
    expect(afterSecondDetach).toHaveLength(0);
  });

  it("sends ctrl-c to the target pane when interrupting a prompt", async () => {
    const tmuxCalls: string[][] = [];

    setTerminalAdapterDependenciesForTests({
      spawnTmuxProcess: (args) => {
        tmuxCalls.push(args);
        return {
          stderr: closedStream(),
          exited: Promise.resolve(0),
          kill(): void {},
        };
      },
    });

    const result = await interruptPrompt({
      ownerSessionName: "owner",
      windowName: "wm-feature/search",
    });

    expect(result).toEqual({ ok: true });
    expect(tmuxCalls).toContainEqual([
      "tmux",
      "send-keys",
      "-t",
      "owner:wm-feature/search.0",
      "C-c",
    ]);
  });

  it("waits before submitting a pasted prompt when a submit delay is provided", async () => {
    const tmuxCalls: string[][] = [];
    const slept: number[] = [];

    setTerminalAdapterDependenciesForTests({
      sleep: async (ms) => {
        slept.push(ms);
      },
      spawnTmuxProcess: (args) => {
        tmuxCalls.push(args);
        return {
          stderr: closedStream(),
          exited: Promise.resolve(0),
          kill(): void {},
        };
      },
    });

    const result = await sendPrompt(
      "worktree-1",
      {
        ownerSessionName: "owner",
        windowName: "wm-feature/search",
      },
      "reply with EXACTLY OK",
      0,
      undefined,
      200,
    );

    expect(result).toEqual({ ok: true });
    expect(slept).toEqual([200]);
    expect(tmuxCalls).toEqual([
      ["tmux", "load-buffer", "-b", expect.stringMatching(/^wm-prompt-/), "-",],
      ["tmux", "paste-buffer", "-b", expect.stringMatching(/^wm-prompt-/), "-t", "owner:wm-feature/search.0", "-d"],
      ["tmux", "send-keys", "-t", "owner:wm-feature/search.0", "Enter"],
    ]);
  });
});
