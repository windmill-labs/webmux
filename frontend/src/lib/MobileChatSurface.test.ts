import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { tick } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentsUiConversationEvent,
  AgentsUiSendMessageResponse,
  AgentsUiWorktreeConversationResponse,
  WorktreeInfo,
} from "./types";

vi.mock("./api", () => ({
  attachWorktreeConversation: vi.fn(),
  connectWorktreeConversationStream: vi.fn(),
  fetchWorktreeConversationHistory: vi.fn(),
  interruptWorktreeConversation: vi.fn(),
  sendWorktreeConversationMessage: vi.fn(),
}));

import MobileChatSurface from "./MobileChatSurface.svelte";
import {
  attachWorktreeConversation,
  connectWorktreeConversationStream,
  fetchWorktreeConversationHistory,
  sendWorktreeConversationMessage,
} from "./api";

function createWorktree(overrides: Partial<WorktreeInfo> = {}): WorktreeInfo {
  return {
    branch: "feature/mobile-chat",
    label: null,
    archived: false,
    agent: "waiting",
    mux: "✓",
    path: "/repo/__worktrees/feature/mobile-chat",
    dir: "/repo/__worktrees/feature/mobile-chat",
    dirty: false,
    unpushed: false,
    status: "idle",
    elapsed: "1m",
    profile: null,
    agentName: "claude",
    agentLabel: "Claude",
    agentTerminalStale: false,
    services: [],
    paneCount: 1,
    prs: [],
    linearIssue: null,
    creating: false,
    creationPhase: null,
    source: "ui",
    oneshot: null,
    tabs: [],
    activeTabId: null,
    ...overrides,
  };
}

function createConversationResponse(
  provider: "claudeCode" | "codexAppServer" = "claudeCode",
  overrides: Partial<AgentsUiWorktreeConversationResponse["conversation"]> = {},
): AgentsUiWorktreeConversationResponse {
  return {
    worktree: {
      branch: "feature/mobile-chat",
      path: "/repo/__worktrees/feature/mobile-chat",
      archived: false,
      dirty: false,
      unpushed: false,
      status: "idle",
      services: [],
      prs: [],
      creating: false,
      creationPhase: null,
      agentName: provider === "claudeCode" ? "claude" : "codex",
      agentLabel: provider === "claudeCode" ? "Claude" : "Codex",
      agentTerminalStale: false,
      profile: null,
      mux: true,
      conversation: provider === "claudeCode"
        ? {
            provider: "claudeCode",
            conversationId: "session-1",
            cwd: "/repo/__worktrees/feature/mobile-chat",
            lastSeenAt: "2026-04-15T12:00:00.000Z",
            sessionId: "session-1",
          }
        : {
            provider: "codexAppServer",
            conversationId: "thread-1",
            cwd: "/repo/__worktrees/feature/mobile-chat",
            lastSeenAt: "2026-04-15T12:00:00.000Z",
            threadId: "thread-1",
          },
    },
    conversation: {
      provider,
      conversationId: provider === "claudeCode" ? "session-1" : "thread-1",
      cwd: "/repo/__worktrees/feature/mobile-chat",
      running: false,
      activeTurnId: null,
      messages: [],
      ...overrides,
    },
  };
}

