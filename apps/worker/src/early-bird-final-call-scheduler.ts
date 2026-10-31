/** Explicit capability: no environment setting can turn this on implicitly. */
export function createFinalCallScheduler(
  runtime: { run(limit: number, signal: AbortSignal): Promise<unknown> },
  now: () => number = () => performance.now(),
) {
  const abort = new AbortController();
  let next = Number.NEGATIVE_INFINITY,
    running = false;
  return {
    async run(): Promise<unknown | null> {
      if (abort.signal.aborted || running || now() < next) return null;
      running = true;
      next = now() + 60000;
      try {
        return await runtime.run(20, abort.signal);
      } finally {
        running = false;
      }
    },
    stop() {
      abort.abort();
    },
  };
}
