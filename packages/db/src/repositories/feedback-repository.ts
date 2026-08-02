import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";

export interface SubmitFeedbackTransactionCommand {
  readonly userId: string;
  readonly reservationId?: string;
  readonly score: 1 | 2 | 3 | 4 | 5;
  readonly text?: string;
  readonly sourceEventId: string;
  readonly correlationId: string;
}

export interface FeedbackTransactionResult {
  readonly feedbackId: string;
  readonly escalated: boolean;
}

export interface CanonicalFeedbackReplay {
  readonly userId: string;
  readonly reservationId: string | null;
  readonly score: number;
  readonly contentHash: string;
  readonly negativePolicyVersion: string;
}

export class FeedbackIdempotencyConflictError extends Error {
  readonly code = "FEEDBACK_IDEMPOTENCY_CONFLICT";

  constructor() {
    super("Feedback source event conflicts with its original request");
    this.name = "FeedbackIdempotencyConflictError";
  }
}

export const assertFeedbackReplayMatches = (
  stored: CanonicalFeedbackReplay,
  replay: CanonicalFeedbackReplay,
): void => {
  if (
    stored.userId !== replay.userId ||
    stored.reservationId !== replay.reservationId ||
    stored.score !== replay.score ||
    stored.contentHash !== replay.contentHash ||
    stored.negativePolicyVersion !== replay.negativePolicyVersion
  ) {
    throw new FeedbackIdempotencyConflictError();
  }
};

const MAX_TEXT_LENGTH = 2_000;
const NEGATIVE_POLICY_VERSION = "negative-v1";
const digest = (value: string): string =>
  createHash("sha256").update(value).digest("hex");
const isExplicitNegative = (text: string): boolean =>
  /явно\s+негативн(?:ый|ого)\s+опыт/iu.test(text);

export class PostgresFeedbackRepository {
  constructor(private readonly db: DrizzleDb) {}

  async submitFeedbackTransaction(
    command: SubmitFeedbackTransactionCommand,
  ): Promise<FeedbackTransactionResult> {
    const text = command.text?.slice(0, MAX_TEXT_LENGTH);
    const contentHash = digest(text ?? "");
    const escalated = command.score <= 3 ||
      (text !== undefined && isExplicitNegative(text));
    const status = escalated ? "escalated" : "none";
    const replay = {
      userId: command.userId,
      reservationId: command.reservationId ?? null,
      score: command.score,
      contentHash,
      negativePolicyVersion: NEGATIVE_POLICY_VERSION,
    };

    return this.db.transaction(async (tx) => {
      const inserted = await tx.execute<{
        id: string;
        escalationStatus: string;
      }>(sql`
        insert into feedback (
          user_id, reservation_id, rating, source_event_id, content_hash,
          negative_policy_version, escalation_status
        ) values (
          ${command.userId}::uuid, ${command.reservationId ?? null}::uuid,
          ${command.score}, ${command.sourceEventId}, ${contentHash},
          ${NEGATIVE_POLICY_VERSION}, ${status}
        )
        on conflict (source_event_id) do nothing
        returning id, escalation_status as "escalationStatus"
      `);
      const first = inserted.rows[0];
      if (first === undefined) {
        const original = (await tx.execute<{
          id: string;
          userId: string;
          reservationId: string | null;
          score: number;
          contentHash: string;
          negativePolicyVersion: string;
          escalationStatus: string;
        }>(sql`
          select
            id,
            user_id as "userId",
            reservation_id as "reservationId",
            rating as score,
            content_hash as "contentHash",
            negative_policy_version as "negativePolicyVersion",
            escalation_status as "escalationStatus"
          from feedback
          where source_event_id = ${command.sourceEventId}
        `)).rows[0];
        if (original === undefined) {
          throw new Error("Feedback source event was not persisted");
        }
        assertFeedbackReplayMatches(original, replay);
        return {
          feedbackId: original.id,
          escalated: original.escalationStatus === "escalated",
        };
      }

      if (first.escalationStatus === "escalated") {
        const payload = {
          feedbackId: first.id,
          contentHash,
          policyVersion: NEGATIVE_POLICY_VERSION,
        };
        const serializedPayload = JSON.stringify(payload);
        await tx.execute(sql`
          insert into integration_outbox (
            idempotency_key, topic, payload, correlation_id, reconciliation_key,
            payload_hash
          ) values (
            ${`feedback:${first.id}:negative`}, 'admin.negative_feedback',
            ${serializedPayload}::jsonb, ${command.correlationId},
            ${`feedback:${first.id}`}, ${digest(serializedPayload)}
          )
        `);
        await tx.execute(sql`
          insert into audit_events (
            actor_type, actor_id, authenticated_session_id_hash, action,
            object_type, object_id, decision, reason_code, correlation_id,
            occurred_at, metadata_hash
          ) values (
            'system', ${command.userId}::uuid, ${digest(command.sourceEventId)},
            'feedback.escalated', 'feedback', ${first.id}::uuid, 'allowed',
            'negative_feedback_policy', ${command.correlationId}, now(),
            ${digest(`${first.id}:${contentHash}:${NEGATIVE_POLICY_VERSION}`)}
          )
        `);
      }

      return { feedbackId: first.id, escalated };
    });
  }
}
