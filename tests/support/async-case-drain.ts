/** A runner timeout stops awaiting a case; it does not cancel its JavaScript.
 * Keep that body observed and prevent another shared fixture reset until it ends. */
export function createAsyncCaseDrainFence(options: { drainTimeoutMs: number }) {
  if (
    !Number.isSafeInteger(options.drainTimeoutMs) ||
    options.drainTimeoutMs < 1
  )
    throw new Error("async_case_drain_invalid_timeout");
  const pending = new Set<Promise<void>>();
  let poisoned = false;
  const assertReady = () => {
    if (poisoned) throw new Error("async_case_drain_poisoned");
    if (pending.size) throw new Error("async_case_body_still_running");
  };
  return {
    assertReady,
    run<T>(body: () => Promise<T>): Promise<T> {
      // Invoke asynchronously so synchronous throws are also tracked/observed.
      // Poisoned attempts also get an immediate rejection observer.
      const result = poisoned
        ? Promise.reject<T>(new Error("async_case_drain_poisoned"))
        : Promise.resolve().then(body);
      const observed = result.then(
        () => {
          pending.delete(observed);
        },
        () => {
          pending.delete(observed);
        },
      );
      pending.add(observed);
      return result;
    },
    async drain(): Promise<void> {
      if (poisoned) throw new Error("async_case_drain_poisoned");
      const startedAt = performance.now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          (async () => {
            // Bodies can start tracked cleanup work while completing.
            while (pending.size) await Promise.all([...pending]);
          })(),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
              poisoned = true;
              reject(new Error("async_case_drain_timeout"));
            }, options.drainTimeoutMs);
          }),
        ]);
        // A busy event loop can postpone the timer behind body microtasks.
        // The timer is only a wakeup; monotonic elapsed time owns the bound.
        if (performance.now() - startedAt >= options.drainTimeoutMs) {
          poisoned = true;
          throw new Error("async_case_drain_timeout");
        }
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },
  };
}
