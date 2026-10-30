import type { createExpertVerificationService } from "@ii-tonya/application";

type Review = NonNullable<
  Parameters<typeof createExpertVerificationService>[0]["review"]
>;
/** Must look up the committed event, verify wave qualification and prepare idempotently. It must ignore non-wave approvals. */
export interface EarlyBirdReviewPreparation {
  afterApproval(input: {
    applicationId: string;
    eventId: string;
  }): Promise<void>;
}
// Coalesce immediate review callbacks and reconciliation in this process.
const pending = new Map<string, Promise<void>>();
export function earlyBirdPreparationInFlight(eventId: string): boolean {
  return pending.has(eventId);
}
export function invokeEarlyBirdPreparation(
  preparation: EarlyBirdReviewPreparation,
  input: { applicationId: string; eventId: string },
): Promise<void> {
  const prior = pending.get(input.eventId);
  if (prior) return prior;
  const operation = Promise.resolve().then(() =>
    preparation.afterApproval(input),
  );
  pending.set(input.eventId, operation);
  void operation.then(
    () => pending.delete(input.eventId),
    () => pending.delete(input.eventId),
  );
  return operation;
}
/** Timeout only bounds the caller's wait; it cannot cancel external work. */
export async function boundedEarlyBirdWait<T>(
  operation: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
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
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
/** Invokes preparation only after the manager decision commits. A confirmation replay retries it. */
export function wrapEarlyBirdReview(
  review: Review,
  preparation?: EarlyBirdReviewPreparation,
): Review {
  if (!preparation) return review;
  return {
    closeUnknown: (...args) => review.closeUnknown(...args),
    expireRequests: (...args) => review.expireRequests(...args),
    preview: (...args) => review.preview(...args),
    async confirm(session, applicationId, previewId, hash) {
      const result = await review.confirm(
        session,
        applicationId,
        previewId,
        hash,
      );
      if (
        result &&
        typeof result === "object" &&
        "action" in result &&
        "eventId" in result &&
        (result.action === "APPROVED_BASIC" ||
          result.action === "APPROVED_EXCLUSIVE") &&
        typeof result.eventId === "string" &&
        uuid.test(result.eventId)
      ) {
        await boundedEarlyBirdWait(
          invokeEarlyBirdPreparation(preparation, {
            applicationId,
            eventId: result.eventId,
          }),
          5000,
        );
      }
      return result;
    },
  };
}
