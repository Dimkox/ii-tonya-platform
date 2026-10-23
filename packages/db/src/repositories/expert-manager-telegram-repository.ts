import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import { lockExpertManagerAuthority } from "./expert-manager-authority.js";
/** All identities and clocks are revalidated under original admin authority. */
export class PostgresExpertManagerTelegramRepository {
  constructor(private readonly db: DrizzleDb) {}
  async createPairing(input: {
    sessionHash: string;
    botId: string;
    tokenHash: string;
  }) {
    await this.db.transaction(async (tx) => {
      await lockExpertManagerAuthority(tx, input.sessionHash);
      await tx.execute(
        sql`insert into expert_manager_telegram_pairings(token_hash,session_hash,bot_id,expires_at) values(${input.tokenHash},${input.sessionHash},${input.botId},clock_timestamp()+interval '5 minutes')`,
      );
    });
  }
  async pair(input: {
    botId: string;
    tokenHash: string;
    telegramUserId: string;
    chatId: string;
  }) {
    return this.db.transaction(async (tx) => {
      const p = (
        await tx.execute<{ id: string; sessionHash: string }>(
          sql`select id,session_hash as "sessionHash" from expert_manager_telegram_pairings where token_hash=${input.tokenHash} and bot_id=${input.botId} for update`,
        )
      ).rows[0];
      if (!p) return false;
      await lockExpertManagerAuthority(tx, p.sessionHash);
      const row = (
        await tx.execute(
          sql`update expert_manager_telegram_pairings set telegram_user_id=${input.telegramUserId},telegram_chat_id=${input.chatId},paired_at=clock_timestamp() where id=${p.id}::uuid and paired_at is null and revoked_at is null and expires_at>clock_timestamp() returning id`,
        )
      ).rows[0];
      return !!row;
    });
  }
  async resolveCallback(input: {
    botId: string;
    nonceHash: string;
    telegramUserId: string;
    chatId: string;
  }) {
    return this.db.transaction(async (tx) => {
      const row = (
        await tx.execute<{
          sessionHash: string;
          applicationId: string;
          decision: "approved" | "rejected";
          profileRevision: number | null;
          profileUserId: string;
          id: string;
        }>(
          sql`select p.session_hash as "sessionHash",c.application_id as "applicationId",c.decision,c.id,c.profile_revision as "profileRevision",a.user_id as "profileUserId" from expert_manager_telegram_callbacks c join expert_manager_telegram_pairings p on p.id=c.pairing_id join expert_onboarding_applications a on a.id=c.application_id where c.nonce_hash=${input.nonceHash} and p.bot_id=${input.botId} and p.telegram_user_id=${input.telegramUserId} and p.telegram_chat_id=${input.chatId} and p.paired_at is not null and p.revoked_at is null and c.expires_at>clock_timestamp() and c.profile_revision is not distinct from (select max(revision) from expert_offer_profiles where user_id=a.user_id) for share of p,c`,
        )
      ).rows[0];
      if (!row) return null;
      await lockExpertManagerAuthority(tx, row.sessionHash);
      const current = (
        await tx.execute<{ valid: boolean }>(
          sql`select expires_at>clock_timestamp() as valid from expert_manager_telegram_callbacks where id=${row.id}::uuid`,
        )
      ).rows[0];
      if (!current?.valid) return null;
      return {
        sessionHash: row.sessionHash,
        applicationId: row.applicationId,
        decision: row.decision,
        idempotencyKey: `manager-telegram:${row.id}`,
        ...(row.profileRevision
          ? {
              profileRevision: row.profileRevision,
              profileUserId: row.profileUserId,
            }
          : {}),
      };
    });
  }
  async claimNotification(botId: string) {
    return this.db.transaction(async (tx) => {
      const pairings = (
        await tx.execute<{ id: string; sessionHash: string; chatId: string }>(
          sql`select id,session_hash as "sessionHash",telegram_chat_id as "chatId" from expert_manager_telegram_pairings where bot_id=${botId} and paired_at is not null and revoked_at is null order by id limit 50`,
        )
      ).rows;
      for (const p of pairings) {
        try {
          await lockExpertManagerAuthority(tx, p.sessionHash);
        } catch {
          continue;
        }
        await tx.execute(
          sql`insert into expert_manager_telegram_notifications(pairing_id,application_id) select ${p.id}::uuid,a.id from expert_onboarding_applications a join users u on u.id=a.user_id and u.active=true where a.verification_status='pending' on conflict(pairing_id,application_id) do nothing`,
        );
        const n = (
          await tx.execute<{ id: string; applicationId: string }>(
            sql`select n.id,n.application_id as "applicationId" from expert_manager_telegram_notifications n join expert_onboarding_applications a on a.id=n.application_id and a.verification_status='pending' where n.pairing_id=${p.id}::uuid and n.status='pending' order by n.id limit 1 for update of n skip locked`,
          )
        ).rows[0];
        if (!n) continue;
        const profile = (
          await tx.execute<{
            revision: number;
            cityCode: string;
            millionCity: boolean;
            format: string;
            ticketMinor: string;
          }>(
            sql`select p.revision,p.city_code as "cityCode",p.million_city as "millionCity",p.service_format as format,p.ticket_minor::text as "ticketMinor" from expert_offer_profiles p join expert_onboarding_applications a on a.user_id=p.user_id where a.id=${n.applicationId}::uuid order by p.revision desc limit 1`,
          )
        ).rows[0];
        const text = profile
          ? `Новая заявка на проверку\nГород: ${profile.cityCode.replace(/[\p{C}]/gu, " ").slice(0, 100)}; миллионник: ${profile.millionCity ? "да" : "нет"}; формат: ${profile.format}; чек (коп.): ${profile.ticketMinor}; версия: ${profile.revision}. Одобрить = подтвердить эти факты.`
          : "Новая заявка на проверку";
        const approveNonceHash = randomBytes(32).toString("hex"),
          rejectNonceHash = randomBytes(32).toString("hex"),
          fence = randomUUID();
        for (const [decision, nonce] of [
          ["approved", approveNonceHash],
          ["rejected", rejectNonceHash],
        ] as const)
          await tx.execute(
            sql`insert into expert_manager_telegram_callbacks(pairing_id,application_id,decision,nonce_hash,expires_at,profile_revision) values(${p.id}::uuid,${n.applicationId}::uuid,${decision},${nonce},clock_timestamp()+interval '10 minutes',${profile?.revision ?? null})`,
          );
        await tx.execute(
          sql`update expert_manager_telegram_notifications set status='sending',fence=${fence}::uuid,lease_until=clock_timestamp()+interval '1 minute' where id=${n.id}::uuid`,
        );
        return {
          id: n.id,
          fence,
          chatId: p.chatId,
          approveNonceHash,
          rejectNonceHash,
          text,
        };
      }
      return null;
    });
  }
  async finishNotification(id: string, fence: string, messageId: string) {
    if (!/^[1-9]\d{0,19}$/u.test(messageId))
      throw new Error("manager_receipt_invalid");
    await this.db.execute(
      sql`update expert_manager_telegram_notifications set status='sent',sent_at=clock_timestamp() where id=${id}::uuid and fence=${fence}::uuid and status='sending'`,
    );
  }
}
