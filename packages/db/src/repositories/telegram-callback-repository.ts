import { CallbackInfrastructureError } from "@ii-tonya/contracts";
import type { QueryResult, QueryResultRow } from "pg";
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

const callbackStoreQuery = async <Row extends QueryResultRow>(
  db: DrizzleDb,
  statement: string,
  values: unknown[],
): Promise<QueryResult<Row>> => {
  try {
    return await db.$client.query<Row>(statement, values);
  } catch (error) {
    throw new CallbackInfrastructureError("callback_store_unavailable", error);
  }
};

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
    const result = await callbackStoreQuery(
      this.db,
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
          case
            when $7 = 'confirm' then jsonb_set(
              $4::jsonb,
              '{expiresAtEpochSeconds}',
              to_jsonb(
                floor(extract(epoch from least(
                  to_timestamp($5),
                  r.reserved_until
                )))::bigint
              )
            )::text
            else $4
          end,
          case
            when $7 = 'confirm'
              then least(to_timestamp($5), r.reserved_until)
            else to_timestamp($5)
          end,
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
    const result = await callbackStoreQuery<CallbackRow>(
      this.db,
      `
        select callback_claims
        from notifications
        where callback_token_hash = $1
          and callback_consumed_at is null
      `,
      [tokenHash],
    );
    const value = result.rows[0]?.callback_claims;
    if (value === undefined) return null;
    try {
      return parseClaims(value);
    } catch (error) {
      throw new CallbackInfrastructureError(
        "callback_store_unavailable",
        error,
      );
    }
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
    const result = await callbackStoreQuery<CallbackRow>(
      this.db,
      `
        update notifications n
        set callback_consumed_at = $5, updated_at = $5
        from reservations r
        join experts e on e.id = r.expert_id
        join slots s on s.id = r.slot_id
        join expert_services es on es.id = r.expert_service_id
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
            (
              $3 = 'confirm'
              and r.status = 'reserved'
              and r.reserved_until > $5
              and s.starts_at > $5
              and s.observed_at >= $5 - interval '15 minutes'
              and s.observed_at <= $5
              and es.active
            )
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
    if (value === undefined) return null;
    try {
      return parseClaims(value);
    } catch (error) {
      throw new CallbackInfrastructureError(
        "callback_store_unavailable",
        error,
      );
    }
  }
}
