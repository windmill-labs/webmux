import { describe, expect, it } from "bun:test";
import { buildLinearIssuesResponse } from "../services/linear-service";

describe("buildLinearIssuesResponse", () => {
  it("returns a disabled state when the Linear integration is turned off", () => {
    const result = buildLinearIssuesResponse({
      integrationEnabled: false,
      apiKey: undefined,
    });

    expect(result).toEqual({
      ok: true,
      data: {
        availability: "disabled",
        issues: [],
      },
    });
  });

  it("returns a setup state when LINEAR_API_KEY is missing", () => {
    const result = buildLinearIssuesResponse({
      integrationEnabled: true,
      apiKey: "",
    });

    expect(result).toEqual({
      ok: true,
      data: {
        availability: "missing_api_key",
        issues: [],
      },
    });
  });

  it("returns an error when LINEAR_API_KEY is set but the fetch result is omitted", () => {
    const result = buildLinearIssuesResponse({
      integrationEnabled: true,
      apiKey: "linear-key",
    });

    expect(result).toEqual({
      ok: false,
      error: "Linear fetch result required when LINEAR_API_KEY is set",
    });
  });

  it("returns issues when the integration is enabled and configured", () => {
    const result = buildLinearIssuesResponse({
      integrationEnabled: true,
      apiKey: "linear-key",
      fetchResult: {
        ok: true,
        data: [
          {
            id: "issue-1",
            identifier: "ENG-123",
            title: "Ship the Linear panel",
            description: null,
            priority: 1,
            priorityLabel: "Urgent",
            url: "https://linear.app/acme/issue/ENG-123",
            branchName: "eng-123-linear-panel",
            dueDate: null,
            updatedAt: "2026-03-19T10:00:00.000Z",
            state: {
              name: "In Progress",
              color: "#f59e0b",
              type: "started",
            },
            team: {
              name: "Engineering",
              key: "ENG",
            },
            labels: [],
            project: null,
          },
        ],
      },
    });

    expect(result).toEqual({
      ok: true,
      data: {
        availability: "ready",
        issues: [
          {
            id: "issue-1",
            identifier: "ENG-123",
            title: "Ship the Linear panel",
            description: null,
            priority: 1,
            priorityLabel: "Urgent",
            url: "https://linear.app/acme/issue/ENG-123",
            branchName: "eng-123-linear-panel",
            dueDate: null,
            updatedAt: "2026-03-19T10:00:00.000Z",
            state: {
              name: "In Progress",
              color: "#f59e0b",
              type: "started",
            },
            team: {
              name: "Engineering",
              key: "ENG",
            },
            labels: [],
            project: null,
          },
        ],
      },
    });
  });

  it("propagates fetch errors when the integration is configured but the request fails", () => {
    const result = buildLinearIssuesResponse({
      integrationEnabled: true,
      apiKey: "linear-key",
      fetchResult: {
        ok: false,
        error: "Linear API 401: Unauthorized",
      },
    });

    expect(result).toEqual({
      ok: false,
      error: "Linear API 401: Unauthorized",
    });
  });
});
