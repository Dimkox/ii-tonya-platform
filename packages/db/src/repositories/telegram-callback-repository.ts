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
    await this.db.$client.query(
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
        ) values ($1::uuid, $2, $3, $4, to_timestamp($5), $6::uuid, $7, $8)
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
        update notifications
        set callback_consumed_at = $5, updated_at = $5
        where callback_token_hash = $1
          and callback_consumed_at is null
          and callback_expires_at > $5
          and callback_expert_id = $2::uuid
          and callback_action = $3
          and callback_version = $4
          and callback_version > 0
        returning callback_claims
      `,
      [input.tokenHash, input.expertId, input.action, input.version, input.now],
    );
    const value = result.rows[0]?.callback_claims;
    return value === undefined ? null : parseClaims(value);
  }
}
