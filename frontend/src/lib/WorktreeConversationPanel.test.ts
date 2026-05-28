import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import WorktreeConversationPanel from "./WorktreeConversationPanel.svelte";
import type { AgentsUiConversationState, WorktreeInfo } from "./types";

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

  it("does not duplicate the stale terminal banner inside chat", () => {
    renderPanel({
      worktree: createWorktree({ agentTerminalStale: true }),
    });

    expect(screen.queryByText("Terminal stale")).not.toBeInTheDocument();
  });

  it("renders thinking and tool blocks", () => {
    renderPanel({
      conversation: createConversation({
        messages: [
          {
            id: "thinking-1",
            turnId: "turn-1",
            role: "assistant",
            kind: "thinking",
            text: "I will inspect the directory.",
            status: "completed",
            createdAt: null,
          },
          {
            id: "call-1",
            turnId: "turn-1",
            role: "assistant",
            kind: "toolUse",
            toolName: "shell",
            toolCallId: "call-1",
            text: "ls",
            status: "completed",
            createdAt: null,
            cwd: "/repo/__worktrees/feature/mobile-chat",
            exitCode: 0,
            durationMs: 4,
          },
          {
            id: "call-1:result",
            turnId: "turn-1",
            role: "user",
            kind: "toolResult",
            toolCallId: "call-1",
            text: "README.md",
            status: "completed",
            createdAt: null,
          },
        ],
      }),
    });

    expect(screen.getByText("Thinking")).toBeInTheDocument();
    expect(screen.getByText("I will inspect the directory.")).toBeInTheDocument();
    expect(screen.getByText("Completed shell")).toBeInTheDocument();
    expect(screen.getByText("ls")).toBeInTheDocument();
    expect(screen.getByText("Output")).toBeInTheDocument();
    expect(screen.getByText("README.md")).toBeInTheDocument();
    expect(screen.queryByText("/repo/__worktrees/feature/mobile-chat")).not.toBeInTheDocument();

    const toolBlock = screen.getByText("Completed shell").closest("div")?.parentElement;
    expect(toolBlock).toHaveTextContent("ls");
    expect(toolBlock).toHaveTextContent("README.md");
  });

  it("shows a processing indicator before visible progress arrives", () => {
    renderPanel({
      conversation: createConversation({
        running: true,
        activeTurnId: "turn-1",
        messages: [],
      }),
    });

    expect(screen.getByText("Claude is processing")).toBeInTheDocument();
  });

  it("does not render blank assistant bubbles for empty streamed starts", () => {
    renderPanel({
      worktree: createWorktree({ agentName: "codex", agentLabel: "Codex" }),
      conversation: createConversation({
        provider: "codexAppServer",
        running: true,
        activeTurnId: "turn-1",
        messages: [
          {
            id: "assistant-empty",
            turnId: "turn-1",
            role: "assistant",
            kind: "text",
            text: "",
            status: "inProgress",
            createdAt: null,
          },
        ],
      }),
    });

    expect(screen.getByText("Codex is processing")).toBeInTheDocument();
    expect(screen.queryByText("typing")).not.toBeInTheDocument();
  });
});
