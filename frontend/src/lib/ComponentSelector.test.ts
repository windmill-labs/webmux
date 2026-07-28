import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";
import ComponentSelector from "./ComponentSelector.svelte";

const components = [
  { id: "mappings-v2", label: "Mappings v2", kind: "service" },
  { id: "public-gateway", label: "Public Gateway", kind: "gateway" },
];

afterEach(() => cleanup());

describe("ComponentSelector", () => {
  it("filters components and updates the bound selection", async () => {
    render(ComponentSelector, {
      props: {
        components,
        selected: [],
      },
    });

    await fireEvent.input(screen.getByRole("searchbox", { name: "Components" }), {
      target: { value: "gateway" },
    });

    expect(screen.queryByText("Mappings v2")).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole("checkbox", { name: /Public Gateway/ }));
    expect(screen.getByText("1 selected")).toBeInTheDocument();
  });

  it("shows a catalog error without rendering selection controls", () => {
    render(ComponentSelector, {
      props: {
        components: [],
        selected: [],
        error: "catalog failed",
      },
    });

    expect(screen.getByText("Components unavailable: catalog failed")).toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });
});
