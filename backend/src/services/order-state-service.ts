import {
  readWorktreeOrderState,
  writeWorktreeOrderState,
} from "../adapters/fs";
import type { WorktreeOrderState } from "../domain/model";
import {
  createWorktreeOrderState,
  pruneWorktreeOrder,
} from "./order-service";

function orderStatesEqual(
  left: WorktreeOrderState,
  right: WorktreeOrderState,
): boolean {
  if (left.schemaVersion !== right.schemaVersion) return false;
  if (left.branches.length !== right.branches.length) return false;

  return left.branches.every((branch, index) => branch === right.branches[index]);
}

export interface OrderStateServiceDependencies {
  readState?: (gitDir: string) => Promise<WorktreeOrderState>;
  writeState?: (gitDir: string, state: WorktreeOrderState) => Promise<void>;
}

export class OrderStateService {
  private mutationQueue = Promise.resolve();
  private readonly readState: (gitDir: string) => Promise<WorktreeOrderState>;
  private readonly writeState: (gitDir: string, state: WorktreeOrderState) => Promise<void>;

  constructor(
    private readonly gitDir: string,
    deps: OrderStateServiceDependencies = {},
  ) {
    this.readState = deps.readState ?? readWorktreeOrderState;
    this.writeState = deps.writeState ?? writeWorktreeOrderState;
  }

  async read(): Promise<WorktreeOrderState> {
    return await this.readState(this.gitDir);
  }

  async setOrder(branches: string[]): Promise<WorktreeOrderState> {
    return await this.mutate(() => createWorktreeOrderState(branches));
  }

  async prune(branches: string[]): Promise<WorktreeOrderState> {
    return await this.mutate((state) =>
      pruneWorktreeOrder({
        state,
        branches,
      })
    );
  }

  private async mutate(
    transform: (state: WorktreeOrderState) => WorktreeOrderState | Promise<WorktreeOrderState>,
  ): Promise<WorktreeOrderState> {
    return await this.withMutationLock(async () => {
      const state = await this.readState(this.gitDir);
      const nextState = await transform(state);

      if (!orderStatesEqual(state, nextState)) {
        await this.writeState(this.gitDir, nextState);
      }

      return nextState;
    });
  }

  private async withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationQueue;
    let release = () => {};
    this.mutationQueue = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous.catch(() => {});
    try {
      return await operation();
    } finally {
      release();
    }
  }
}
