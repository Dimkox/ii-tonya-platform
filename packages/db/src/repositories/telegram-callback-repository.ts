import type { QueryResultRow } from "pg";
import type { DrizzleDb } from "../client.js";

export interface StoredExpertCallbackClaims {
  reservationId: string;
  expertId: string;
  action: "confirm" | "cancel";
  version: number;
  expiresAtEpochSeconds: number;
}

export interface ConsumeTelegramCallbackCommand {
  tokenHash: string;
  expertId: string;
  action: "confirm" | "cancel";
  version: number;
  now: Date;
}

interface CallbackRow extends QueryResultRow {
  callback_claims: string;
}

const parseClaims = (value: string): StoredExpertCallbackClaims => {
  const parsed = JSON.parse(value) as Partial<StoredExpertCallbackClaims>;
  if (
    typeof parsed.reservationId !== "string" ||
    typeof parsed.expertId !== "string" ||
    (parsed.action !== "confirm" && parsed.action !== "cancel") ||
    !Number.isSafeInteger(parsed.version) ||
    (parsed.version ?? 0) <= 0 ||
    !Number.isSafeInteger(parsed.expiresAtEpochSeconds) ||
    (parsed.expiresAtEpochSeconds ?? 0) <= 0
  ) {
    throw new Error("Stored callback claims are invalid");
  }
  return parsed as StoredExpertCallbackClaims;
};

export class PostgresTelegramCallbackRepository {
  constructor(private readonly db: DrizzleDb) {}

  async put(
    tokenHash: string,
    claims: StoredExpertCallbackClaims,
  ): Promise<void> {
    const result = await this.db.$client.query(
      `
        insert into notifications (
          reservation_id,
          idempotency_key,
          callback_token_hash,
          callback_claims,
          callback_expires_at,
          callback_expert_id,
          callback_action,
          callback_version
        )
        select
          r.id,
          $2,
          $3,
          $4,
          to_timestamp($5),
          r.expert_id,
          $7,
          $8
        from reservations r
        join experts e on e.id = r.expert_id
        where r.id = $1::uuid
          and r.expert_id = $6::uuid
          and e.active
          and e.verified
          and r.version = $8
          and (
            ($7 = 'confirm' and r.status = 'reserved')
            or ($7 = 'cancel' and r.status in ('reserved', 'booked'))
          )
        returning id
      `,
      [
        claims.reservationId,
        `telegram-callback:${tokenHash}`,
        tokenHash,
        JSON.stringify(claims),
        claims.expiresAtEpochSeconds,
        claims.expertId,
        claims.action,
        claims.version,
      ],
    );
    if (result.rowCount !== 1) {
      throw new Error("Callback persistence rejected");
    }
  }

  async peek(tokenHash: string): Promise<StoredExpertCallbackClaims | null> {
    const result = await this.db.$client.query<CallbackRow>(
      `
        select callback_claims
        from notifications
        where callback_token_hash = $1
          and callback_consumed_at is null
      `,
      [tokenHash],
    );
    const value = result.rows[0]?.callback_claims;
    return value === undefined ? null : parseClaims(value);
  }

  async consumeIfValid(
    input: ConsumeTelegramCallbackCommand,
  ): Promise<StoredExpertCallbackClaims | null> {
    if (
      (input.action !== "confirm" && input.action !== "cancel") ||
      !Number.isSafeInteger(input.version) ||
      input.version <= 0
    ) {
      return null;
    }
    const result = await this.db.$client.query<CallbackRow>(
      `
        update notifications n
        set callback_consumed_at = $5, updated_at = $5
        from reservations r
        join experts e on e.id = r.expert_id
        where n.callback_token_hash = $1
          and n.reservation_id = r.id
          and n.callback_consumed_at is null
          and n.callback_expires_at > $5
          and r.expert_id = $2::uuid
          and n.callback_expert_id = r.expert_id
          and e.active
          and e.verified
          and n.callback_action = $3
          and n.callback_version = $4
          and n.callback_version > 0
          and r.version = $4
          and (
            ($3 = 'confirm' and r.status = 'reserved')
            or ($3 = 'cancel' and r.status in ('reserved', 'booked'))
          )
          and n.callback_claims::jsonb @> jsonb_build_object(
            'reservationId', r.id::text,
            'expertId', r.expert_id::text,
            'action', $3::text,
            'version', $4::integer
          )
        returning n.callback_claims
      `,
      [input.tokenHash, input.expertId, input.action, input.version, input.now],
    );
    const value = result.rows[0]?.callback_claims;
    return value === undefined ? null : parseClaims(value);
  }
}
