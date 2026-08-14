import type { QueryResult, QueryResultRow } from "pg";
import type { DrizzleDb } from "../client.js";

const HASH = /^[0-9a-f]{64}$/u;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const TELEGRAM_ID = /^[1-9]\d{0,19}$/u;

export interface ExpertResidencyCallbackClaims {
  readonly expertId: string;
  readonly telegramUserId: string;
  readonly tariffVersionId: string;
  readonly action: "start_residency_checkout";
  readonly expiresAt: Date;
}

interface CallbackRow extends QueryResultRow {
  expertId: string;
  telegramUserId: string;
  tariffVersionId: string;
  expiresAt: Date;
}

const valid = (
  tokenHash: string,
  claims: ExpertResidencyCallbackClaims,
): boolean =>
  HASH.test(tokenHash) &&
  UUID.test(claims.expertId) &&
  TELEGRAM_ID.test(claims.telegramUserId) &&
  UUID.test(claims.tariffVersionId) &&
  claims.action === "start_residency_checkout" &&
  Number.isFinite(claims.expiresAt.getTime());

export class PostgresExpertTelegramResidencyCallbackRepository {
  constructor(private readonly db: DrizzleDb) {}

  async put(
    tokenHash: string,
    claims: ExpertResidencyCallbackClaims,
    idempotencyKey: string,
  ): Promise<void> {
    if (
      !valid(tokenHash, claims) ||
      idempotencyKey.length < 1 ||
      idempotencyKey.length > 256
    ) {
      throw new Error("invalid_expert_residency_callback");
    }
    const result = await this.db.$client.query(
      `insert into expert_telegram_residency_callbacks
       (token_hash,expert_id,telegram_user_id,tariff_version_id,action,idempotency_key,expires_at)
       select $1,$2::uuid,$3,$4::uuid,'start_residency_checkout',$5,$6
       from experts e
       join users u on u.id=e.user_id and u.active
       join channel_identities ci on ci.user_id=e.user_id and ci.provider='telegram' and ci.external_id=$3
       where e.id=$2::uuid and e.active and e.verified
       returning token_hash`,
      [
        tokenHash,
        claims.expertId,
        claims.telegramUserId,
        claims.tariffVersionId,
        idempotencyKey,
        claims.expiresAt,
      ],
    );
    if (result.rowCount !== 1)
      throw new Error("expert_residency_callback_denied");
  }

  async consume(
    tokenHash: string,
    claims: Omit<ExpertResidencyCallbackClaims, "expiresAt">,
    now: Date,
  ): Promise<ExpertResidencyCallbackClaims | null> {
    if (
      !HASH.test(tokenHash) ||
      !UUID.test(claims.expertId) ||
      !TELEGRAM_ID.test(claims.telegramUserId) ||
      !UUID.test(claims.tariffVersionId) ||
      claims.action !== "start_residency_checkout" ||
      !Number.isFinite(now.getTime())
    ) {
      return null;
    }
    const result: QueryResult<CallbackRow> = await this.db.$client.query(
      `update expert_telegram_residency_callbacks c set consumed_at=$6
       from experts e
       join users u on u.id=e.user_id and u.active
       join channel_identities ci on ci.user_id=e.user_id and ci.provider='telegram' and ci.external_id=$3
       where c.token_hash=$1 and c.expert_id=$2::uuid and c.telegram_user_id=$3
         and c.tariff_version_id=$4::uuid and c.action=$5 and c.consumed_at is null and c.expires_at>$6
         and e.id=c.expert_id and e.active and e.verified
       returning c.expert_id as "expertId",c.telegram_user_id as "telegramUserId",c.tariff_version_id as "tariffVersionId",c.expires_at as "expiresAt"`,
      [
        tokenHash,
        claims.expertId,
        claims.telegramUserId,
        claims.tariffVersionId,
        claims.action,
        now,
      ],
    );
    const row = result.rows[0];
    return row === undefined
      ? null
      : { ...row, action: "start_residency_checkout" };
  }
}