describe("MobileChatSurface", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.mocked(connectWorktreeConversationStream).mockReturnValue(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("streams Claude conversations without polling history after sending", async () => {
    vi.mocked(attachWorktreeConversation).mockResolvedValue(createConversationResponse("claudeCode"));
    vi.mocked(sendWorktreeConversationMessage).mockResolvedValue({
      conversationId: "session-1",
      turnId: "turn-1",
      running: true,
      streaming: true,
    } satisfies AgentsUiSendMessageResponse);
    vi.mocked(fetchWorktreeConversationHistory).mockResolvedValue(createConversationResponse("claudeCode"));

    render(MobileChatSurface, {
      props: {
        worktree: createWorktree(),
      },
    });

    await screen.findByText("No messages yet. Send the first prompt to start this chat.");
    expect(connectWorktreeConversationStream).not.toHaveBeenCalled();

    await fireEvent.input(screen.getByLabelText("Message"), {
      target: { value: "Ship it" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(sendWorktreeConversationMessage).toHaveBeenCalledWith("feature/mobile-chat", { text: "Ship it" });
    });
    await waitFor(() => {
      expect(connectWorktreeConversationStream).toHaveBeenCalledWith(
        "feature/mobile-chat",
        expect.any(Object),
      );
    });
    await screen.findByText("Ship it");

    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchWorktreeConversationHistory).not.toHaveBeenCalled();
  });

  it("polls Claude history after terminal-routed sends", async () => {
    vi.mocked(attachWorktreeConversation).mockResolvedValue(createConversationResponse("claudeCode"));
    vi.mocked(sendWorktreeConversationMessage).mockResolvedValue({
      conversationId: "session-1",
      turnId: "tmux:turn-1",
      running: true,
      streaming: false,
    } satisfies AgentsUiSendMessageResponse);
    vi.mocked(fetchWorktreeConversationHistory).mockResolvedValue(createConversationResponse("claudeCode", {
      messages: [
        {
          id: "user-1",
          turnId: "turn-1",
          order: 0,
          role: "user",
          kind: "text",
          text: "Ship it",
          status: "completed",
          createdAt: "2026-05-28T10:00:00.000Z",
        },
        {
          id: "assistant-1",
          turnId: "turn-1",
          order: 1,
          role: "assistant",
          kind: "text",
          text: "Done from terminal",
          status: "completed",
          createdAt: "2026-05-28T10:00:01.000Z",
        },
      ],
    }));

    render(MobileChatSurface, {
      props: {
        worktree: createWorktree(),
      },
    });

    await screen.findByText("No messages yet. Send the first prompt to start this chat.");

    await fireEvent.input(screen.getByLabelText("Message"), {
      target: { value: "Ship it" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(sendWorktreeConversationMessage).toHaveBeenCalledWith("feature/mobile-chat", { text: "Ship it" });
    });
    await vi.advanceTimersByTimeAsync(1000);

    await waitFor(() => {
      expect(fetchWorktreeConversationHistory).toHaveBeenCalledWith("feature/mobile-chat");
    });
    await screen.findByText("Done from terminal");
  });

  it("does not poll Codex history after sending when the websocket stream is active", async () => {
    vi.mocked(attachWorktreeConversation).mockResolvedValue(createConversationResponse("codexAppServer"));
    vi.mocked(sendWorktreeConversationMessage).mockResolvedValue({
      conversationId: "thread-1",
      turnId: "turn-1",
      running: true,
      streaming: true,
    } satisfies AgentsUiSendMessageResponse);
    vi.mocked(fetchWorktreeConversationHistory).mockResolvedValue(createConversationResponse("codexAppServer"));

    render(MobileChatSurface, {
      props: {
        worktree: createWorktree({ agentName: "codex" }),
      },
    });

    await screen.findByText("No messages yet. Send the first prompt to start this chat.");
    expect(connectWorktreeConversationStream).not.toHaveBeenCalled();

    await fireEvent.input(screen.getByLabelText("Message"), {
      target: { value: "Ship it" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(connectWorktreeConversationStream).toHaveBeenCalledWith(
        "feature/mobile-chat",
        expect.any(Object),
      );
    });

    await screen.findByText("Ship it");
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchWorktreeConversationHistory).not.toHaveBeenCalled();
  });

  it("does not open an idle Codex stream after loading the snapshot", async () => {
    vi.mocked(attachWorktreeConversation).mockResolvedValue(createConversationResponse("codexAppServer"));

    render(MobileChatSurface, {
      props: {
        worktree: createWorktree({ agentName: "codex" }),
      },
    });

    await screen.findByText("No messages yet. Send the first prompt to start this chat.");

    expect(connectWorktreeConversationStream).not.toHaveBeenCalled();
  });

  it("opens a Codex stream immediately when the snapshot is already running", async () => {
    vi.mocked(attachWorktreeConversation).mockResolvedValue(createConversationResponse("codexAppServer", {
      running: true,
      activeTurnId: "turn-1",
    }));

    render(MobileChatSurface, {
      props: {
        worktree: createWorktree({ agentName: "codex" }),
      },
    });

    await waitFor(() => {
      expect(connectWorktreeConversationStream).toHaveBeenCalledWith(
        "feature/mobile-chat",
        expect.any(Object),
      );
    });
  });

  it("does not duplicate optimistic Codex user messages when the stream upserts the real user item", async () => {
    vi.mocked(attachWorktreeConversation).mockResolvedValue(createConversationResponse("codexAppServer"));
    vi.mocked(sendWorktreeConversationMessage).mockResolvedValue({
      conversationId: "thread-1",
      turnId: "turn-1",
      running: true,
      streaming: true,
    } satisfies AgentsUiSendMessageResponse);

    render(MobileChatSurface, {
      props: {
        worktree: createWorktree({ agentName: "codex" }),
      },
    });

    await screen.findByText("No messages yet. Send the first prompt to start this chat.");

    await fireEvent.input(screen.getByLabelText("Message"), {
      target: { value: "Ship it" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(connectWorktreeConversationStream).toHaveBeenCalledWith(
        "feature/mobile-chat",
        expect.any(Object),
      );
    });

    const callbacks = vi.mocked(connectWorktreeConversationStream).mock.calls[0]?.[1];
    callbacks?.onEvent({
      type: "messageUpsert",
      revision: 1,
      conversationId: "thread-1",
      message: {
        id: "user-1",
        turnId: "turn-1",
        order: 0,
        role: "user",
        kind: "text",
        text: "Ship it",
        status: "completed",
        createdAt: "2026-05-28T10:00:00.000Z",
      },
    });

    await waitFor(() => {
      expect(screen.getAllByText("Ship it")).toHaveLength(1);
    });
  });

  it("applies Claude stream deltas", async () => {
    vi.mocked(attachWorktreeConversation).mockResolvedValue(createConversationResponse("claudeCode", {
      running: true,
      activeTurnId: "claude-turn:turn-1",
    }));

    render(MobileChatSurface, {
      props: {
        worktree: createWorktree(),
      },
    });

    await waitFor(() => {
      expect(connectWorktreeConversationStream).toHaveBeenCalledWith(
        "feature/mobile-chat",
        expect.any(Object),
      );
    });

    const callbacks = vi.mocked(connectWorktreeConversationStream).mock.calls[0]?.[1];
    callbacks?.onEvent({
      type: "messageDelta",
      revision: 1,
      conversationId: "session-1",
      turnId: "claude-turn:turn-1",
      itemId: "msg_1:0",
      order: 0,
      delta: "Streaming from Claude",
    });

    await screen.findByText("Streaming from Claude");
  });

  it("ignores stale Codex stream revisions", async () => {
    vi.mocked(attachWorktreeConversation).mockResolvedValue(createConversationResponse("codexAppServer", {
      running: true,
      activeTurnId: "turn-1",
    }));

    render(MobileChatSurface, {
      props: {
        worktree: createWorktree({ agentName: "codex", agentLabel: "Codex" }),
      },
    });

    await waitFor(() => {
      expect(connectWorktreeConversationStream).toHaveBeenCalledWith(
        "feature/mobile-chat",
        expect.any(Object),
      );
    });

    const callbacks = vi.mocked(connectWorktreeConversationStream).mock.calls[0]?.[1];
    const deltaEvent: AgentsUiConversationEvent = {
      type: "messageDelta",
      revision: 1,
      conversationId: "thread-1",
      turnId: "turn-1",
      itemId: "assistant-1",
      order: 0,
      delta: "Streaming status update",
    };
    callbacks?.onEvent(deltaEvent);
    await screen.findByText("Streaming status update");

    const staleDeltaEvent: AgentsUiConversationEvent = {
      type: "messageDelta",
      revision: 1,
      conversationId: "thread-1",
      turnId: "turn-1",
      itemId: "assistant-1",
      order: 0,
      delta: " stale",
    };
    callbacks?.onEvent(staleDeltaEvent);

    await screen.findByText("Streaming status update");
    await tick();
    expect(document.body.textContent).not.toContain("stale");
  });

  it("renders Codex stream events in their explicit order", async () => {
    vi.mocked(attachWorktreeConversation).mockResolvedValue(createConversationResponse("codexAppServer", {
      running: true,
      activeTurnId: "turn-1",
    }));

    render(MobileChatSurface, {
      props: {
        worktree: createWorktree({ agentName: "codex", agentLabel: "Codex" }),
      },
    });

    await waitFor(() => {
      expect(connectWorktreeConversationStream).toHaveBeenCalledWith(
        "feature/mobile-chat",
        expect.any(Object),
      );
    });

    const callbacks = vi.mocked(connectWorktreeConversationStream).mock.calls[0]?.[1];
    callbacks?.onEvent({
      type: "messageDelta",
      revision: 1,
      conversationId: "thread-1",
      turnId: "turn-1",
      itemId: "assistant-1",
      order: 0,
      delta: "First assistant",
    });
    callbacks?.onEvent({
      type: "messageUpsert",
      revision: 2,
      conversationId: "thread-1",
      message: {
        id: "call-1",
        turnId: "turn-1",
        order: 1,
        role: "assistant",
        kind: "toolUse",
        toolName: "shell",
        toolCallId: "call-1",
        text: "pwd",
        status: "completed",
        createdAt: "2026-05-28T10:00:01.000Z",
      },
    });
    callbacks?.onEvent({
      type: "messageDelta",
      revision: 3,
      conversationId: "thread-1",
      turnId: "turn-1",
      itemId: "assistant-2",
      order: 2,
      delta: "Second assistant",
    });

    await screen.findByText("First assistant");
    await screen.findByText("Second assistant");

    await tick();

    expect(screen.getByText("First assistant")).toBeInTheDocument();
    expect(screen.getByText("Second assistant")).toBeInTheDocument();
    const text = document.body.textContent ?? "";
    expect(text.indexOf("First assistant")).toBeLessThan(text.indexOf("Completed shell"));
    expect(text.indexOf("Completed shell")).toBeLessThan(text.indexOf("Second assistant"));
  });

});
