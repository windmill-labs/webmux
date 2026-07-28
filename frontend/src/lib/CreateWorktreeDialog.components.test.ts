import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CreateWorktreeDialog from "./CreateWorktreeDialog.svelte";

describe("CreateWorktreeDialog components", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => cleanup());

  it("includes selected components in the create request", async () => {
    const oncreate = vi.fn();
    render(CreateWorktreeDialog, {
      props: {
        profiles: [{ name: "app-services", componentsEnabled: true }],
        componentCatalog: {
          status: "ready",
          components: [
            { id: "mappings-v2", label: "Mappings v2", kind: "service" },
          ],
          error: null,
        },
        agents: [{
          id: "claude",
          label: "Claude",
          kind: "builtin",
          capabilities: {
            terminal: true,
            inAppChat: true,
            conversationHistory: true,
            interrupt: true,
            resume: true,
          },
        }],
        defaultProfileName: "app-services",
        defaultAgentId: "claude",
        includeRemoteBranches: false,
        oncreate,
        oncancel: vi.fn(),
      },
    });

    await fireEvent.click(screen.getByRole("checkbox", { name: /Mappings v2/ }));
    await fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(oncreate).toHaveBeenCalledWith(expect.objectContaining({
        profile: "app-services",
        agents: ["claude"],
        components: ["mappings-v2"],
      }));
    });
  });
});
