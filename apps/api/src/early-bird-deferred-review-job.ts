import {
  boundedEarlyBirdWait,
  invokeEarlyBirdPreparation,
  type EarlyBirdReviewPreparation,
} from "./early-bird-review-prepare.js";
import type { EarlyBirdApprovedEventReader } from "./early-bird-review-reconciler.js";
/** One event per poll bounds shutdown; already-started DB work cannot be forcibly canceled. */
export function createDeferredReviewJob(
  reader: EarlyBirdApprovedEventReader,
  preparation: EarlyBirdReviewPreparation,
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
        const events = await boundedEarlyBirdWait(read, 5000);
        if (events.length > 1)
          throw new Error("early_bird_reconcile_reader_invalid");
        if (signal.aborted) return null;
        if (events.length === 0) {
          cursor = undefined;
          return { processed: 0, failed: 0 };
        }
        const event = events[0]!;
        cursor = event.eventId;
        try {
          await boundedEarlyBirdWait(
            invokeEarlyBirdPreparation(preparation, event),
            5000,
          );
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
