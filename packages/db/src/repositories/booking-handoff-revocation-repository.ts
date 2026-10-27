import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { bookingHandoffRevokedEventSchema } from "@ii-tonya/contracts";
import type { DrizzleDb } from "../client.js";
import { lockClientConsentSubject } from "./client-consent-authority.js";

const TOPIC = "booking.handoff_revoked";
const subjectShape =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function subjectId(payload: unknown): string | undefined {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload))
    return;
  const id = (payload as Record<string, unknown>).userId;
  return typeof id === "string" && subjectShape.test(id)
    ? id.toLowerCase()
    : undefined;
}

interface Candidate extends Record<string, unknown> {
  id: string;
  payload: unknown;
}
interface Source extends Candidate {
  topic: string;
  status: string;
  attempt: number;
  idempotencyKey: string;
  reconciliationKey: string;
  payloadHash: string;
  activeLease: boolean;
  hasAttempts: boolean;
}

export interface BookingHandoffRevocationResult {
  examined: number;
  processed: number;
  quarantined: number;
  operatorRequired: number;
}

/** Local accounting only: never sends or certifies remote deletion. */
export class PostgresBookingHandoffRevocationRepository {
  // Scheduling state only. Restarting repeats scans, never grants authority.
  private cursor: string | undefined;

  constructor(private readonly db: DrizzleDb) {}

  async consumePending(limit: number): Promise<BookingHandoffRevocationResult> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new RangeError("handoff_limit_must_be_integer_1_to_100");
    const result = {
      examined: 0,
      processed: 0,
      quarantined: 0,
      operatorRequired: 0,
    };
    let candidates = await this.candidates(limit);
    if (candidates.length === 0 && this.cursor !== undefined) {
      this.cursor = undefined;
      candidates = await this.candidates(limit);
    }
    for (const candidate of candidates) {
      this.cursor = candidate.id;
      result.examined++;
      try {
        const outcome = await this.consume(candidate);
        if (outcome === undefined) continue;
        if (outcome === "processed") result.processed++;
        else result.quarantined++;
        result.operatorRequired++;
      } catch (error) {
        const code =
          (error as { code?: string; cause?: { code?: string } })?.cause
            ?.code ?? (error as { code?: string })?.code;
        // A rolled-back authority wait consumes no work; the cursor reaches later subjects.
        if (code !== "55P03") throw error;
      }
    }
    return result;
  }

  private async candidates(limit: number): Promise<Candidate[]> {
    return (
      await this.db.execute<Candidate>(sql`
      select o.id,o.payload from integration_outbox o
      where o.topic=${TOPIC}
        and o.status in ('pending','retry_wait','processing','unknown_outcome','reconciling')
        and not exists(select 1 from booking_handoff_revocation_receipts r where r.source_outbox_id=o.id)
        ${this.cursor === undefined ? sql`` : sql`and o.id>${this.cursor}::uuid`}
      order by o.id limit ${limit}
    `)
    ).rows;
  }

  private async consume(candidate: Candidate): Promise<string | undefined> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout='50ms'`);
      await tx.execute(sql`set local statement_timeout='1000ms'`);
      const subject = subjectId(candidate.payload);
      // No source lock may precede the shared document/subject barriers.
      // Even malformed events with a UUID-shaped subject obey this order.
      if (subject !== undefined) await lockClientConsentSubject(tx, subject);
      const source = (
        await tx.execute<Source>(sql`
        select o.id,o.topic,o.payload,o.status,o.attempt,
          o.idempotency_key as "idempotencyKey",o.reconciliation_key as "reconciliationKey",
          o.payload_hash as "payloadHash",
          (coalesce(o.lease_until>=clock_timestamp(),false) or coalesce(o.reconciliation_lease_until>=clock_timestamp(),false)) as "activeLease",
          exists(select 1 from delivery_attempts a where a.outbox_id=o.id) as "hasAttempts"
        from integration_outbox o where o.id=${candidate.id}::uuid
        for update of o skip locked
      `)
      ).rows[0];
      if (
        !source ||
        source.topic !== TOPIC ||
        source.activeLease ||
        ![
          "pending",
          "retry_wait",
          "processing",
          "unknown_outcome",
          "reconciling",
        ].includes(source.status) ||
        subjectId(source.payload) !== subject
      )
        return;
      if (
        (
          await tx.execute(
            sql`select 1 from booking_handoff_revocation_receipts where source_outbox_id=${source.id}::uuid`,
          )
        ).rows.length
      )
        return;

      const parsed = bookingHandoffRevokedEventSchema.safeParse({
        topic: source.topic,
        payload: source.payload,
      });
      let consentId: string | undefined;
      if (parsed.success) {
        const payload = parsed.data.payload;
        // JSONB does not retain JS insertion order. Rebuild EXACT producer bytes.
        const payloadHash = createHash("sha256")
          .update(
            JSON.stringify({
              userId: payload.userId,
              consentDecisionId: payload.consentDecisionId,
              purpose: payload.purpose,
            }),
          )
          .digest("hex");
        if (
          source.payloadHash === payloadHash &&
          source.idempotencyKey ===
            `privacy:booking.handoff_revoked:${payload.consentDecisionId}` &&
          source.reconciliationKey ===
            `booking.handoff_revoked:${payload.consentDecisionId}`
        ) {
          const fact = (
            await tx.execute<{ id: string }>(sql`
            select id from consents where id=${payload.consentDecisionId}::uuid
              and user_id=${payload.userId}::uuid and consent_type='expert_handoff'
              and decision in ('denied','revoked')
          `)
          ).rows[0];
          // Append-only historical evidence is authoritative even after a later grant.
          consentId = fact?.id;
        }
      }
      const legacy =
        source.hasAttempts ||
        source.attempt > 0 ||
        !["pending", "retry_wait"].includes(source.status);
      const outcome =
        consentId === undefined
          ? "quarantined_invalid"
          : legacy
            ? "quarantined_legacy"
            : "processed";
      const coverage =
        consentId === undefined
          ? "invalid_source"
          : "historical_disclosure_untracked";
      const reason =
        consentId === undefined
          ? "handoff_invalid_source"
          : legacy
            ? "handoff_legacy_outcome_unverified"
            : "handoff_historical_disclosure_untracked";
      // Neutral templates contain no optional disclosure. Zero KNOWN actionable
      // recipients is not evidence of zero historical recipients or remote erasure.
      await tx.execute(sql`
        insert into booking_handoff_revocation_receipts(source_outbox_id,consent_decision_id,outcome,coverage,known_recipient_count)
        values(${source.id}::uuid,${consentId ?? null}::uuid,${outcome},${coverage},0)
      `);
      await tx.execute(sql`
        insert into outbox_operator_alerts(outbox_id,reason_code)
        values(${source.id}::uuid,${reason}) on conflict(outbox_id,reason_code) do nothing
      `);
      await tx.execute(sql`
        update integration_outbox set status=${outcome === "processed" ? "succeeded" : "dead_letter"},
          dispatch_owner_id=null,dispatch_claim_token=null,lease_until=null,
          reconciliation_owner_id=null,reconciliation_claim_token=null,reconciliation_lease_until=null,
          next_attempt_at=null,next_reconciliation_at=null,last_normalized_reason=${reason},updated_at=clock_timestamp()
        where id=${source.id}::uuid
      `);
      return outcome;
    });
  }
}
