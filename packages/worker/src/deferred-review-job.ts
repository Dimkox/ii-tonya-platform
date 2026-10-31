type Event = Readonly<{ applicationId: string; eventId: string }>;
type Reader = {
  list(after: string | undefined, limit: number): Promise<Event[]>;
};
type Preparation = { afterApproval(event: Event): Promise<void> };
const inFlight = new Map<string, Promise<void>>();
async function bounded<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("early_bird_operation_timeout")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
/** One event per poll. A timed-out operation remains coalesced until it settles. */
export function createDeferredReviewJob(
  reader: Reader,
  preparation: Preparation,
) {
  let cursor: string | undefined,
    running = false,
    reading = false;
  return {
    async run(
      limit: number,
      signal: AbortSignal,
    ): Promise<{ processed: number; failed: number } | null> {
      if (signal.aborted || running || reading) return null;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
        throw new Error("early_bird_reconcile_limit");
      running = true;
      try {
        reading = true;
        const read = Promise.resolve().then(() => reader.list(cursor, 1));
        void read.then(
          () => {
            reading = false;
          },
          () => {
            reading = false;
          },
        );
        const events = await bounded(read, 5000);
        if (events.length > 1)
          throw new Error("early_bird_reconcile_reader_invalid");
        if (signal.aborted) return null;
        if (events.length === 0) {
          cursor = undefined;
          return { processed: 0, failed: 0 };
        }
        const event = events[0]!;
        cursor = event.eventId;
        let work = inFlight.get(event.eventId);
        if (!work) {
          work = Promise.resolve().then(() => preparation.afterApproval(event));
          inFlight.set(event.eventId, work);
          const current = work;
          void current.then(
            () => {
              if (inFlight.get(event.eventId) === current)
                inFlight.delete(event.eventId);
            },
            () => {
              if (inFlight.get(event.eventId) === current)
                inFlight.delete(event.eventId);
            },
          );
        }
        try {
          await bounded(work, 5000);
          return { processed: 1, failed: 0 };
        } catch {
          return { processed: 0, failed: 1 };
        }
      } finally {
        running = false;
      }
    },
  };
}
