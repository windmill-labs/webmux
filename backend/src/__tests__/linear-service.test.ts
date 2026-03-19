import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  buildLinearIssuesResponse,
  createLinearIssue,
  deriveLinearIssueTitle,
  fetchAssignedIssues,
  parseIssueCreateResponse,
  resetLinearCaches,
} from "../services/linear-service";

const originalFetch = globalThis.fetch;
const originalLinearApiKey = Bun.env.LINEAR_API_KEY;

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function createIssueNode(identifier: string, branchName: string): Record<string, unknown> {
  return {
    id: `${identifier.toLowerCase()}-id`,
    identifier,
    title: `${identifier} title`,
    description: `${identifier} description`,
    priority: 0,
    priorityLabel: "No priority",
    url: `https://linear.app/acme/issue/${identifier}`,
    branchName,
    dueDate: null,
    updatedAt: "2026-03-19T09:00:00.000Z",
    state: {
      name: "Todo",
      color: "#999999",
      type: "unstarted",
    },
    team: {
      name: "Engineering",
      key: "ENG",
    },
    labels: {
      nodes: [],
    },
    project: null,
  };
}

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

describe("deriveLinearIssueTitle", () => {
  it("prefers the explicit title when present", () => {
    expect(deriveLinearIssueTitle("Manual title", "Prompt line")).toBe("Manual title");
  });

  it("falls back to the first non-empty prompt line", () => {
    expect(deriveLinearIssueTitle(undefined, "\n  First useful line\nSecond line")).toBe("First useful line");
  });

  it("returns null when no title can be derived", () => {
    expect(deriveLinearIssueTitle("   ", "\n \n")).toBeNull();
  });
});

describe("parseIssueCreateResponse", () => {
  it("rejects responses without a branch name", () => {
    const result = parseIssueCreateResponse({
      data: {
        issueCreate: {
          success: true,
          issue: {
            id: "issue-1",
            identifier: "ENG-1",
            title: "Missing branch",
            url: "https://linear.app/acme/issue/ENG-1",
            branchName: null,
          },
        },
      },
    });

    expect(result).toEqual({
      ok: false,
      error: "Linear issue did not return a branch name",
    });
  });
});

describe("Linear issue creation", () => {
  beforeEach(() => {
    resetLinearCaches();
    Bun.env.LINEAR_API_KEY = "test-linear-key";
    process.env.LINEAR_API_KEY = "test-linear-key";
  });

  afterEach(() => {
    resetLinearCaches();
    globalThis.fetch = originalFetch;
    if (originalLinearApiKey === undefined) {
      delete Bun.env.LINEAR_API_KEY;
      delete process.env.LINEAR_API_KEY;
      return;
    }
    Bun.env.LINEAR_API_KEY = originalLinearApiKey;
    process.env.LINEAR_API_KEY = originalLinearApiKey;
  });

  it("invalidates the assigned issue cache after creating a ticket", async () => {
    const responses = [
      jsonResponse({
        data: {
          viewer: {
            assignedIssues: {
              nodes: [createIssueNode("ENG-1", "user/eng-1-old-work")],
            },
          },
        },
      }),
      jsonResponse({
        data: {
          viewer: {
            id: "viewer-1",
          },
        },
      }),
      jsonResponse({
        data: {
          team: {
            states: {
              nodes: [
                {
                  id: "state-backlog",
                  name: "Backlog",
                  type: "unstarted",
                },
                {
                  id: "state-in-progress",
                  name: "In Progress",
                  type: "started",
                },
              ],
            },
          },
        },
      }),
      jsonResponse({
        data: {
          issueCreate: {
            success: true,
            issue: {
              id: "issue-2",
              identifier: "ENG-2",
              title: "New issue",
              url: "https://linear.app/acme/issue/ENG-2",
              branchName: "user/eng-2-new-issue",
            },
          },
        },
      }),
      jsonResponse({
        data: {
          viewer: {
            assignedIssues: {
              nodes: [createIssueNode("ENG-2", "user/eng-2-new-issue")],
            },
          },
        },
      }),
    ];

    let callCount = 0;
    const requestBodies: Record<string, unknown>[] = [];
    globalThis.fetch = Object.assign(
      async function fetchMock(_input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
        if (typeof init?.body === "string") {
          requestBodies.push(JSON.parse(init.body) as Record<string, unknown>);
        }
        const response = responses[callCount];
        callCount += 1;
        return response ?? new Response("unexpected request", { status: 500 });
      },
      { preconnect: originalFetch.preconnect },
    );

    const firstFetch = await fetchAssignedIssues();
    expect(firstFetch).toEqual({
      ok: true,
      data: [expect.objectContaining({ identifier: "ENG-1" })],
    });

    const cachedFetch = await fetchAssignedIssues();
    expect(cachedFetch).toEqual(firstFetch);
    expect(callCount).toBe(1);

    const created = await createLinearIssue({
      title: "New issue",
      description: "Ticket description",
      teamId: "team-1",
    });
    expect(created).toEqual({
      ok: true,
      data: {
        id: "issue-2",
        identifier: "ENG-2",
        title: "New issue",
        url: "https://linear.app/acme/issue/ENG-2",
        branchName: "user/eng-2-new-issue",
      },
    });
    expect(requestBodies[2]).toEqual({
      query: expect.stringContaining("query TeamStates"),
      variables: {
        teamId: "team-1",
      },
    });
    expect(requestBodies[3]).toEqual({
      query: expect.stringContaining("mutation IssueCreate"),
      variables: {
        input: {
          title: "New issue",
          description: "Ticket description",
          teamId: "team-1",
          assigneeId: "viewer-1",
          stateId: "state-in-progress",
        },
      },
    });

    const refreshedFetch = await fetchAssignedIssues();
    expect(refreshedFetch).toEqual({
      ok: true,
      data: [expect.objectContaining({ identifier: "ENG-2" })],
    });
    expect(callCount).toBe(5);
  });
});
