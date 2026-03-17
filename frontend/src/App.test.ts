import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig, WorktreeInfo } from "./lib/types";

vi.mock("./lib/api", () => ({
  closeWorktree: vi.fn(),
  createWorktree: vi.fn(),
  dismissNotification: vi.fn(),
  fetchAvailableBranches: vi.fn(),
  fetchCiLogs: vi.fn(),
  fetchConfig: vi.fn(),
  fetchLinearIssues: vi.fn(),
  fetchWorktrees: vi.fn(),
  mergeWorktree: vi.fn(),
  openWorktree: vi.fn(),
  removeWorktree: vi.fn(),
  sendWorktreePrompt: vi.fn(),
  subscribeNotifications: vi.fn(),
}));

import App from "./App.svelte";
import * as api from "./lib/api";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

class MockNotification {
  static permission: NotificationPermission = "denied";

  static requestPermission = vi.fn(async () => "denied" as const);

  constructor(_title: string, _options?: NotificationOptions) {}
}

const originalMatchMedia = window.matchMedia;
const originalNotification = globalThis.Notification;
const originalAlert = window.alert;
const originalDialogShowModal = HTMLDialogElement.prototype.showModal;
const originalDialogClose = HTMLDialogElement.prototype.close;

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createConfig(): AppConfig {
  return {
    services: [],
    profiles: [{ name: "default" }],
    defaultProfileName: "default",
    autoName: false,
    linkedRepos: [],
  };
}

function createWorktree(
  branch: string,
  overrides: Partial<WorktreeInfo> = {},
): WorktreeInfo {
  return {
    branch,
    agent: "waiting",
    mux: "",
    path: `/repo/__worktrees/${branch}`,
    dir: `/repo/__worktrees/${branch}`,
    dirty: false,
    unpushed: false,
    status: "idle",
    elapsed: "1m",
    profile: null,
    agentName: null,
    services: [],
    paneCount: 1,
    prs: [],
    linearIssue: null,
    creating: false,
    creationPhase: null,
    ...overrides,
  };
}

function setupBrowserMocks(): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  Object.defineProperty(globalThis, "Notification", {
    configurable: true,
    writable: true,
    value: MockNotification,
  });
  Object.defineProperty(window, "alert", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement): void {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement): void {
    this.open = false;
  });
}

function restoreBrowserMocks(): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: originalMatchMedia,
  });
  Object.defineProperty(globalThis, "Notification", {
    configurable: true,
    writable: true,
    value: originalNotification,
  });
  Object.defineProperty(window, "alert", {
    configurable: true,
    writable: true,
    value: originalAlert,
  });
  HTMLDialogElement.prototype.showModal = originalDialogShowModal;
  HTMLDialogElement.prototype.close = originalDialogClose;
}

async function openCreateDialogAndSubmit(branch: string): Promise<void> {
  await fireEvent.click(screen.getByTitle("New Worktree (Cmd+K)"));
  await screen.findByText("New Worktree");
  await fireEvent.input(screen.getByLabelText(/Branch name/i), {
    target: { value: branch },
  });
  await fireEvent.click(screen.getByRole("button", { name: "Create" }));
}

describe("App create selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cleanup();
    localStorage.clear();
    setupBrowserMocks();

    vi.mocked(api.fetchConfig).mockResolvedValue(createConfig());
    vi.mocked(api.fetchAvailableBranches).mockResolvedValue([]);
    vi.mocked(api.fetchLinearIssues).mockResolvedValue([]);
    vi.mocked(api.subscribeNotifications).mockReturnValue(() => {});
    vi.mocked(api.openWorktree).mockResolvedValue(undefined);
    vi.mocked(api.closeWorktree).mockResolvedValue(undefined);
    vi.mocked(api.removeWorktree).mockResolvedValue(undefined);
    vi.mocked(api.mergeWorktree).mockResolvedValue(undefined);
    vi.mocked(api.dismissNotification).mockResolvedValue(undefined);
    vi.mocked(api.fetchCiLogs).mockResolvedValue("");
    vi.mocked(api.sendWorktreePrompt).mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    restoreBrowserMocks();
  });

  it("keeps the current selection when a new worktree is created from an existing selection", async () => {
    const existingWorktree = createWorktree("main");
    const creatingWorktree = createWorktree("feature/new", {
      creating: true,
      creationPhase: "creating_worktree",
    });
    const newWorktree = createWorktree("feature/new");
    const createResult = deferred<{ branch: string }>();

    vi.mocked(api.fetchWorktrees)
      .mockResolvedValueOnce([existingWorktree])
      .mockResolvedValueOnce([existingWorktree, creatingWorktree])
      .mockResolvedValueOnce([existingWorktree, newWorktree])
      .mockResolvedValue([existingWorktree, newWorktree]);
    vi.mocked(api.createWorktree).mockReturnValueOnce(createResult.promise);

    render(App);

    await screen.findByTitle("main");

    await openCreateDialogAndSubmit("feature/new");

    await waitFor(() => {
      expect(api.fetchWorktrees).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByRole("button", { name: /feature\/new/i })).toBeInTheDocument();
    expect(screen.getByTitle("main")).toBeInTheDocument();
    expect(screen.queryByTitle("feature/new")).not.toBeInTheDocument();

    createResult.resolve({ branch: "feature/new" });

    await waitFor(() => {
      expect(api.fetchWorktrees).toHaveBeenCalledTimes(3);
    });
    expect(screen.getByTitle("main")).toBeInTheDocument();
    expect(screen.queryByTitle("feature/new")).not.toBeInTheDocument();
  });

  it("selects the new worktree when nothing was selected before creation", async () => {
    const creatingWorktree = createWorktree("feature/new", {
      creating: true,
      creationPhase: "creating_worktree",
    });
    const newWorktree = createWorktree("feature/new");
    const createResult = deferred<{ branch: string }>();

    vi.mocked(api.fetchWorktrees)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([creatingWorktree])
      .mockResolvedValueOnce([newWorktree])
      .mockResolvedValue([newWorktree]);
    vi.mocked(api.createWorktree).mockReturnValueOnce(createResult.promise);

    render(App);

    await screen.findByText("Select a worktree");

    await openCreateDialogAndSubmit("feature/new");
    createResult.resolve({ branch: "feature/new" });

    await waitFor(() => {
      expect(api.fetchWorktrees).toHaveBeenCalledTimes(3);
    });
    expect(screen.getByTitle("feature/new")).toBeInTheDocument();
  });
});
