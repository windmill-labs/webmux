import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";
import ComponentStatusStrip from "./ComponentStatusStrip.svelte";

afterEach(() => cleanup());

describe("ComponentStatusStrip", () => {
  it("shows readiness and links an HTTP component port", () => {
    render(ComponentStatusStrip, {
      props: {
        components: [{
          id: "mappings-v2",
          label: "Mappings v2",
          kind: "service",
          paneIndex: 1,
          processStatus: "running",
          healthStatus: "ready",
          ports: { http: 24_000 },
          urls: { http: "http://127.0.0.1:24000" },
          exitCode: null,
        }],
      },
    });

    expect(screen.getByLabelText("Component status")).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: ":24000" })).toHaveAttribute(
      "href",
      "http://127.0.0.1:24000",
    );
  });

  it("renders nothing when no components were selected", () => {
    render(ComponentStatusStrip, { props: { components: [] } });
    expect(screen.queryByLabelText("Component status")).not.toBeInTheDocument();
  });
});
