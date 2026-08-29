import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";

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
  correlationId: string;
  locale: string;
  deadline: string;
  occurredAt: string;
  messagingConsentPolicyVersion: string;
  selartiConsentPolicyVersion?: string;
};
export type HybridPersistResult =
  "claimed" | "duplicate" | "conflict" | "rejected";
export class PostgresHybridMessageRepository {
  constructor(
    private readonly db: DrizzleDb,
    private readonly testHooks: {
      afterConsentRead?: (userId: string) => Promise<void> | void;
    } = {},
  ) {}
  async persist(input: HybridPersistInput): Promise<HybridPersistResult> {
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
      const latest = async (type: string) =>
        (
          await tx.execute<{ decision: string; policyVersion: string }>(
            sql`select decision,policy_version as "policyVersion" from consents where user_id=${identity.userId}::uuid and consent_type=${type} order by created_at desc,id desc limit 1`,
          )
        ).rows[0];
      const messaging = await latest("client_messaging");
      if (
        messaging?.decision !== "granted" ||
        messaging.policyVersion !== input.messagingConsentPolicyVersion
      )
        return "rejected";
      if (input.route === "complex_dialogue") {
        const ai = await latest("selarti_ai_processing");
        if (
          !input.selartiConsentPolicyVersion ||
          ai?.decision !== "granted" ||
          ai.policyVersion !== input.selartiConsentPolicyVersion
        )
          return "rejected";
      }
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
        await tx.execute(
          sql`insert into integration_outbox(idempotency_key,topic,payload,correlation_id,reconciliation_key,payload_hash) values(${requestId},'selarti.request.v1',${JSON.stringify(request)}::jsonb,${request.correlationId},${requestId},${input.payloadHash})`,
        );
      }
      return "claimed";
    });
  }
}
