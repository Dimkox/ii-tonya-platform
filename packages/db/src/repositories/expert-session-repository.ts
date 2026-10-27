import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
export interface ExpertSessionIssueInput {
  userId: string;
  expertId: string;
  channelIdentityId: string;
  externalId: string;
  botKey: string | null;
  externalChatId: string | null;
  tokenDigest: string;
  replayDigest: string;
  proofExpiresAt: Date;
}
const uuid = (s: string) =>
  typeof s === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.exec(
    s,
  )?.[0] === s;
const digest = (s: string) =>
  typeof s === "string" && /^sha256:[0-9a-f]{64}$/u.exec(s)?.[0] === s;
type Owner = {
  userId: string;
  expertId: string;
  channelIdentityId: string;
  externalId: string;
  botKey: string | null;
  externalChatId: string | null;
};
type Tx = Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0];
export class PostgresExpertSessionRepository {
  constructor(
    private readonly db: DrizzleDb,
    private readonly botKey: string,
  ) {
    if (/^[A-Za-z0-9_-]{1,64}$/u.exec(botKey)?.[0] !== botKey)
      throw new Error("expert_session_configuration_required");
  }
  private eligible() {
    return sql`c.provider='telegram' and c.status='active' and u.active and e.active and e.verified
  and e.user_id=c.user_id and c.external_id ~ '^[1-9][0-9]{0,15}$'
  and ((c.bot_key=${this.botKey} and c.external_chat_id=c.external_id)
    or (c.bot_key is null and (c.external_chat_id is null or c.external_chat_id=c.external_id)
       and not exists(select 1 from channel_identities x where x.provider=c.provider and x.external_id=c.external_id and x.id<>c.id)))
  and not exists(select 1 from channel_identities x where x.provider=c.provider and x.external_id=c.external_id
    and x.id<>c.id and (x.user_id<>c.user_id or x.status<>'active' or x.bot_key is null or x.bot_key=${this.botKey}))`;
  }
  private async bounds(tx: Tx) {
    await tx.execute(sql`set local statement_timeout='2000ms'`);
    await tx.execute(sql`set local lock_timeout='1000ms'`);
  }
  async resolveTelegramIdentity(externalId: string): Promise<Owner | null> {
    if (
      /^[1-9][0-9]{0,15}$/u.exec(externalId)?.[0] !== externalId ||
      !Number.isSafeInteger(Number(externalId))
    )
      return null;
    const r = await this.db
      .execute<Owner>(sql`select u.id "userId",e.id "expertId",c.id "channelIdentityId",c.external_id "externalId",c.bot_key "botKey",c.external_chat_id "externalChatId"
   from channel_identities c join users u on u.id=c.user_id join experts e on e.user_id=u.id
   where c.external_id=${externalId} and ${this.eligible()}`);
    return r.rows.length === 1 ? r.rows[0]! : null;
  }
  async issue(
    input: ExpertSessionIssueInput,
  ): Promise<{ kind: "issued"; expiresAt: Date } | { kind: "denied" }> {
    if (
      !uuid(input.userId) ||
      !uuid(input.expertId) ||
      !uuid(input.channelIdentityId) ||
      !digest(input.tokenDigest) ||
      typeof input.externalId !== "string" ||
      /^[1-9][0-9]{0,15}$/u.exec(input.externalId)?.[0] !== input.externalId ||
      !(input.botKey === null || input.botKey === this.botKey) ||
      !(
        input.externalChatId === input.externalId ||
        (input.botKey === null && input.externalChatId === null)
      ) ||
      !/^expert-login:v1:[0-9a-f]{64}$/u.test(input.replayDigest) ||
      input.replayDigest.length !== 80 ||
      !(input.proofExpiresAt instanceof Date) ||
      !Number.isFinite(input.proofExpiresAt.getTime())
    )
      return { kind: "denied" };
    try {
      return await this.db.transaction(async (tx) => {
        await this.bounds(tx);
        // Mapping writers share no advisory namespace. SHARE prevents phantoms.
        await tx.execute(sql`lock table channel_identities in share mode`);
        await tx.execute(
          sql`select id from users where id=${input.userId}::uuid for update`,
        );
        await tx.execute(
          sql`select id from experts where id=${input.expertId}::uuid for update`,
        );
        const owner =
          await tx.execute(sql`select c.id from channel_identities c join users u on u.id=c.user_id join experts e on e.user_id=u.id
    where c.id=${input.channelIdentityId}::uuid and u.id=${input.userId}::uuid and e.id=${input.expertId}::uuid
     and c.external_id=${input.externalId} and c.bot_key is not distinct from ${input.botKey}::text
     and c.external_chat_id is not distinct from ${input.externalChatId}::text and ${this.eligible()}`);
        if (owner.rows.length !== 1) return { kind: "denied" } as const;
        const inserted = await tx.execute<{
          expiresAt: string;
        }>(sql`with clock as materialized(select clock_timestamp() now)
    insert into expert_sessions(token_digest,user_id,expert_id,channel_identity_id,external_id,bot_key,external_chat_id,created_at,expires_at)
    select ${input.tokenDigest},${input.userId}::uuid,${input.expertId}::uuid,${input.channelIdentityId}::uuid,${input.externalId},${input.botKey},${input.externalChatId},now,now+interval '1 hour'
    from clock where ${input.proofExpiresAt}::timestamptz>now and ${input.proofExpiresAt}::timestamptz<=now+interval '330 seconds'
    returning expires_at "expiresAt"`);
        if (!inserted.rows[0]) return { kind: "denied" } as const;
        await tx.execute(sql`insert into expert_identity_proof_receipts(replay_digest,session_token_digest,expires_at)
    values(${input.replayDigest},${input.tokenDigest},${input.proofExpiresAt})`);
        return {
          kind: "issued",
          expiresAt: new Date(inserted.rows[0].expiresAt),
        } as const;
      });
    } catch (error) {
      let cause: unknown = error;
      const seen = new Set<unknown>();
      while (cause && typeof cause === "object" && !seen.has(cause)) {
        seen.add(cause);
        if ((cause as { code?: string }).code === "23505")
          return { kind: "denied" };
        cause = (cause as { cause?: unknown }).cause;
      }
      throw new Error("expert_session_repository_unavailable");
    }
  }
  async findByTokenHash(
    hash: string,
  ): Promise<{ userId: string; expertId: string; expiresAt: Date } | null> {
    if (!digest(hash)) return null;
    const r = await this.db.execute<{
      userId: string;
      expertId: string;
      expiresAt: string;
    }>(sql`select s.user_id "userId",s.expert_id "expertId",s.expires_at "expiresAt"
   from expert_sessions s join channel_identities c on c.id=s.channel_identity_id and c.user_id=s.user_id
   join users u on u.id=s.user_id join experts e on e.id=s.expert_id and e.user_id=s.user_id
   where s.token_digest=${hash} and s.revoked_at is null and s.expires_at>clock_timestamp()
    and c.external_id=s.external_id and c.bot_key is not distinct from s.bot_key and c.external_chat_id is not distinct from s.external_chat_id
    and ${this.eligible()}`);
    return r.rows.length === 1
      ? { ...r.rows[0]!, expiresAt: new Date(r.rows[0]!.expiresAt) }
      : null;
  }
  async revoke(
    hash: string,
  ): Promise<{ kind: "revoked" } | { kind: "denied" }> {
    if (!digest(hash)) return { kind: "denied" };
    return this.db.transaction(async (tx) => {
      await this.bounds(tx);
      await tx.execute(sql`lock table channel_identities in share mode`);
      await tx.execute(
        sql`select id from users where id=(select user_id from expert_sessions where token_digest=${hash}) for update`,
      );
      await tx.execute(
        sql`select id from experts where id=(select expert_id from expert_sessions where token_digest=${hash}) for update`,
      );
      const r =
        await tx.execute(sql`update expert_sessions s set revoked_at=clock_timestamp()
    from channel_identities c join users u on u.id=c.user_id join experts e on e.user_id=u.id
    where s.token_digest=${hash} and s.revoked_at is null and s.expires_at>clock_timestamp()
     and c.id=s.channel_identity_id and u.id=s.user_id and e.id=s.expert_id
     and c.external_id=s.external_id and c.bot_key is not distinct from s.bot_key and c.external_chat_id is not distinct from s.external_chat_id
     and ${this.eligible()} returning 1`);
      return { kind: r.rows.length ? "revoked" : "denied" };
    });
  }
  async cleanupExpired(
    limit: number,
  ): Promise<{ sessionsRemoved: number; receiptsRemoved: number }> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
      throw new Error("expert_session_cleanup_invalid");
    return this.db.transaction(async (tx) => {
      await this.bounds(tx);
      const receipts = await tx.execute(
        sql`delete from expert_identity_proof_receipts where replay_digest in(select replay_digest from expert_identity_proof_receipts where expires_at<=clock_timestamp() order by expires_at,replay_digest for update skip locked limit ${limit}) returning 1`,
      );
      const sessions = await tx.execute(
        sql`delete from expert_sessions where token_digest in(select s.token_digest from expert_sessions s where s.expires_at<=clock_timestamp() and not exists(select 1 from expert_identity_proof_receipts r where r.session_token_digest=s.token_digest) order by expires_at,token_digest for update skip locked limit ${limit}) returning 1`,
      );
      return {
        sessionsRemoved: sessions.rows.length,
        receiptsRemoved: receipts.rows.length,
      };
    });
  }
}
