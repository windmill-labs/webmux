export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const concurrency = Math.max(1, Math.min(limit, items.length || 1));

  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

export interface SerializedIntervalDependencies<THandle = ReturnType<typeof setInterval>> {
  scheduleEvery?: (handler: () => void, intervalMs: number) => THandle;
  cancelSchedule?: (handle: THandle) => void;
}

export function startSerializedInterval<THandle = ReturnType<typeof setInterval>>(
  run: () => Promise<void>,
  intervalMs: number,
  deps: SerializedIntervalDependencies<THandle> = {},
): () => void {
  const scheduleEvery = deps.scheduleEvery ?? ((handler, ms) => setInterval(handler, ms) as THandle);
  const cancelSchedule = deps.cancelSchedule ?? ((handle) => clearInterval(handle as ReturnType<typeof setInterval>));
  let running = false;
  let rerunRequested = false;
  let stopped = false;

  const execute = (): void => {
    if (stopped) return;
    if (running) {
      rerunRequested = true;
      return;
    }

    running = true;
    void Promise.resolve()
      .then(run)
      .finally(() => {
        running = false;
        if (stopped || !rerunRequested) return;
        rerunRequested = false;
        execute();
      });
  };

  execute();
  const handle = scheduleEvery(execute, intervalMs);

  return (): void => {
    stopped = true;
    cancelSchedule(handle);
  };
}
