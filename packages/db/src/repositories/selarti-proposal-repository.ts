import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { clientDispatchPayloadDigest } from "@ii-tonya/contracts";
import type { DrizzleDb } from "../client.js";
import {
  lockClientConsentSubject,
  validateClientConsentAuthority,
} from "./client-consent-authority.js";

export type AcceptSelartiProposalCommand = {
  readonly requestId: string;
  readonly dialogueId: string;
  readonly threadId: string;
  readonly tenantKey: string;
  readonly text: string;
  readonly responsePayloadHash: string;
  readonly receivedAt: string;
};
export type AcceptSelartiProposalResult =
  "accepted" | "duplicate" | "conflict" | "rejected" | "late";

type RequestBinding = {
  id: string;
  userId: string;
  payload: Record<string, unknown>;
  reason: string | null;
  requestId: string;
  dialogueId: string;
  deadline: string;
  requestPayloadHash: string;
  tenantKey: string;
  botKey: string;
  chatId: string;
};

export class PostgresSelartiProposalRepository {
  constructor(private readonly db: DrizzleDb) {}

  async accept(
    input: AcceptSelartiProposalCommand,
  ): Promise<AcceptSelartiProposalResult> {
    if (
      !/^sha256:[0-9a-f]{64}$/u.test(input.requestId) ||
      input.threadId !== input.requestId ||
      !/^[0-9a-f]{64}$/u.test(input.responsePayloadHash) ||
      input.text.length < 1 ||
      input.text.length > 4_096 ||
      /[\u0000-\u001F\u007F-\u009F]/u.test(input.text)
    ) {
      return "rejected";
    }
    const receivedAt = new Date(input.receivedAt);
    if (!Number.isFinite(receivedAt.getTime())) return "rejected";
    return this.db.transaction(async (tx) => {
      const candidate = (
        await tx.execute<{ userId: string }>(sql`
        select d.user_id::text as "userId" from integration_outbox o
        left join selarti_response_proposals prior on prior.request_id=o.idempotency_key
        join dialogues d on d.id::text=coalesce(o.payload->>'dialogueId',prior.dialogue_id::text)
        where o.idempotency_key=${input.requestId} and o.topic='selarti.request.v1'
      `)
      ).rows[0];
      if (!candidate) return "rejected";
      await lockClientConsentSubject(tx, candidate.userId);
      // Shared with the immutable usage writer, before any request/proposal row locks.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${input.requestId},0))`,
      );
      const request = (
        await tx.execute<RequestBinding>(sql`
          select o.id::text as id, d.user_id::text as "userId",o.payload,
            o.last_normalized_reason as reason,
            o.payload->>'requestId' "requestId",o.payload->>'dialogueId' "dialogueId",
            o.payload->>'deadline' deadline,o.payload_hash "requestPayloadHash",
            d.tenant_key "tenantKey",d.bot_key "botKey",d.external_chat_id "chatId"
          from integration_outbox o
          left join selarti_response_proposals prior on prior.request_id=o.idempotency_key
          join dialogues d on d.id::text=coalesce(o.payload->>'dialogueId',prior.dialogue_id::text)
          where o.idempotency_key=${input.requestId} and o.reconciliation_key=${input.requestId}
            and o.topic='selarti.request.v1' for share of o,d
        `)
      ).rows[0];
      if (
        !request ||
        request.userId !== candidate.userId ||
        request.tenantKey !== input.tenantKey
      )
        return "rejected";
      const existing = (
        await tx.execute<{
          responsePayloadHash: string;
          dialogueId: string;
          tenantKey: string;
        }>(sql`
          select response_payload_hash "responsePayloadHash",
            dialogue_id::text "dialogueId",tenant_key "tenantKey"
          from selarti_response_proposals
          where request_id=${input.requestId}
          for update
        `)
      ).rows[0];
      if (existing) {
        if (
          existing.dialogueId !== input.dialogueId ||
          existing.tenantKey !== input.tenantKey
        )
          return "rejected";
        return existing.responsePayloadHash === input.responsePayloadHash
          ? "duplicate"
          : "conflict";
      }
      if (
        request.requestId !== input.requestId ||
        request.dialogueId !== input.dialogueId ||
        request.payload.userId !== candidate.userId
      )
        return "rejected";
      const consentAuthority = await validateClientConsentAuthority(
        tx,
        request.payload.consentAuthority,
        request.dialogueId,
        true,
      );
      if (
        !consentAuthority ||
        consentAuthority.subjectId !== candidate.userId ||
        typeof request.payload.text !== "string"
      )
        return "rejected";
      const facts = (
        await tx.execute<{ started: boolean; notApplied: boolean }>(sql`
        select exists(select 1 from delivery_attempts where outbox_id=${request.id}::uuid
          and reconciliation_key=${input.requestId} and outcome='started'
          and normalized_reason=${clientDispatchPayloadDigest(request.payload)}) as started,
        (exists(select 1 from test_expert_outcomes where provider_request_id=${input.requestId} and outcome='not_applied')
          or exists(select 1 from selarti_actual_usage_facts where request_id=${input.requestId} and outcome='not_applied')) as "notApplied"
      `)
      ).rows[0]!;
      if (!facts.started) return "rejected";
      if (facts.notApplied || request.reason === "provider_not_applied")
        return "late";
      const trialReservation = (
        await tx.execute<{
          id: string;
          redemptionId: string;
          status: "reserved" | "unknown" | "applied" | "not_applied";
        }>(sql`
          select id,redemption_id::text "redemptionId",status
          from test_expert_reservations
          where provider_request_id=${input.requestId}
          for update
        `)
      ).rows[0];
      if (trialReservation?.status === "not_applied") return "late";
      const now = (
        await tx.execute<{ now: Date | string }>(
          sql`select clock_timestamp() as now`,
        )
      ).rows[0]!;
      const acceptedAt = new Date(now.now);
      const deadline = new Date(request.deadline);
      if (!Number.isFinite(deadline.getTime()) || acceptedAt >= deadline)
        return "late";
      const proposal = (
        await tx.execute<{ id: string }>(sql`
          insert into selarti_response_proposals(
            request_id,dialogue_id,tenant_key,request_payload_hash,
            response_payload_hash,text,accepted_at,expires_at
          ) values(
            ${input.requestId},${input.dialogueId}::uuid,${input.tenantKey},
            ${request.requestPayloadHash},${input.responsePayloadHash},${input.text},
            ${acceptedAt}::timestamptz,${acceptedAt}::timestamptz+interval '30 days'
          )
          on conflict(request_id) do nothing
          returning id
        `)
      ).rows[0];
      if (!proposal) {
        const raced = (
          await tx.execute<{ responsePayloadHash: string }>(sql`
            select response_payload_hash "responsePayloadHash"
            from selarti_response_proposals
            where request_id=${input.requestId}
            for update
          `)
        ).rows[0];
        return raced?.responsePayloadHash === input.responsePayloadHash
          ? "duplicate"
          : "conflict";
      }
      const sequenceRow = (
        await tx.execute<{ sequence: bigint }>(sql`
          update dialogues
          set next_delivery_sequence=next_delivery_sequence+1
          where id=${input.dialogueId}::uuid and tenant_key=${input.tenantKey}
          returning next_delivery_sequence sequence
        `)
      ).rows[0];
      if (!sequenceRow) throw new Error("selarti_dialogue_sequence_missing");
      const sequence = Number(sequenceRow.sequence);
      if (!Number.isSafeInteger(sequence) || sequence < 1)
        throw new Error("selarti_dialogue_sequence_invalid");
      const deliveryId = randomUUID();
      const outboxId = randomUUID();
      const payload = {
        deliveryId,
        dialogueId: input.dialogueId,
        sequence,
        botKey: request.botKey,
        chatId: request.chatId,
        text: input.text,
        consentAuthority,
      };
      const payloadHash = createHash("sha256")
        .update(JSON.stringify(payload))
        .digest("hex");
      const deliveryKey = `sha256:${createHash("sha256")
        .update(`telegram-delivery\0${input.dialogueId}\0${sequence}`)
        .digest("hex")}`;
      await tx.execute(sql`
        insert into integration_outbox(
          id,idempotency_key,topic,payload,correlation_id,reconciliation_key,
          payload_hash,dialogue_id,dialogue_sequence
        ) values(
          ${outboxId}::uuid,${deliveryKey},'telegram.send_text.v1',
          ${JSON.stringify(payload)}::jsonb,${input.requestId},${deliveryKey},
          ${payloadHash},${input.dialogueId}::uuid,${sequenceRow.sequence}
        )
      `);
      await tx.execute(sql`
        insert into dialogue_deliveries(
          id,dialogue_id,dialogue_sequence,source,source_id,outbox_id,payload_hash
        ) values(
          ${deliveryId}::uuid,${input.dialogueId}::uuid,${sequenceRow.sequence},
          'selarti',${proposal.id},${outboxId}::uuid,${payloadHash}
        )
      `);
      if (
        trialReservation &&
        (trialReservation.status === "reserved" ||
          trialReservation.status === "unknown")
      ) {
        await tx.execute(sql`
          update test_expert_reservations set status='applied'
          where id=${trialReservation.id}::uuid
        `);
        await tx.execute(sql`
          update test_expert_redemptions
          set reserved_units=reserved_units-2,consumed_units=consumed_units+2
          where id=${trialReservation.redemptionId}::uuid
        `);
        await tx.execute(sql`
          insert into test_expert_outcomes(reservation_id,outcome,provider_request_id)
          values(${trialReservation.id}::uuid,'applied',${input.requestId})
          on conflict do nothing
        `);
        await tx.execute(sql`
          insert into test_expert_audit_events(redemption_id,reservation_id,event_type,event_digest)
          values(${trialReservation.redemptionId}::uuid,${trialReservation.id}::uuid,'outcome_applied',${input.responsePayloadHash})
        `);
      }
      return "accepted";
    });
  }
}
