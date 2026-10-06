import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import {
  clientConsentAuthoritySchema,
  clientDispatchPayloadDigest,
} from "@ii-tonya/contracts";

export type B2SensitiveRetentionResult = {
  readonly inboundPurged: number;
  readonly outboxRedacted: number;
  readonly proposalsRedacted: number;
};

const assertLimit = (limit: number): void => {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000)
    throw new RangeError("b2_retention_limit_invalid");
};

export class PostgresB2SensitiveRetentionRepository {
  constructor(private readonly db: DrizzleDb) {}

  async purgeExpired(
    now: Date,
    limit: number,
  ): Promise<B2SensitiveRetentionResult> {
    assertLimit(limit);
    if (!Number.isFinite(now.getTime()))
      throw new Error("b2_retention_now_invalid");
    return this.db.transaction(async (tx) => {
      const inbound = await tx.execute<{ count: number }>(sql`
        with candidates as materialized (
          select i.id,i.dialogue_id,i.provider,i.bot_key,i.provider_update_id,i.payload_hash,
            r.route,i.created_at,i.expires_at
          from dialogue_inbound i
          join dialogue_route_decisions r on r.inbound_id=i.id
          where i.expires_at <= ${now}::timestamptz
          order by i.expires_at,i.id
          for update of i skip locked
          limit ${limit}
        ), tombstones as (
          insert into dialogue_inbound_tombstones(
            dialogue_id,provider,bot_key,provider_update_id,payload_hash,route,
            occurred_at,purged_at
          ) select dialogue_id,provider,bot_key,provider_update_id,payload_hash,route,
              created_at,${now}::timestamptz from candidates
          on conflict(provider,bot_key,provider_update_id) do nothing
        ), routes as (
          delete from dialogue_route_decisions r using candidates c
          where r.inbound_id=c.id returning r.inbound_id
        ), deleted as (
          delete from dialogue_inbound i using candidates c
          where i.id=c.id returning i.id
        ) select count(*)::int count from deleted
      `);
      const outbox = await tx.execute<{
        id: string;
        topic: string;
        payload: Record<string, unknown>;
      }>(sql`
          select id,topic,payload from integration_outbox
          where topic in ('selarti.request.v1','telegram.send_text.v1')
            and status in ('succeeded','dead_letter')
            and sensitive_redacted_at is null
            and (
              topic='telegram.send_text.v1'
              or exists(
                select 1 from selarti_response_proposals p
                where p.request_id=integration_outbox.idempotency_key
              )
              or (
                topic='selarti.request.v1'
                and (payload->>'deadline')::timestamptz <= ${now}::timestamptz
              )
            )
          order by updated_at,id for update skip locked limit ${limit}
      `);
      for (const row of outbox.rows) {
        const authority = clientConsentAuthoritySchema.safeParse(
          row.payload.consentAuthority,
        );
        const retained =
          row.topic === "selarti.request.v1" &&
          authority.success &&
          authority.data.purposes.selarti_ai_processing
            ? {
                redacted: true,
                consentAuthorityDigest: clientDispatchPayloadDigest(
                  authority.data,
                ),
              }
            : { redacted: true };
        await tx.execute(
          sql`update integration_outbox set payload=${JSON.stringify(retained)}::jsonb,sensitive_redacted_at=${now}::timestamptz,updated_at=now() where id=${row.id}::uuid`,
        );
      }
      const proposals = await tx.execute<{ count: number }>(sql`
        with candidates as materialized (
          select id from selarti_response_proposals
          where expires_at <= ${now}::timestamptz and redacted_at is null
          order by expires_at,id for update skip locked limit ${limit}
        ), redacted as (
          update selarti_response_proposals p set text=null,redacted_at=${now}::timestamptz
          from candidates c where p.id=c.id returning p.id
        ) select count(*)::int count from redacted
      `);
      return {
        inboundPurged: Number(inbound.rows[0]?.count ?? 0),
        outboxRedacted: outbox.rows.length,
        proposalsRedacted: Number(proposals.rows[0]?.count ?? 0),
      };
    });
  }
}
