import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import PrStatusGroup from "./PrStatusGroup.svelte";
import type { PrEntry } from "./types";

function renderPr(overrides: Partial<PrEntry> = {}): ReturnType<typeof render> {
  return render(PrStatusGroup, {
    props: {
      pr: {
        repo: "origin",
        number: 42,
        state: "open",
        isDraft: false,
        url: "https://github.com/example/repo/pull/42",
        updatedAt: "2026-03-23T12:00:00.000Z",
        ciStatus: "success",
        ciChecks: [],
        comments: [],
        ...overrides,
      },
      onCiClick: vi.fn(),
      onReviewsClick: vi.fn(),
    },
  });
}

describe("PrStatusGroup draft indicator", () => {
  afterEach(() => cleanup());

  it("tags a draft PR and labels the link as a draft", () => {
    renderPr({ isDraft: true });

    expect(screen.getByText("draft")).toBeInTheDocument();
    expect(screen.getByTitle("Open draft PR")).toBeInTheDocument();
  });

  it("shows no draft tag once the PR is ready for review", () => {
    renderPr();

    expect(screen.queryByText("draft")).not.toBeInTheDocument();
    expect(screen.getByTitle("Open PR")).toBeInTheDocument();
  });

  it("ignores a stale draft flag on a merged PR", () => {
    renderPr({ state: "merged", isDraft: true });

    expect(screen.queryByText("draft")).not.toBeInTheDocument();
  });
});
