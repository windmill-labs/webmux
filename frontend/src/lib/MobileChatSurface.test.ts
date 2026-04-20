import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
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
    services: [],
    paneCount: 1,
    prs: [],
    linearIssue: null,
    creating: false,
    creationPhase: null,
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

  it("refreshes Claude conversation history after sending a message", async () => {
    vi.mocked(attachWorktreeConversation).mockResolvedValue(createConversationResponse("claudeCode"));
    vi.mocked(sendWorktreeConversationMessage).mockResolvedValue({
      conversationId: "session-1",
      turnId: "turn-1",
      running: true,
    } satisfies AgentsUiSendMessageResponse);
    vi.mocked(fetchWorktreeConversationHistory).mockResolvedValue(createConversationResponse("claudeCode", {
      running: false,
      messages: [
        {
          id: "user-1",
          turnId: "turn-1",
          role: "user",
          text: "Ship it",
          status: "completed",
          createdAt: "2026-04-15T12:00:00.000Z",
        },
        {
          id: "assistant-1",
          turnId: "turn-1",
          role: "assistant",
          text: "Done.",
          status: "completed",
          createdAt: "2026-04-15T12:00:01.000Z",
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
    expect(connectWorktreeConversationStream).not.toHaveBeenCalled();
    await screen.findByText("Ship it");

    await vi.advanceTimersByTimeAsync(1000);

    await waitFor(() => {
      expect(fetchWorktreeConversationHistory).toHaveBeenCalledWith("feature/mobile-chat");
    });
    await screen.findByText("Done.");
  });

  it("keeps polling Codex history when the first refresh is still stale", async () => {
    vi.mocked(attachWorktreeConversation).mockResolvedValue(createConversationResponse("codexAppServer"));
    vi.mocked(sendWorktreeConversationMessage).mockResolvedValue({
      conversationId: "thread-1",
      turnId: "turn-1",
      running: true,
    } satisfies AgentsUiSendMessageResponse);
    vi.mocked(fetchWorktreeConversationHistory)
      .mockResolvedValueOnce(createConversationResponse("codexAppServer"))
      .mockResolvedValueOnce(createConversationResponse("codexAppServer", {
        running: false,
        messages: [
          {
            id: "user-1",
            turnId: "turn-1",
            role: "user",
            text: "Ship it",
            status: "completed",
            createdAt: "2026-04-15T12:00:00.000Z",
          },
          {
            id: "assistant-1",
            turnId: "turn-1",
            role: "assistant",
            text: "Done.",
            status: "completed",
            createdAt: "2026-04-15T12:00:01.000Z",
          },
        ],
      }));

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

    await vi.advanceTimersByTimeAsync(1000);
    await waitFor(() => {
      expect(fetchWorktreeConversationHistory).toHaveBeenCalledTimes(1);
    });

    await vi.advanceTimersByTimeAsync(1000);
    await waitFor(() => {
      expect(fetchWorktreeConversationHistory).toHaveBeenCalledTimes(2);
    });
    await screen.findByText("Done.");
  });
});
