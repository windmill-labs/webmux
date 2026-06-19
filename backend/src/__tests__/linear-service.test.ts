import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  buildLinearIssuesResponse,
  createLinearIssue,
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

import {
  buildLinearPickupMarkdown,
  buildLinearSummaryMarkdown,
  buildWebmuxAttachmentTitle,
  findLinkedGitHubPr,
  findWebmuxAttachment,
  parseLinearTarget,
  type LinearAttachment,
} from "../services/linear-service";

describe("parseLinearTarget", () => {
  it("parses an issue id", () => {
    expect(parseLinearTarget("ENG-123")).toEqual({ kind: "issue", issueId: "ENG-123" });
  });

  it("parses a team key", () => {
    expect(parseLinearTarget("ENG")).toEqual({ kind: "team", teamKey: "ENG" });
  });

  it("trims whitespace before classifying", () => {
    expect(parseLinearTarget("  ENG-42  ")).toEqual({ kind: "issue", issueId: "ENG-42" });
  });

  it("returns invalid for anything else", () => {
    expect(parseLinearTarget("eng-1").kind).toBe("invalid");
    expect(parseLinearTarget("ENG-").kind).toBe("invalid");
    expect(parseLinearTarget("123").kind).toBe("invalid");
    expect(parseLinearTarget("").kind).toBe("invalid");
  });
});

describe("buildWebmuxAttachmentTitle", () => {
  it("prefixes the branch", () => {
    expect(buildWebmuxAttachmentTitle("feat/foo")).toBe("webmux-state:feat/foo");
  });
});

function attachment(partial: Partial<LinearAttachment> & { id: string; url: string; title: string; createdAt: string }): LinearAttachment {
  return {
    subtitle: null,
    sourceType: null,
    metadata: null,
    ...partial,
  };
}

describe("findWebmuxAttachment", () => {
  it("returns null when no webmux attachments are present", () => {
    expect(findWebmuxAttachment({ attachments: [] })).toBeNull();
    expect(findWebmuxAttachment({ attachments: [
      attachment({ id: "a", url: "u", title: "some PR", createdAt: "2026-01-01" }),
    ]})).toBeNull();
  });

  it("prefers an exact branch match over the newest", () => {
    const result = findWebmuxAttachment({
      attachments: [
        attachment({ id: "1", url: "u1", title: "webmux-state:feat/other", createdAt: "2026-05-01" }),
        attachment({ id: "2", url: "u2", title: "webmux-state:feat/foo", createdAt: "2026-04-01" }),
      ],
    }, "feat/foo");
    expect(result?.id).toBe("2");
  });

  it("falls back to newest webmux attachment when no branch hint matches", () => {
    const result = findWebmuxAttachment({
      attachments: [
        attachment({ id: "1", url: "u1", title: "webmux-state:feat/other", createdAt: "2026-04-01" }),
        attachment({ id: "2", url: "u2", title: "webmux-state:feat/old", createdAt: "2026-05-01" }),
      ],
    });
    expect(result?.id).toBe("2");
  });
});

describe("findLinkedGitHubPr", () => {
  it("returns null when there are no github attachments", () => {
    expect(findLinkedGitHubPr({ attachments: [] })).toBeNull();
  });

  it("prefers open over closed, then merged, then newest", () => {
    const result = findLinkedGitHubPr({
      attachments: [
        attachment({
          id: "1", url: "https://github.com/org/repo/pull/1", title: "PR 1",
          createdAt: "2026-05-01", sourceType: "github",
          metadata: { state: "closed", branchName: "feat/old" },
        }),
        attachment({
          id: "2", url: "https://github.com/org/repo/pull/2", title: "PR 2",
          createdAt: "2026-04-01", sourceType: "github",
          metadata: { state: "open", branchName: "feat/foo" },
        }),
        attachment({
          id: "3", url: "https://github.com/org/repo/pull/3", title: "PR 3",
          createdAt: "2026-06-01", sourceType: "github",
          metadata: { state: "merged", branchName: "feat/done" },
        }),
      ],
    });
    expect(result?.branch).toBe("feat/foo");
    expect(result?.state).toBe("open");
  });

  it("detects github attachments by URL when sourceType is missing", () => {
    const result = findLinkedGitHubPr({
      attachments: [
        attachment({
          id: "1", url: "https://github.com/org/repo/pull/42", title: "Pull 42",
          createdAt: "2026-05-01",
        }),
      ],
    });
    expect(result?.url).toBe("https://github.com/org/repo/pull/42");
    expect(result?.state).toBe("unknown");
  });
});

describe("buildLinearPickupMarkdown", () => {
  it("renders the pickup comment verbatim", () => {
    // Pins the exact wire format because external automation greps the
    // prefix — changing it silently would break those integrations.
    const md = buildLinearPickupMarkdown({
      branch: "eng-200-oneshot",
      pickedUpAt: new Date("2026-05-20T12:34:56.789Z"),
    });
    expect(md).toBe(
      "**Webmux pickup — branch `eng-200-oneshot`**\n" +
      "\n" +
      "- Picked up: 2026-05-20T12:34:56.789Z",
    );
  });
});

describe("buildLinearSummaryMarkdown", () => {
  it("includes turns and the attachment title", () => {
    const md = buildLinearSummaryMarkdown({
      branch: "feat/foo",
      baseBranch: "main",
      turns: 7,
      prUrl: "https://github.com/org/repo/pull/12",
      attachmentTitle: "webmux-state:feat/foo",
      webmuxVersion: "0.31.0",
    });
    expect(md).toContain("feat/foo");
    expect(md).toContain("Turns: 7");
    expect(md).toContain("PR: https://github.com/org/repo/pull/12");
    expect(md).toContain("webmux-state:feat/foo");
    expect(md).toContain("0.31.0");
    // Guards against the rename regression that shipped --resume-from-linear
    // instructions to users after the flag was consolidated into --linear.
    // (--from-linear is still valid on `webmux add`, so don't assert against it.)
    expect(md).toContain("webmux oneshot --linear");
    expect(md).not.toContain("--resume-from-linear");
  });
});
