import {
  boundedEarlyBirdWait,
  earlyBirdPreparationInFlight,
  invokeEarlyBirdPreparation,
  type EarlyBirdReviewPreparation,
} from "./early-bird-review-prepare.js";
export type EarlyBirdApprovedEvent = { applicationId: string; eventId: string };
export interface EarlyBirdApprovedEventReader {
  list(
    after: string | undefined,
    limit: number,
  ): Promise<EarlyBirdApprovedEvent[]>;
}
const pendingReaders = new WeakSet<EarlyBirdApprovedEventReader>();
/** Caller schedules repeated full scans, resetting cursor to undefined after reaching the end. */
export async function reconcileEarlyBirdReviews(
  reader: EarlyBirdApprovedEventReader,
  preparation: EarlyBirdReviewPreparation,
  after?: string,
  limit = 50,
  timeoutMs = 5000,
): Promise<{ processed: number; failed: number; cursor?: string }> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new Error("early_bird_reconcile_limit");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000)
    throw new Error("early_bird_reconcile_timeout");
  if (pendingReaders.has(reader)) throw new Error("early_bird_reader_inflight");
  pendingReaders.add(reader);
  const read = Promise.resolve().then(() => reader.list(after, limit));
  void read.then(
    () => pendingReaders.delete(reader),
    () => pendingReaders.delete(reader),
  );
  const events = await boundedEarlyBirdWait(read, timeoutMs);
  if (events.length > limit)
    throw new Error("early_bird_reconcile_reader_invalid");
  let processed = 0;
  let failed = 0;
  for (const event of events) {
    if (earlyBirdPreparationInFlight(event.eventId)) {
      failed += 1;
      continue;
    }
    const operation = invokeEarlyBirdPreparation(preparation, event);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const outcome = await Promise.race([
      operation.then(
        () => true,
        () => false,
      ),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
    if (timer) clearTimeout(timer);
    if (outcome) processed += 1;
    else failed += 1;
  }
  return events.length === 0
    ? { processed, failed }
    : { processed, failed, cursor: events[events.length - 1]!.eventId };
}

/** Disabled until explicitly started; only opaque event IDs are passed to the authority. */
export function startEarlyBirdReviewReconciler(
  reader: EarlyBirdApprovedEventReader,
  preparation: EarlyBirdReviewPreparation,
  options: {
    intervalMs: number;
    onError: (error: { kind: "event" | "reader"; count: number }) => void;
  },
): () => void {
  if (
    !Number.isSafeInteger(options.intervalMs) ||
    options.intervalMs < 1000 ||
    typeof options.onError !== "function"
  )
    throw new Error("early_bird_reconcile_config");
  let cursor: string | undefined;
  let running = false;
  let stopped = false;
  const timer = setInterval(() => {
    if (running || stopped) return;
    running = true;
    void reconcileEarlyBirdReviews(reader, preparation, cursor)
      .then((result) => {
        cursor = result.cursor;
        if (result.failed > 0) {
          try {
            options.onError({ kind: "event", count: result.failed });
          } catch {
            /* Keep processing later scans. */
          }
        }
      })
      .catch(() => {
        try {
          options.onError({ kind: "reader", count: 1 });
        } catch {
          /* The next scan remains available. */
        }
      })
      .finally(() => {
        running = false;
      });
  }, options.intervalMs);
  timer.unref();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
