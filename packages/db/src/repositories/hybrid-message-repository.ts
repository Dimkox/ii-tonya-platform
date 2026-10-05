import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import { reserveSelartiCost } from "./selarti-budget-repository.js";
import { hasCurrentTestExpertConsent } from "./test-expert-consent-authority.js";
import { PostgresClientIngressReplayRepository } from "./client-ingress-replay-repository.js";

export type HybridPersistInput = {
  updateId: bigint;
  payloadHash: string;
  provider: "telegram";
  botKey: string;
  externalUserId: string;
  externalChatId: string;
  text: string;
  route: "deterministic" | "complex_dialogue";
  routingEnabled: boolean;
  costAdmissionEnabled?: boolean;
  correlationId: string;
  locale: string;
  deadline: string;
  occurredAt: string;
  messagingConsentPolicyVersion: string;
  selartiConsentPolicyVersion?: string;
  localReplyText?: string;
};
export type HybridPersistResult =
  | "claimed"
  | "warning"
  | "duplicate"
  | "conflict"
  | "rejected"
  | "soft_stop"
  | "hard_stop";
export class PostgresHybridMessageRepository {
  constructor(
    private readonly db: DrizzleDb,
    private readonly testHooks: {
      afterConsentRead?: (userId: string) => Promise<void> | void;
    } = {},
    private readonly botId?: string,
  ) {}
  async persist(input: HybridPersistInput): Promise<HybridPersistResult> {
    if (this.botId !== undefined) {
      if (
        input.updateId < 0n ||
        input.updateId > BigInt(Number.MAX_SAFE_INTEGER)
      )
        return "rejected";
      if (
        await new PostgresClientIngressReplayRepository(this.db).hasReceipt({
          botId: this.botId,
          updateId: Number(input.updateId),
        })
      )
        return "duplicate";
    }
    if (!/^[0-9a-f]{64}$/u.test(input.payloadHash))
      throw new Error("hybrid_payload_hash_invalid");
    return this.db.transaction(async (tx) => {
      const identity = (
        await tx.execute<{ userId: string }>(
          sql`select ci.user_id as "userId" from channel_identities ci join users u on u.id=ci.user_id and u.active=true where ci.provider=${input.provider} and ci.bot_key=${input.botKey} and ci.external_id=${input.externalUserId} and ci.external_chat_id=${input.externalChatId} and ci.status='active' limit 1 for share`,
        )
      ).rows[0];
      if (!identity) return "rejected";
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${identity.userId}, 0))`,
      );
      if (
        !(await hasCurrentTestExpertConsent(tx, {
          userId: identity.userId,
          messagingPolicyVersion: input.messagingConsentPolicyVersion,
          ...(input.route === "complex_dialogue" &&
          input.selartiConsentPolicyVersion !== undefined
            ? { selartiPolicyVersion: input.selartiConsentPolicyVersion }
            : {}),
        })) ||
        (input.route === "complex_dialogue" &&
          input.selartiConsentPolicyVersion === undefined)
      )
        return "rejected";
      await this.testHooks.afterConsentRead?.(identity.userId);
      let dialogue = (
        await tx.execute<{ id: string; userId: string }>(
          sql`select id,user_id as "userId" from dialogues where tenant_key=${input.botKey} and provider=${input.provider} and bot_key=${input.botKey} and external_chat_id=${input.externalChatId} limit 1 for update`,
        )
      ).rows[0];
      if (dialogue && dialogue.userId !== identity.userId) return "rejected";
      if (!dialogue) {
        dialogue = (
          await tx.execute<{ id: string; userId: string }>(
            sql`insert into dialogues(tenant_key,user_id,provider,bot_key,external_chat_id) values(${input.botKey},${identity.userId}::uuid,${input.provider},${input.botKey},${input.externalChatId}) on conflict(tenant_key,provider,bot_key,external_chat_id) do nothing returning id,user_id as "userId"`,
          )
        ).rows[0];
        if (!dialogue) {
          dialogue = (
            await tx.execute<{ id: string; userId: string }>(
              sql`select id,user_id as "userId" from dialogues where tenant_key=${input.botKey} and provider=${input.provider} and bot_key=${input.botKey} and external_chat_id=${input.externalChatId} for update`,
            )
          ).rows[0];
          if (!dialogue || dialogue.userId !== identity.userId)
            return "rejected";
        }
      }
      const tombstone = (
        await tx.execute<{ payloadHash: string }>(sql`
          select payload_hash "payloadHash"
          from dialogue_inbound_tombstones
          where provider=${input.provider} and bot_key=${input.botKey}
            and provider_update_id=${input.updateId}
        `)
      ).rows[0];
      if (tombstone) {
        return tombstone.payloadHash === input.payloadHash
          ? "duplicate"
          : "conflict";
      }
      const inbound = (
        await tx.execute<{ id: string }>(
          sql`insert into dialogue_inbound(dialogue_id,provider,bot_key,provider_update_id,payload_hash,text,created_at,expires_at) values(${dialogue.id}::uuid,${input.provider},${input.botKey},${input.updateId},${input.payloadHash},${input.text},${input.occurredAt}::timestamptz,${input.occurredAt}::timestamptz+interval '30 days') on conflict(provider,bot_key,provider_update_id) do nothing returning id`,
        )
      ).rows[0];
      if (!inbound) {
        const prior = (
          await tx.execute<{ payloadHash: string }>(
            sql`select payload_hash as "payloadHash" from dialogue_inbound where provider=${input.provider} and bot_key=${input.botKey} and provider_update_id=${input.updateId}`,
          )
        ).rows[0];
        return prior?.payloadHash === input.payloadHash
          ? "duplicate"
          : "conflict";
      }
      await tx.execute(
        sql`insert into dialogue_route_decisions(inbound_id,route_version,route) values(${inbound.id}::uuid,1,${input.route})`,
      );
      const enqueueLocalReply = async (reply: string) => {
        if (
          reply.length < 1 ||
          reply.length > 512 ||
          /[\u0000-\u001F\u007F-\u009F]/u.test(reply)
        ) {
          throw new Error("hybrid_local_reply_invalid");
        }
        const sequenceRow = (
          await tx.execute<{ sequence: bigint }>(sql`
            update dialogues
            set next_delivery_sequence=next_delivery_sequence+1
            where id=${dialogue.id}::uuid
            returning next_delivery_sequence as sequence
          `)
        ).rows[0];
        if (!sequenceRow) throw new Error("hybrid_dialogue_sequence_missing");
        const sequence = Number(sequenceRow.sequence);
        if (!Number.isSafeInteger(sequence) || sequence < 1)
          throw new Error("hybrid_dialogue_sequence_invalid");
        const deliveryId = randomUUID();
        const outboxId = randomUUID();
        const payload = {
          deliveryId,
          dialogueId: dialogue.id,
          sequence,
          botKey: input.botKey,
          chatId: input.externalChatId,
          text: reply,
        };
        const payloadHash = createHash("sha256")
          .update(JSON.stringify(payload))
          .digest("hex");
        const deliveryKey = `sha256:${createHash("sha256")
          .update(`telegram-delivery\0${dialogue.id}\0${sequence}`)
          .digest("hex")}`;
        await tx.execute(sql`
          insert into integration_outbox(
            id,idempotency_key,topic,payload,correlation_id,reconciliation_key,
            payload_hash,dialogue_id,dialogue_sequence
          ) values(
            ${outboxId}::uuid,${deliveryKey},'telegram.send_text.v1',
            ${JSON.stringify(payload)}::jsonb,${input.correlationId},${deliveryKey},
            ${payloadHash},${dialogue.id}::uuid,${sequenceRow.sequence}
          )
        `);
        await tx.execute(sql`
          insert into dialogue_deliveries(
            id,dialogue_id,dialogue_sequence,source,source_id,outbox_id,payload_hash
          ) values(
            ${deliveryId}::uuid,${dialogue.id}::uuid,${sequenceRow.sequence},
            'deterministic',${inbound.id},${outboxId}::uuid,${payloadHash}
          )
        `);
      };
      if (input.route === "deterministic") {
        await enqueueLocalReply(
          input.localReplyText ??
            "Я помогу с навигацией по сервису. Опишите ваш запрос одним сообщением.",
        );
      }
      if (input.route === "complex_dialogue" && input.routingEnabled) {
        const requestId = `sha256:${createHash("sha256").update(`${input.provider}\0${input.botKey}\0${input.updateId}`).digest("hex")}`;
        const request = {
          requestId,
          dialogueId: dialogue.id,
          userId: identity.userId,
          correlationId: input.correlationId,
          text: input.text,
          locale: input.locale,
          promptVersion: "hybrid-b1",
          deadline: input.deadline,
        };
        const existing = (
          await tx.execute<{
            topic: string;
            correlationId: string;
            payloadHash: string;
          }>(
            sql`select topic,correlation_id as "correlationId",payload_hash as "payloadHash" from integration_outbox where idempotency_key=${requestId}`,
          )
        ).rows[0];
        if (
          existing &&
          (existing.topic !== "selarti.request.v1" ||
            existing.correlationId !== request.correlationId ||
            existing.payloadHash !== input.payloadHash)
        )
          throw new Error("hybrid_outbox_idempotency_conflict");
        if (existing) return "duplicate";
        const admission =
          input.costAdmissionEnabled === true
            ? await reserveSelartiCost(tx, {
                requestId,
                payloadHash: input.payloadHash,
                userId: identity.userId,
                dialogueId: dialogue.id,
                occurredAt: input.occurredAt,
              })
            : { outcome: "hard_stop" as const, reservedRubMinor: 0n };
        if (
          admission.outcome === "soft_stop" ||
          admission.outcome === "hard_stop"
        ) {
          await enqueueLocalReply(
            "Сейчас я не могу безопасно подключить расширенный подбор. Запрос передан оператору.",
          );
          return admission.outcome;
        }
        await tx.execute(
          sql`insert into integration_outbox(idempotency_key,topic,payload,correlation_id,reconciliation_key,payload_hash) values(${requestId},'selarti.request.v1',${JSON.stringify(request)}::jsonb,${request.correlationId},${requestId},${input.payloadHash})`,
        );
        if (admission.outcome === "warning") return "warning";
      }
      return "claimed";
    });
  }
}
