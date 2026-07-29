import {
  CallbackConflictError,
  CallbackDataIntegrityError,
  CallbackInfrastructureError,
} from "@ii-tonya/contracts";
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

const retryableSystemCodes = new Set([
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTDOWN",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETRESET",
  "ENETUNREACH",
  "ENOTFOUND",
  "EPIPE",
  "ETIMEDOUT",
  "EAI_AGAIN",
]);

const retryableSqlStates = new Set([
  "40001",
  "40P01",
  "57P01",
  "57P02",
  "57P03",
  "53000",
  "53100",
  "53200",
  "53300",
  "53400",
]);

const MAX_ERROR_GRAPH_NODES = 32;
const MAX_ERROR_GRAPH_DEPTH = 8;
const MAX_ERROR_CHILDREN = 16;

const isObjectLike = (value: unknown): value is object =>
  (typeof value === "object" && value !== null) ||
  typeof value === "function";

const readErrorProperty = (
  value: object,
  property: PropertyKey,
): unknown => {
  try {
    return (value as Record<PropertyKey, unknown>)[property];
  } catch {
    return undefined;
  }
};

const isRetryableCode = (code: string): boolean =>
  retryableSystemCodes.has(code) ||
  code.startsWith("08") ||
  retryableSqlStates.has(code);

const extractErrorCodes = (root: unknown): ReadonlySet<string> => {
  const queue: Array<{ value: object; depth: number }> = [];
  const seen = new WeakSet<object>();
  const codes = new Set<string>();
  let enqueued = 0;
  const enqueue = (value: unknown, depth: number): void => {
    if (
      !isObjectLike(value) ||
      seen.has(value) ||
      enqueued >= MAX_ERROR_GRAPH_NODES
    ) {
      return;
    }
    seen.add(value);
    queue.push({ value, depth });
    enqueued += 1;
  };
  enqueue(root, 0);

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    if (current === undefined) break;
    const code = readErrorProperty(current.value, "code");
    if (typeof code === "string") codes.add(code);
    if (current.depth >= MAX_ERROR_GRAPH_DEPTH) continue;

    enqueue(
      readErrorProperty(current.value, "cause"),
      current.depth + 1,
    );
    const errors = readErrorProperty(current.value, "errors");
    try {
      if (Array.isArray(errors)) {
        const count = Math.min(errors.length, MAX_ERROR_CHILDREN);
        for (let index = 0; index < count; index += 1) {
          enqueue(errors[index], current.depth + 1);
        }
        continue;
      }
      if (!isObjectLike(errors)) continue;
      const iteratorFactory = (
        errors as Record<PropertyKey, unknown>
      )[Symbol.iterator];
      if (typeof iteratorFactory !== "function") {
        enqueue(errors, current.depth + 1);
        continue;
      }
      const iterator = iteratorFactory.call(errors) as Iterator<unknown>;
      for (let index = 0; index < MAX_ERROR_CHILDREN; index += 1) {
        const next = iterator.next();
        if (next.done === true) break;
        enqueue(next.value, current.depth + 1);
        if (enqueued >= MAX_ERROR_GRAPH_NODES) break;
      }
    } catch {
      // Malformed iterables are deterministic data-integrity failures.
    }
  }
  return codes;
};

const callbackStoreQuery = async <Row extends QueryResultRow>(
  db: DrizzleDb,
  statement: string,
  values: unknown[],
): Promise<QueryResult<Row>> => {
  try {
    return await db.$client.query<Row>(statement, values);
  } catch (error) {
    const codes = extractErrorCodes(error);
    if (Array.from(codes).some(isRetryableCode)) {
      throw new CallbackInfrastructureError(
        "callback_store_unavailable",
        error,
      );
    }
    if (codes.has("23505")) {
      throw new CallbackConflictError(error);
    }
    throw new CallbackDataIntegrityError(error);
  }
};

const parseClaims = (value: string): StoredExpertCallbackClaims => {
  let parsed: Partial<StoredExpertCallbackClaims>;
  try {
    parsed = JSON.parse(value) as Partial<StoredExpertCallbackClaims>;
  } catch (error) {
    throw new CallbackDataIntegrityError(error);
  }
  if (
    typeof parsed.reservationId !== "string" ||
    typeof parsed.expertId !== "string" ||
    (parsed.action !== "confirm" && parsed.action !== "cancel") ||
    !Number.isSafeInteger(parsed.version) ||
    (parsed.version ?? 0) <= 0 ||
    !Number.isSafeInteger(parsed.expiresAtEpochSeconds) ||
    (parsed.expiresAtEpochSeconds ?? 0) <= 0
  ) {
    throw new CallbackDataIntegrityError();
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
          (case
            when $7 = 'confirm' then jsonb_set(
              $4::jsonb,
              '{expiresAtEpochSeconds}',
              to_jsonb(
                floor(extract(epoch from least(
                  to_timestamp($5),
                  r.reserved_until
                )))::bigint
              )
            )
            else $4::jsonb
          end)::text,
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
        join slots s
          on s.id = r.slot_id
          and s.expert_service_id = r.expert_service_id
        join expert_services es
          on es.id = r.expert_service_id
          and es.expert_id = r.expert_id
        where r.id = $1::uuid
          and r.expert_id = $6::uuid
          and e.active
          and e.verified
          and r.version = $8
          and floor(extract(epoch from case
            when $7 = 'confirm'
              then least(to_timestamp($5), r.reserved_until)
            else to_timestamp($5)
          end)) > floor(extract(epoch from clock_timestamp()))
          and (
            (
              $7 = 'confirm'
              and r.status = 'reserved'
              and r.reserved_until > now()
              and s.starts_at > now()
              and s.observed_at >= now() - interval '15 minutes'
              and s.observed_at <= now()
              and es.active
            )
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
      throw new CallbackConflictError();
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
    return parseClaims(value);
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
        join slots s
          on s.id = r.slot_id
          and s.expert_service_id = r.expert_service_id
        join expert_services es
          on es.id = r.expert_service_id
          and es.expert_id = r.expert_id
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
    return parseClaims(value);
  }
}
