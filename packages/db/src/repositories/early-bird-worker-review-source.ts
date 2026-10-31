import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import { requireWorkerReviewPrincipal } from "./early-bird-worker-review-principal.js";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
/** Dedicated read-only worker principal; the database rechecks approval and consent. */
export class PostgresWorkerReviewSource {
  constructor(
    private readonly db: DrizzleDb,
    private readonly expectedLogin: string,
  ) {}
  async list(
    after: string | undefined,
    limit: number,
  ): Promise<{ applicationId: string; eventId: string }[]> {
    if (
      (after !== undefined && !uuid.test(after)) ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw new Error("early_bird_worker_review_invalid");
    return this.db.transaction(async (tx) => {
      await requireWorkerReviewPrincipal(tx, this.expectedLogin);
      const rows = (
        await tx.execute<{ applicationId: string; eventId: string }>(
          sql`select application_id as "applicationId",event_id as "eventId" from early_bird_worker_review_list(${after ?? null}::uuid,${limit}::integer)`,
        )
      ).rows;
      if (
        rows.length > limit ||
        rows.some((r) => !uuid.test(r.applicationId) || !uuid.test(r.eventId))
      )
        throw new Error("early_bird_worker_review_invalid");
      return rows;
    });
  }
  async resolve(input: {
    applicationId: string;
    eventId: string;
  }): Promise<{
    userId: string;
    baseId: string;
    choiceId: string;
    configId: string;
  } | null> {
    if (!uuid.test(input.applicationId) || !uuid.test(input.eventId))
      return null;
    return this.db.transaction(
      async (tx) => {
        await requireWorkerReviewPrincipal(tx, this.expectedLogin);
        const rows = (
          await tx.execute<{
            userId: string;
            baseId: string;
            choiceId: string;
            configId: string;
          }>(
            sql`select user_id as "userId",base_id as "baseId",choice_id as "choiceId",config_id as "configId" from early_bird_worker_review_resolve(${input.applicationId}::uuid,${input.eventId}::uuid)`,
          )
        ).rows;
        if (rows.length !== 1) return null;
        const value = rows[0]!;
        if (
          ![value.userId, value.baseId, value.choiceId, value.configId].every(
            (v) => uuid.test(v),
          )
        )
          throw new Error("early_bird_worker_review_invalid");
        return value;
      },
      { isolationLevel: "serializable" },
    );
  }
}
