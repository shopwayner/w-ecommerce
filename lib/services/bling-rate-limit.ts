const queues = new Map<string, Promise<void>>();
const lastRunAt = new Map<string, number>();
const intervalMs = 500;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function scheduleBlingRequest<T>(connectionId: string, task: () => Promise<T>) {
  const previous = queues.get(connectionId) ?? Promise.resolve();

  const current = previous
    .catch(() => undefined)
    .then(async () => {
      const last = lastRunAt.get(connectionId) ?? 0;
      const delay = Math.max(0, intervalMs - (Date.now() - last));
      if (delay > 0) await wait(delay);
      lastRunAt.set(connectionId, Date.now());
      return task();
    });

  queues.set(
    connectionId,
    current.then(
      () => undefined,
      () => undefined
    )
  );

  // Development-only in-memory limiter. Replace with Redis/BullMQ before large jobs.
  return current;
}
