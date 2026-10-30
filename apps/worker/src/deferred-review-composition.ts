import {
  EarlyBirdDeferredReviewPreparation,
  PostgresWorkerReviewSource,
  PostgresDeferredAccountWriter,
  type DrizzleDb,
} from "@ii-tonya/db";
import { createDeferredReviewJob } from "@ii-tonya/worker";

/** Explicit wiring; no environment variable enables this factory by itself. */
export function createDeferredReviewWorker(options?: {
  sourceDb: DrizzleDb;
  sourceLogin: string;
  prepareDb: DrizzleDb;
  prepareLogin: string;
  identityKey: Buffer;
}) {
  if (!options) return undefined;
  if (
    !Buffer.isBuffer(options.identityKey) ||
    options.identityKey.length !== 32
  )
    throw new Error("early_bird_deferred_identity_invalid");
  const source = new PostgresWorkerReviewSource(
    options.sourceDb,
    options.sourceLogin,
  );
  const payments = new PostgresDeferredAccountWriter(
    options.prepareDb,
    options.prepareLogin,
  );
  const preparation = new EarlyBirdDeferredReviewPreparation(
    source,
    payments,
    options.identityKey,
  );
  return createDeferredReviewJob(source, preparation);
}
