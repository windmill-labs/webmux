import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import WorktreeConversationPanel from "./WorktreeConversationPanel.svelte";
import type { AgentsUiConversationState, WorktreeInfo } from "./types";

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

function createConversation(overrides: Partial<AgentsUiConversationState> = {}): AgentsUiConversationState {
  return {
    provider: "claudeCode",
    conversationId: "session-1",
    cwd: "/repo/__worktrees/feature/mobile-chat",
    running: false,
    activeTurnId: null,
    messages: [],
    ...overrides,
  };
}

function renderPanel({
  worktree = createWorktree(),
  conversation = createConversation(),
  conversationError = null,
}: {
  worktree?: WorktreeInfo;
  conversation?: AgentsUiConversationState | null;
  conversationError?: string | null;
} = {}) {
  const onInterrupt = vi.fn();

  render(WorktreeConversationPanel, {
    props: {
      worktree,
      conversation,
      conversationError,
      conversationLoading: false,
      composerText: "",
      isSending: false,
      onAttach: vi.fn(),
      onComposerInput: vi.fn(),
      onInterrupt,
      onRefresh: vi.fn(),
      onSend: vi.fn(),
    },
  });

  return { onInterrupt };
}

describe("WorktreeConversationPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows an interrupt button in the normal running state", async () => {
    const { onInterrupt } = renderPanel({
      conversation: createConversation({
        running: true,
        activeTurnId: "turn-1",
      }),
    });

    const interruptButton = screen.getByRole("button", { name: "Interrupt" });
    expect(interruptButton).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send" })).not.toBeInTheDocument();

    await fireEvent.click(interruptButton);
    expect(onInterrupt).toHaveBeenCalledTimes(1);
  });

  it("keeps the interrupt button inside the error banner when the conversation is running", () => {
    renderPanel({
      conversation: createConversation({
        running: true,
        activeTurnId: "turn-1",
      }),
      conversationError: "Conversation stream disconnected",
    });

    expect(screen.getByText("Conversation stream disconnected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Interrupt" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeInTheDocument();
  });

  it("shows only the send button when idle", () => {
    renderPanel();

    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Interrupt" })).not.toBeInTheDocument();
  });
});
