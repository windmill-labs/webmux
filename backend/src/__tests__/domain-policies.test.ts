import { describe, expect, it } from "bun:test";
import { allocateServicePorts } from "../domain/policies";

describe("allocateServicePorts", () => {
  it("allocates the first free slot across existing worktree metadata", () => {
    const ports = allocateServicePorts(
      [
        {
          schemaVersion: 1,
          worktreeId: "wt_1",
          branch: "feature/a",
          createdAt: "2026-03-06T00:00:00.000Z",
          profile: "default",
          agent: "claude",
          runtime: "host",
          startupEnvValues: {},
          allocatedPorts: { FRONTEND_PORT: 3010, BACKEND_PORT: 5111 },
        },
        {
          schemaVersion: 1,
          worktreeId: "wt_2",
          branch: "feature/b",
          createdAt: "2026-03-06T00:00:00.000Z",
          profile: "default",
          agent: "claude",
          runtime: "host",
          startupEnvValues: {},
          allocatedPorts: { FRONTEND_PORT: 3030, BACKEND_PORT: 5131 },
        },
      ],
      [
        { name: "frontend", portEnv: "FRONTEND_PORT", portStart: 3000, portStep: 10 },
        { name: "backend", portEnv: "BACKEND_PORT", portStart: 5101, portStep: 10 },
      ],
    );

    expect(ports).toEqual({
      FRONTEND_PORT: 3020,
      BACKEND_PORT: 5121,
    });
  });
});
