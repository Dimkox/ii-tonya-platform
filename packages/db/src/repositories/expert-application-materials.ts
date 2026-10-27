import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import {
  captureClientConsentAuthority,
  lockClientConsentSubject,
} from "./client-consent-authority.js";
import type {
  ExpertCardMaterialTransport,
  ExpertCardTransaction,
} from "./expert-card-repository.js";
import { createHash, randomUUID } from "node:crypto";
const digest = (value: string) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
export const AWAITING_MATERIALS_MESSAGE =
  "Ваши материалы для рассылки будут доступны в ближайшее время";
/** Enqueue from a verified fee transaction. Only the verified promo enrollment supplies transport identity. */
export async function enqueueApplicationMaterials(
  tx: ExpertCardTransaction,
  applicationId: string,
  userId: string,
) {
  await tx.execute(sql`insert into expert_application_material_jobs(application_id,user_id,status,target_bot_id,target_bot_key,target_chat_id)
 select ${applicationId}::uuid,${userId}::uuid,'waiting_content',case when ci.id is not null then p.bot_id end,ci.bot_key,ci.external_chat_id
 from (select 1) seed left join expert_promo_enrollments p on p.user_id=${userId}::uuid and p.status='granted'
 left join channel_identities ci on ci.id=p.channel_identity_id and ci.user_id=${userId}::uuid and ci.provider='telegram' and ci.status='active' and ci.external_id=ci.external_chat_id
 on conflict(application_id) do nothing`);
}
export async function applicationProofDigest(
  tx: ExpertCardTransaction,
  applicationId: string,
) {
  return (
    await tx.execute<{ digest: string }>(
      sql`select 'sha256:'||encode(digest(coalesce(string_agg(id::text||':'||kind||':'||reference,E'\n' order by created_at,id),''),'sha256'),'hex') as digest from expert_application_promo_proofs where application_id=${applicationId}::uuid`,
    )
  ).rows[0]!.digest;
}
/** Generic materials contain no private card, interview answers or invented placeholders. */
export class PostgresExpertApplicationMaterials {
  constructor(
    private readonly db: DrizzleDb,
    private readonly policy: string,
    private readonly transport?: ExpertCardMaterialTransport,
  ) {}
  async listDue(limit: number) {
    return (
      await this.db.execute<{ jobId: string; createdAt: string | Date }>(
        sql`select j.id as "jobId",j.created_at as "createdAt" from expert_application_material_jobs j
 join users u on u.id=j.user_id and u.active
 join expert_onboarding_applications a on a.id=j.application_id and a.user_id=j.user_id and a.verification_status='approved' and a.archived_at is null and a.archive_until_date is null
 where exists(select 1 from expert_card_drafts d where d.application_id=a.id and d.status='approved' and not d.rich_mode) and j.status in ('waiting_content','pending') and j.attempt_id is null
 and j.target_bot_id is not null and j.target_bot_key is not null and j.target_chat_id is not null
 and (select count(*) from channel_identities ci where ci.user_id=j.user_id and ci.provider='telegram' and ci.bot_key=j.target_bot_key and ci.external_id=j.target_chat_id and ci.external_chat_id=j.target_chat_id and ci.status='active')=1
 and expert_card_current_messaging_authority(j.user_id,${this.policy})
 and exists(select 1 from expert_onboarding_invoices i join expert_onboarding_payment_facts f on f.invoice_id=i.id and f.admission='interview' where i.application_id=a.id and i.user_id=j.user_id and i.status='settled')
 and exists(select 1 from expert_card_material_templates where status='approved' and position('{{' in text_body)=0 and position('}}' in text_body)=0)
 order by j.created_at,j.id limit ${limit}`,
      )
    ).rows;
  }
  private async job(tx: ExpertCardTransaction, id: string) {
    const initial = (
      await tx.execute<{ userId: string }>(
        sql`select user_id as "userId" from expert_application_material_jobs where id=${id}::uuid`,
      )
    ).rows[0];
    if (!initial) return null;
    await lockClientConsentSubject(tx, initial.userId);
    const job = (
      await tx.execute<{
        id: string;
        userId: string;
        applicationId: string;
        status: string;
        attemptId: string | null;
        botId: string | null;
        botKey: string | null;
        chatId: string | null;
        contentVersion: string | null;
        payloadDigest: string | null;
      }>(
        sql`select j.id,j.user_id as "userId",j.application_id as "applicationId",j.status,j.attempt_id as "attemptId",j.target_bot_id as "botId",j.target_bot_key as "botKey",j.target_chat_id as "chatId",j.content_version as "contentVersion",j.payload_digest as "payloadDigest" from expert_application_material_jobs j join users u on u.id=j.user_id and u.active join expert_onboarding_applications a on a.id=j.application_id and a.user_id=j.user_id and a.archived_at is null and a.archive_until_date is null and a.verification_status='approved' where j.id=${id}::uuid and (j.attempt_id is not null or exists(select 1 from expert_card_drafts d where d.application_id=a.id and d.status='approved' and not d.rich_mode)) and exists(select 1 from expert_onboarding_invoices i join expert_onboarding_payment_facts f on f.invoice_id=i.id and f.admission='interview' where i.application_id=a.id and i.user_id=j.user_id and i.status='settled') for update of j for share of u,a`,
      )
    ).rows[0];
    if (!job?.botId || !job.botKey || !job.chatId) return null;
    return (await captureClientConsentAuthority(tx, {
      subjectId: job.userId,
      botKey: job.botKey,
      chatId: job.chatId,
      externalUserId: job.chatId,
      messagingPolicyVersion: this.policy,
    }))
      ? job
      : null;
  }
  async deliver(
    id: string,
    signal?: AbortSignal,
  ): Promise<{
    kind:
      | "delivered"
      | "already_delivered"
      | "waiting_content"
      | "unknown_outcome"
      | "cancelled"
      | "unavailable";
  }> {
    if (!this.transport) return { kind: "unavailable" };
    const prepared = await this.db.transaction(async (tx) => {
      const j = await this.job(tx, id);
      if (!j || signal?.aborted) return { kind: "cancelled" as const };
      if (j.status === "delivered")
        return { kind: "already_delivered" as const };
      if (j.attemptId || j.status === "unknown_outcome")
        return { kind: "unknown_outcome" as const };
      if (j.status === "cancelled") return { kind: "cancelled" as const };
      const t = (
        await tx.execute<{
          id: string;
          version: string;
          text: string;
          assets: { kind: "photo" | "document"; reference: string }[];
        }>(
          sql`select id,content_version as version,text_body as text,assets from expert_card_material_templates where status='approved' and position('{{' in text_body)=0 and position('}}' in text_body)=0 order by created_at desc,id desc limit 1 for share`,
        )
      ).rows[0];
      if (!t) return { kind: "waiting_content" as const };
      const payload = { text: t.text, assets: t.assets };
      const payloadDigest = digest(
        JSON.stringify({
          purpose: "application_generic",
          applicationId: j.applicationId,
          payload,
        }),
      );
      const attemptId = randomUUID();
      await tx.execute(
        sql`update expert_application_material_jobs set template_id=${t.id}::uuid,content_version=${t.version},payload_digest=${payloadDigest},expected_message_count=${1 + t.assets.length},attempt_id=${attemptId}::uuid,attempt_started_at=clock_timestamp(),status='unknown_outcome' where id=${id}::uuid`,
      );
      return {
        kind: "prepared" as const,
        payload,
        payloadDigest,
        attemptId,
        version: t.version,
        templateId: t.id,
      };
    });
    if (prepared.kind !== "prepared") return prepared;
    return this.db.transaction(async (tx) => {
      const j = await this.job(tx, id);
      if (!j || signal?.aborted) return { kind: "unknown_outcome" as const };
      if (
        j.attemptId !== prepared.attemptId ||
        j.contentVersion !== prepared.version ||
        j.payloadDigest !== prepared.payloadDigest
      )
        return { kind: "unknown_outcome" as const };
      const valid = (
        await tx.execute<{ valid: boolean }>(
          sql`select exists(select 1 from expert_card_material_templates where id=${prepared.templateId}::uuid and content_version=${prepared.version} and status='approved') as valid`,
        )
      ).rows[0]?.valid;
      if (!valid) return { kind: "unknown_outcome" as const };
      const sendSignal = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
        : AbortSignal.timeout(8000);
      try {
        const receipt = await this.transport!.send({
          botId: j.botId!,
          botKey: j.botKey!,
          userId: j.userId,
          chatId: j.chatId!,
          reviewId: j.applicationId,
          revision: 0,
          materialPurpose: "application_generic",
          applicationId: j.applicationId,
          contentVersion: prepared.version,
          payloadDigest: prepared.payloadDigest,
          payload: prepared.payload,
          signal: sendSignal,
        });
        if (
          sendSignal.aborted ||
          receipt.botId !== j.botId ||
          receipt.chatId !== j.chatId ||
          receipt.contentVersion !== prepared.version ||
          receipt.payloadDigest !== prepared.payloadDigest ||
          !Array.isArray(receipt.messageIds) ||
          receipt.messageIds.length !== 1 + prepared.payload.assets.length ||
          new Set(receipt.messageIds).size !== receipt.messageIds.length ||
          receipt.messageIds.some(
            (x) => typeof x !== "string" || !/^[1-9]\d{0,19}$/u.test(x),
          )
        )
          return { kind: "unknown_outcome" as const };
        const boundReceipt = {
          messageIds: [...receipt.messageIds],
          botId: receipt.botId,
          chatId: receipt.chatId,
          contentVersion: receipt.contentVersion,
          payloadDigest: receipt.payloadDigest,
        };
        await tx.execute(
          sql`update expert_application_material_jobs set status='delivered',delivery_receipt=${JSON.stringify(boundReceipt)}::jsonb,delivered_at=clock_timestamp() where id=${id}::uuid and attempt_id=${prepared.attemptId}::uuid`,
        );
        return { kind: "delivered" as const };
      } catch {
        return { kind: "unknown_outcome" as const };
      }
    });
  }
}
