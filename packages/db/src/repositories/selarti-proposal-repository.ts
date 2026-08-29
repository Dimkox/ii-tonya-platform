import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";

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
      const request = (
        await tx.execute<RequestBinding>(sql`
          select
            o.payload->>'requestId' "requestId",
            o.payload->>'dialogueId' "dialogueId",
            o.payload->>'deadline' deadline,
            o.payload_hash "requestPayloadHash",
            d.tenant_key "tenantKey",
            d.bot_key "botKey",
            d.external_chat_id "chatId"
          from integration_outbox o
          join dialogues d on d.id::text=o.payload->>'dialogueId'
          where o.idempotency_key=${input.requestId}
            and o.topic='selarti.request.v1'
          for share of o,d
        `)
      ).rows[0];
      if (
        !request ||
        request.requestId !== input.requestId ||
        request.dialogueId !== input.dialogueId ||
        request.tenantKey !== input.tenantKey
      ) {
        return "rejected";
      }
      const deadline = new Date(request.deadline);
      if (!Number.isFinite(deadline.getTime()) || receivedAt > deadline)
        return "late";
      const proposal = (
        await tx.execute<{ id: string }>(sql`
          insert into selarti_response_proposals(
            request_id,dialogue_id,tenant_key,request_payload_hash,
            response_payload_hash,text,accepted_at,expires_at
          ) values(
            ${input.requestId},${input.dialogueId}::uuid,${input.tenantKey},
            ${request.requestPayloadHash},${input.responsePayloadHash},${input.text},
            ${receivedAt}::timestamptz,${receivedAt}::timestamptz+interval '30 days'
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
      return "accepted";
    });
  }
}
