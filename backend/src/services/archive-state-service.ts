import {
  readWorktreeArchiveState,
  writeWorktreeArchiveState,
} from "../adapters/fs";
import type { WorktreeArchiveState } from "../domain/model";
import {
  pruneArchivedWorktreeState,
  setArchivedWorktreeState,
} from "./archive-service";

function archiveStatesEqual(
  left: WorktreeArchiveState,
  right: WorktreeArchiveState,
): boolean {
  if (left.schemaVersion !== right.schemaVersion) return false;
  if (left.entries.length !== right.entries.length) return false;

  return left.entries.every((entry, index) =>
    entry.path === right.entries[index]?.path
      && entry.archivedAt === right.entries[index]?.archivedAt
  );
}

export interface ArchiveStateServiceDependencies {
  readState?: (gitDir: string) => Promise<WorktreeArchiveState>;
  writeState?: (gitDir: string, state: WorktreeArchiveState) => Promise<void>;
}

export class ArchiveStateService {
  private mutationQueue = Promise.resolve();
  private readonly readState: (gitDir: string) => Promise<WorktreeArchiveState>;
  private readonly writeState: (gitDir: string, state: WorktreeArchiveState) => Promise<void>;

  constructor(
    private readonly gitDir: string,
    deps: ArchiveStateServiceDependencies = {},
  ) {
    this.readState = deps.readState ?? readWorktreeArchiveState;
    this.writeState = deps.writeState ?? writeWorktreeArchiveState;
  }

  async read(): Promise<WorktreeArchiveState> {
    return await this.readState(this.gitDir);
  }

  async setArchived(path: string, archived: boolean): Promise<WorktreeArchiveState> {
    return await this.mutate((state) =>
      setArchivedWorktreeState({
        state,
        path,
        archived,
      })
    );
  }

  async prune(paths: string[]): Promise<WorktreeArchiveState> {
    return await this.mutate((state) =>
      pruneArchivedWorktreeState({
        state,
        paths,
      })
    );
  }

  private async mutate(
    transform: (state: WorktreeArchiveState) => WorktreeArchiveState | Promise<WorktreeArchiveState>,
  ): Promise<WorktreeArchiveState> {
    return await this.withMutationLock(async () => {
      const state = await this.readState(this.gitDir);
      const nextState = await transform(state);

      if (!archiveStatesEqual(state, nextState)) {
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
