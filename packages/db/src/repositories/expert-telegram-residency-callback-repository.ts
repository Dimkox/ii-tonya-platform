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

interface CheckoutRow extends CallbackRow {
  checkoutStatus: "issued" | "processing" | "ready" | "unavailable" | "unknown";
  checkoutUrl: string | null;
  fence: string | null;
  recovery?: boolean;
}

export type ExpertResidencyCheckoutOutcome =
  | { readonly kind: "ready"; readonly checkoutUrl: string }
  | { readonly kind: "unavailable" | "unknown" };

export type ExpertResidencyCheckoutClaim =
  | {
      readonly kind: "acquired";
      readonly tokenHash: string;
      readonly claims: ExpertResidencyCallbackClaims;
      readonly fence: string;
      readonly recovery: boolean;
    }
  | {
      readonly kind: "replay";
      readonly tokenHash: string;
      readonly outcome: ExpertResidencyCheckoutOutcome;
    }
  | { readonly kind: "processing"; readonly tokenHash: string };

const validInstant = (value: Date): boolean => Number.isFinite(value.getTime());
const validFence = (value: string): boolean => UUID.test(value);
const validCheckoutUrl = (value: string): boolean => {
  if (value.length < 1 || value.length > 2048 || /\s/u.test(value))
    return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" && url.username === "" && url.password === ""
    );
  } catch {
    return false;
  }
};

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
      `insert into expert_telegram_residency_callbacks as c
       (token_hash,expert_id,telegram_user_id,tariff_version_id,action,idempotency_key,expires_at)
       select $1,$2::uuid,$3,$4::uuid,'start_residency_checkout',$5,$6
       from experts e
       join users u on u.id=e.user_id and u.active
       join channel_identities ci on ci.user_id=e.user_id and ci.provider='telegram' and ci.external_id=$3
       where e.id=$2::uuid and e.active and e.verified
       on conflict (idempotency_key) do update
       set idempotency_key=excluded.idempotency_key
       where c.token_hash=excluded.token_hash
         and c.expert_id=excluded.expert_id
         and c.telegram_user_id=excluded.telegram_user_id
         and c.tariff_version_id=excluded.tariff_version_id
         and c.action=excluded.action
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
      `update expert_telegram_residency_callbacks c
       set consumed_at=$6,checkout_status='unknown',outcome_recorded_at=$6
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

  async inspectCheckout(
    tokenHash: string,
    expertId: string,
    telegramUserId: string,
    now: Date,
  ): Promise<ExpertResidencyCallbackClaims | null> {
    if (
      !HASH.test(tokenHash) ||
      !UUID.test(expertId) ||
      !TELEGRAM_ID.test(telegramUserId) ||
      !validInstant(now)
    ) {
      return null;
    }
    const result: QueryResult<CallbackRow> = await this.db.$client.query(
      `select c.expert_id as "expertId",c.telegram_user_id as "telegramUserId",
              c.tariff_version_id as "tariffVersionId",c.expires_at as "expiresAt"
       from expert_telegram_residency_callbacks c
       join experts e on e.id=c.expert_id and e.active and e.verified
       join users u on u.id=e.user_id and u.active
       join channel_identities ci on ci.user_id=e.user_id and ci.provider='telegram' and ci.external_id=$3
       where c.token_hash=$1 and c.expert_id=$2::uuid and c.telegram_user_id=$3
         and c.action='start_residency_checkout' and c.expires_at>$4`,
      [tokenHash, expertId, telegramUserId, now],
    );
    const row = result.rows[0];
    return row === undefined
      ? null
      : { ...row, action: "start_residency_checkout" };
  }

  async claimCheckout(
    tokenHash: string,
    claims: Omit<ExpertResidencyCallbackClaims, "expiresAt">,
    now: Date,
    leaseUntil: Date,
    fence: string,
  ): Promise<ExpertResidencyCheckoutClaim | null> {
    if (
      !HASH.test(tokenHash) ||
      !UUID.test(claims.expertId) ||
      !TELEGRAM_ID.test(claims.telegramUserId) ||
      !UUID.test(claims.tariffVersionId) ||
      claims.action !== "start_residency_checkout" ||
      !validInstant(now) ||
      !validInstant(leaseUntil) ||
      leaseUntil.getTime() <= now.getTime() ||
      leaseUntil.getTime() - now.getTime() > 300_000 ||
      !validFence(fence)
    ) {
      return null;
    }
    const acquired: QueryResult<CheckoutRow> = await this.db.$client.query(
      `with candidate as (
         select c.token_hash,c.checkout_status
         from expert_telegram_residency_callbacks c
         join experts e on e.id=c.expert_id and e.active and e.verified
         join users u on u.id=e.user_id and u.active
         join channel_identities ci on ci.user_id=e.user_id and ci.provider='telegram' and ci.external_id=$3
         where c.token_hash=$1 and c.expert_id=$2::uuid and c.telegram_user_id=$3
           and c.tariff_version_id=$4::uuid and c.action=$5 and c.expires_at>$6
           and (c.checkout_status='issued' or (c.checkout_status='processing' and c.processing_lease_until<=$6))
         for update of c
       ), updated as (
         update expert_telegram_residency_callbacks c
         set checkout_status='processing',consumed_at=coalesce(c.consumed_at,$6),
             processing_fence=$8::uuid,processing_lease_until=$7,
             checkout_url=null,outcome_recorded_at=null
         from candidate old
         where c.token_hash=old.token_hash
         returning c.expert_id as "expertId",c.telegram_user_id as "telegramUserId",
                   c.tariff_version_id as "tariffVersionId",c.expires_at as "expiresAt",
                   c.checkout_status as "checkoutStatus",c.checkout_url as "checkoutUrl",
                   c.processing_fence::text as fence,(old.checkout_status='processing') as recovery
       ) select * from updated`,
      [
        tokenHash,
        claims.expertId,
        claims.telegramUserId,
        claims.tariffVersionId,
        claims.action,
        now,
        leaseUntil,
        fence,
      ],
    );
    const won = acquired.rows[0];
    if (won !== undefined && won.fence !== null) {
      return {
        kind: "acquired",
        tokenHash,
        claims: { ...won, action: "start_residency_checkout" },
        fence: won.fence,
        recovery: won.recovery === true,
      };
    }
    const existing: QueryResult<CheckoutRow> = await this.db.$client.query(
      `select c.expert_id as "expertId",c.telegram_user_id as "telegramUserId",
              c.tariff_version_id as "tariffVersionId",c.expires_at as "expiresAt",
              c.checkout_status as "checkoutStatus",c.checkout_url as "checkoutUrl",
              c.processing_fence::text as fence
       from expert_telegram_residency_callbacks c
       join experts e on e.id=c.expert_id and e.active and e.verified
       join users u on u.id=e.user_id and u.active
       join channel_identities ci on ci.user_id=e.user_id and ci.provider='telegram' and ci.external_id=$3
       where c.token_hash=$1 and c.expert_id=$2::uuid and c.telegram_user_id=$3
         and c.tariff_version_id=$4::uuid and c.action=$5 and c.expires_at>$6`,
      [
        tokenHash,
        claims.expertId,
        claims.telegramUserId,
        claims.tariffVersionId,
        claims.action,
        now,
      ],
    );
    const row = existing.rows[0];
    if (row === undefined || row.checkoutStatus === "issued") return null;
    if (row.checkoutStatus === "processing") {
      return { kind: "processing", tokenHash };
    }
    if (row.checkoutStatus === "ready" && row.checkoutUrl !== null) {
      return {
        kind: "replay",
        tokenHash,
        outcome: { kind: "ready", checkoutUrl: row.checkoutUrl },
      };
    }
    if (
      row.checkoutStatus !== "unavailable" &&
      row.checkoutStatus !== "unknown"
    ) {
      return null;
    }
    return {
      kind: "replay",
      tokenHash,
      outcome: { kind: row.checkoutStatus },
    };
  }

  async recordCheckoutOutcome(
    tokenHash: string,
    fence: string,
    outcome: ExpertResidencyCheckoutOutcome,
    now: Date,
  ): Promise<boolean> {
    if (
      !HASH.test(tokenHash) ||
      !validFence(fence) ||
      !validInstant(now) ||
      (outcome.kind === "ready" && !validCheckoutUrl(outcome.checkoutUrl))
    ) {
      return false;
    }
    const result = await this.db.$client.query<{ checkoutStatus: string }>(
      `update expert_telegram_residency_callbacks
       set checkout_status=case
             when $3='ready' and expires_at<=$5 then 'unavailable'
             else $3 end,
           checkout_url=case
             when $3='ready' and expires_at>$5 then $4 else null end,
           processing_fence=null,
            processing_lease_until=null,outcome_recorded_at=$5
       where token_hash=$1 and checkout_status='processing' and processing_fence=$2::uuid
       returning checkout_status as "checkoutStatus"`,
      [
        tokenHash,
        fence,
        outcome.kind,
        outcome.kind === "ready" ? outcome.checkoutUrl : null,
        now,
      ],
    );
    return (
      result.rowCount === 1 && result.rows[0]?.checkoutStatus === outcome.kind
    );
  }

  async clearExpiredCheckoutUrls(now: Date, limit: number): Promise<number> {
    if (
      !validInstant(now) ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 1_000
    ) {
      throw new Error("invalid_expert_telegram_checkout_cleanup");
    }
    const result = await this.db.$client.query(
      `with expired as (
         select token_hash from expert_telegram_residency_callbacks
         where checkout_url is not null and expires_at<=$1
         order by expires_at,token_hash
         for update skip locked limit $2
       ) update expert_telegram_residency_callbacks c
         set checkout_url=null,checkout_status='unavailable'
         from expired where c.token_hash=expired.token_hash
         returning c.token_hash`,
      [now, limit],
    );
    return result.rowCount ?? 0;
  }
}
