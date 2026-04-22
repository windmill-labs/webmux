import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SettingsDialog from "./SettingsDialog.svelte";
import type { AgentDetails, AgentSummary, AppConfig } from "./types";

vi.mock("./api", () => ({
  api: {
    fetchConfig: vi.fn(),
    setAutoRemoveOnMerge: vi.fn(),
    setLinearAutoCreate: vi.fn(),
  },
  fetchAgents: vi.fn(),
  createAgent: vi.fn(),
  updateAgent: vi.fn(),
  deleteAgent: vi.fn(),
}));

import { api, createAgent, deleteAgent, fetchAgents } from "./api";

const originalDialogShowModal = HTMLDialogElement.prototype.showModal;
const originalDialogClose = HTMLDialogElement.prototype.close;

function createAgentDetails(overrides: Partial<AgentDetails> = {}): AgentDetails {
  return {
    id: "gemini",
    label: "Gemini CLI",
    kind: "custom",
    capabilities: {
      terminal: true,
      inAppChat: false,
      conversationHistory: false,
      interrupt: false,
      resume: true,
    },
    startCommand: 'gemini --prompt "${PROMPT}"',
    resumeCommand: 'gemini resume --branch "${BRANCH}"',
    ...overrides,
  };
}

function createAgentSummary(overrides: Partial<AgentSummary> = {}): AgentSummary {
  return {
    id: "gemini",
    label: "Gemini CLI",
    kind: "custom",
    capabilities: {
      terminal: true,
      inAppChat: false,
      conversationHistory: false,
      interrupt: false,
      resume: true,
    },
    ...overrides,
  };
}

function createConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    name: "repo",
    services: [],
    profiles: [{ name: "default" }],
    agents: [],
    defaultProfileName: "default",
    defaultAgentId: "claude",
    autoName: false,
    linearCreateTicketOption: false,
    startupEnvs: {},
    linkedRepos: [],
    linearAutoCreateWorktrees: false,
    autoRemoveOnMerge: false,
    projectDir: "/repo",
    mainBranch: "main",
    ...overrides,
  };
}

function renderDialog() {
  return render(SettingsDialog, {
    currentTheme: "github-dark",
    linearAutoCreate: false,
    autoRemoveOnMerge: false,
    onthemechange: vi.fn(),
    onlinearautocreatechange: vi.fn(),
    onautoremovechange: vi.fn(),
    onagentschange: vi.fn(),
    onsave: vi.fn(),
    onclose: vi.fn(),
  });
}

describe("SettingsDialog agent management", () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function close() {
      this.removeAttribute("open");
    };
  });

  afterEach(() => {
    HTMLDialogElement.prototype.showModal = originalDialogShowModal;
    HTMLDialogElement.prototype.close = originalDialogClose;
    cleanup();
    vi.clearAllMocks();
  });

  it("loads and renders built-in and custom agents", async () => {
    vi.mocked(fetchAgents).mockResolvedValue([
      createAgentDetails({ id: "claude", label: "Claude", kind: "builtin", startCommand: null, resumeCommand: null, capabilities: {
        terminal: true,
        inAppChat: true,
        conversationHistory: true,
        interrupt: true,
        resume: true,
      } }),
      createAgentDetails(),
    ]);

    renderDialog();

    expect(await screen.findByText("Claude")).toBeInTheDocument();
    expect(screen.getByText("Gemini CLI")).toBeInTheDocument();
    expect(screen.getByText('gemini --prompt "${PROMPT}"')).toBeInTheDocument();
  });

  it("creates and deletes custom agents", async () => {
    const onagentschange = vi.fn();
    vi.mocked(fetchAgents)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([createAgentDetails()])
      .mockResolvedValueOnce([]);
    vi.mocked(createAgent).mockResolvedValue({ agent: createAgentDetails() });
    vi.mocked(deleteAgent).mockResolvedValue();
    vi.mocked(api.fetchConfig)
      .mockResolvedValueOnce(createConfig({ agents: [createAgentSummary()] }))
      .mockResolvedValueOnce(createConfig({ agents: [] }));

    render(SettingsDialog, {
      currentTheme: "github-dark",
      linearAutoCreate: false,
      autoRemoveOnMerge: false,
      onthemechange: vi.fn(),
      onlinearautocreatechange: vi.fn(),
      onautoremovechange: vi.fn(),
      onagentschange,
      onsave: vi.fn(),
      onclose: vi.fn(),
    });

    await screen.findByText("Add agent");
    await fireEvent.click(screen.getByRole("button", { name: "Add agent" }));
    await fireEvent.input(screen.getByLabelText("Agent name"), { target: { value: "Gemini CLI" } });
    await fireEvent.input(screen.getByLabelText("Start command"), { target: { value: 'gemini --prompt "${PROMPT}"' } });
    await fireEvent.click(screen.getAllByRole("button", { name: "Save" }).at(-1)!);

    await waitFor(() => {
      expect(createAgent).toHaveBeenCalledWith({
        label: "Gemini CLI",
        startCommand: 'gemini --prompt "${PROMPT}"',
      });
    });
    await waitFor(() => {
      expect(onagentschange).toHaveBeenCalledWith([createAgentSummary()]);
    });

    await fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(deleteAgent).toHaveBeenCalledWith("gemini");
    });
    await waitFor(() => {
      expect(onagentschange).toHaveBeenCalledWith([]);
    });
  });
});
