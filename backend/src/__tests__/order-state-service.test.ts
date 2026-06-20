import { describe, expect, it } from "bun:test";
import { WORKTREE_ORDER_STATE_VERSION, type WorktreeOrderState } from "../domain/model";
import { OrderStateService } from "../services/order-state-service";

function cloneOrderState(state: WorktreeOrderState): WorktreeOrderState {
  return { schemaVersion: state.schemaVersion, branches: [...state.branches] };
}

function emptyOrderState(): WorktreeOrderState {
  return { schemaVersion: WORKTREE_ORDER_STATE_VERSION, branches: [] };
}

describe("order-state-service", () => {
  it("persists the requested branch order", async () => {
    let state = emptyOrderState();
    const service = new OrderStateService("/repo/.git", {
      readState: async () => cloneOrderState(state),
      writeState: async (_gitDir, nextState) => {
        state = cloneOrderState(nextState);
      },
    });

    await service.setOrder(["b", "a", "c"]);

    expect(state.branches).toEqual(["b", "a", "c"]);
  });

  it("does not write when the order is unchanged", async () => {
    let writes = 0;
    let state: WorktreeOrderState = { schemaVersion: WORKTREE_ORDER_STATE_VERSION, branches: ["a", "b"] };
    const service = new OrderStateService("/repo/.git", {
      readState: async () => cloneOrderState(state),
      writeState: async (_gitDir, nextState) => {
        writes++;
        state = cloneOrderState(nextState);
      },
    });

    await service.setOrder(["a", "b"]);

    expect(writes).toBe(0);
  });

  it("prunes branches that no longer exist", async () => {
    let state: WorktreeOrderState = { schemaVersion: WORKTREE_ORDER_STATE_VERSION, branches: ["a", "b", "c"] };
    const service = new OrderStateService("/repo/.git", {
      readState: async () => cloneOrderState(state),
      writeState: async (_gitDir, nextState) => {
        state = cloneOrderState(nextState);
      },
    });

    await service.prune(["a", "c"]);

    expect(state.branches).toEqual(["a", "c"]);
  });

  it("serializes concurrent mutations", async () => {
    let state = emptyOrderState();
    const service = new OrderStateService("/repo/.git", {
      readState: async () => {
        const snapshot = cloneOrderState(state);
        await Bun.sleep(5);
        return snapshot;
      },
      writeState: async (_gitDir, nextState) => {
        await Bun.sleep(5);
        state = cloneOrderState(nextState);
      },
    });

    await Promise.all([
      service.setOrder(["a", "b"]),
      service.setOrder(["b", "a"]),
    ]);

    expect(state.branches).toEqual(["b", "a"]);
  });
});
