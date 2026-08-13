import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";

import type {
  ClientViewCallbackClaims,
  ClientViewCallbackStore,
} from "@ii-tonya/integrations";
import type { DrizzleDb } from "../client.js";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const TELEGRAM_ID = /^[1-9]\d{0,19}$/u;
const TOKEN_HASH = /^[0-9a-f]{64}$/u;

type Transaction = Parameters<DrizzleDb["transaction"]>[0] extends (
  transaction: infer T,
) => unknown
  ? T
  : never;

const finiteDate = (value: Date): boolean => Number.isFinite(value.getTime());
const asDate = (value: Date | string): Date => {
  const result = value instanceof Date ? value : new Date(value);
  if (!finiteDate(result)) throw new Error("expert_query_integrity_failure");
  return result;
};
const contentFreeHash = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

const parseClaims = (value: string): ClientViewCallbackClaims => {
  let claims: Partial<ClientViewCallbackClaims>;
  try {
    claims = JSON.parse(value) as Partial<ClientViewCallbackClaims>;
  } catch {
    throw new Error("expert_query_integrity_failure");
  }
  if (
    typeof claims.reservationId !== "string" ||
    !UUID.test(claims.reservationId) ||
    typeof claims.expertId !== "string" ||
    !UUID.test(claims.expertId) ||
    !Number.isSafeInteger(claims.version) ||
    (claims.version ?? 0) < 1 ||
    !Number.isSafeInteger(claims.expiresAtEpochSeconds) ||
    (claims.expiresAtEpochSeconds ?? 0) < 1
  ) {
    throw new Error("expert_query_integrity_failure");
  }
  return claims as ClientViewCallbackClaims;
};

const safeCount = (value: string): number => {
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) {
    throw new Error("expert_query_integrity_failure");
  }
  const parsed = BigInt(value);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("expert_query_integrity_failure");
  }
  return Number(parsed);
};

export interface ExpertTelegramQueryRepositoryOptions {
  readonly beforeClientViewAudit?: () => Promise<void>;
}

export interface DbExpertClientChoiceRecord {
  readonly reservationId: string;
  readonly version: number;
  readonly startsAt: Date;
  readonly serviceName: string;
}

export interface DbExpertClientView {
  readonly reservationId: string;
  readonly clientDisplayName: string;
  readonly startsAt: Date;
  readonly serviceName: string;
  readonly preparationNote?: string;
}

export interface DbExpertTelegramStats {
  readonly upcoming: number;
  readonly completed: number;
  readonly cancelled: number;
  readonly noShow: number;
}

export class PostgresExpertTelegramQueryRepository implements ClientViewCallbackStore {
  private readonly beforeClientViewAudit: () => Promise<void>;

  constructor(
    private readonly db: DrizzleDb,
    options: ExpertTelegramQueryRepositoryOptions = {},
  ) {
    this.beforeClientViewAudit =
      options.beforeClientViewAudit ?? (async () => undefined);
  }

  async listClientCandidates(command: {
    expertId: string;
    telegramUserId: string;
    now: Date;
    limit: 20;
  }): Promise<readonly DbExpertClientChoiceRecord[] | null> {
    if (!this.validActor(command) || command.limit !== 20) return null;
    const result = await this.db.execute<{
      reservationId: string;
      version: number;
      startsAt: Date | string;
      serviceName: string;
    }>(sql`
      select
        r.id as "reservationId",
        r.version,
        s.starts_at as "startsAt",
        es.name as "serviceName"
      from experts e
      join users u on u.id = e.user_id and u.active
      join channel_identities ci
        on ci.user_id = e.user_id
        and ci.provider = 'telegram'
        and ci.external_id = ${command.telegramUserId}
      join reservations r on r.expert_id = e.id
      join slots s on s.id = r.slot_id
      join expert_services es
        on es.id = r.expert_service_id
        and es.expert_id = r.expert_id
      where e.id = ${command.expertId}::uuid
        and e.active
        and e.verified
        and r.status in ('reserved', 'booked')
        and s.starts_at >= ${command.now}
      order by s.starts_at, r.id
      limit 20
    `);
    if (result.rows.length === 0 && !(await this.authorized(command)))
      return null;
    return result.rows.map((row) => ({
      reservationId: row.reservationId,
      version: row.version,
      startsAt: asDate(row.startsAt),
      serviceName: row.serviceName,
    }));
  }

  async readStats(command: {
    expertId: string;
    telegramUserId: string;
    from: string;
    now: Date;
  }): Promise<DbExpertTelegramStats | null> {
    const from = new Date(command.from);
    if (!this.validActor(command) || !finiteDate(from) || from >= command.now) {
      return null;
    }
    const result = await this.db.execute<{
      authorized: boolean;
      upcoming: string;
      completed: string;
      cancelled: string;
      noShow: string;
    }>(sql`
      select
        count(distinct e.id) > 0 as authorized,
        count(r.id) filter (
          where r.status in ('reserved', 'booked') and s.starts_at >= ${command.now}
        )::text as upcoming,
        count(r.id) filter (
          where r.status = 'completed'
            and s.starts_at >= ${from}
            and s.starts_at < ${command.now}
        )::text as completed,
        count(r.id) filter (
          where r.status in ('cancelled_by_client', 'cancelled_by_expert')
            and r.updated_at >= ${from}
            and r.updated_at < ${command.now}
        )::text as cancelled,
        count(r.id) filter (
          where r.status = 'no_show'
            and s.starts_at >= ${from}
            and s.starts_at < ${command.now}
        )::text as "noShow"
      from experts e
      join users u on u.id = e.user_id and u.active
      join channel_identities ci
        on ci.user_id = e.user_id
        and ci.provider = 'telegram'
        and ci.external_id = ${command.telegramUserId}
      left join reservations r on r.expert_id = e.id
      left join slots s on s.id = r.slot_id
      where e.id = ${command.expertId}::uuid
        and e.active
        and e.verified
    `);
    const row = result.rows[0];
    if (row?.authorized !== true) return null;
    return {
      upcoming: safeCount(row.upcoming),
      completed: safeCount(row.completed),
      cancelled: safeCount(row.cancelled),
      noShow: safeCount(row.noShow),
    };
  }

  async put(
    tokenHash: string,
    claims: ClientViewCallbackClaims,
  ): Promise<void> {
    if (!TOKEN_HASH.test(tokenHash))
      throw new Error("expert_query_unavailable");
    const inserted = await this.db.execute(sql`
      insert into notifications (
        reservation_id, idempotency_key, callback_token_hash, callback_claims,
        callback_expires_at, callback_expert_id, callback_action, callback_version
      )
      select
        r.id, ${`telegram-client-view:${tokenHash}`}, ${tokenHash},
        ${JSON.stringify(claims)}, to_timestamp(${claims.expiresAtEpochSeconds}),
        r.expert_id, 'view_client', r.version
      from reservations r
      join experts e on e.id = r.expert_id
      join users u on u.id = e.user_id
      join slots s on s.id = r.slot_id
      where r.id = ${claims.reservationId}::uuid
        and r.expert_id = ${claims.expertId}::uuid
        and r.version = ${claims.version}
        and r.status in ('reserved', 'booked')
        and s.starts_at >= clock_timestamp()
        and e.active and e.verified and u.active
        and to_timestamp(${claims.expiresAtEpochSeconds}) > clock_timestamp()
        and to_timestamp(${claims.expiresAtEpochSeconds}) <= clock_timestamp() + interval '10 minutes'
      returning id
    `);
    if (inserted.rowCount !== 1) throw new Error("expert_query_unavailable");
  }

  async peek(tokenHash: string): Promise<ClientViewCallbackClaims | null> {
    if (!TOKEN_HASH.test(tokenHash)) return null;
    const result = await this.db.execute<{ callbackClaims: string }>(sql`
      select callback_claims as "callbackClaims"
      from notifications
      where callback_token_hash = ${tokenHash}
        and callback_action = 'view_client'
        and callback_consumed_at is null
    `);
    const value = result.rows[0]?.callbackClaims;
    return value === undefined ? null : parseClaims(value);
  }

  async consumeClientView(command: {
    tokenHash: string;
    reservationId: string;
    expertId: string;
    telegramUserId: string;
    version: number;
    now: Date;
    correlationId: string;
  }): Promise<DbExpertClientView | null> {
    if (
      !this.validActor(command) ||
      !TOKEN_HASH.test(command.tokenHash) ||
      !UUID.test(command.reservationId) ||
      !Number.isSafeInteger(command.version) ||
      command.version < 1 ||
      command.correlationId.length < 1 ||
      command.correlationId.length > 256
    ) {
      return null;
    }
    return this.db.transaction(async (tx) =>
      this.consumeInTransaction(tx, command),
    );
  }

  private async consumeInTransaction(
    tx: Transaction,
    command: {
      tokenHash: string;
      reservationId: string;
      expertId: string;
      telegramUserId: string;
      version: number;
      now: Date;
      correlationId: string;
    },
  ): Promise<DbExpertClientView | null> {
    const result = await tx.execute<{
      reservationId: string;
      actorUserId: string;
      clientDisplayName: string;
      startsAt: Date | string;
      serviceName: string;
      preparationNote: string | null;
    }>(sql`
      with consumed as (
        update notifications n
        set callback_consumed_at = ${command.now}, updated_at = ${command.now}
        from reservations r
        join experts e on e.id = r.expert_id
        join users u on u.id = e.user_id and u.active
        join channel_identities ci
          on ci.user_id = e.user_id
          and ci.provider = 'telegram'
          and ci.external_id = ${command.telegramUserId}
        join slots s on s.id = r.slot_id
        where n.callback_token_hash = ${command.tokenHash}
          and n.callback_action = 'view_client'
          and n.callback_consumed_at is null
          and n.callback_expires_at > ${command.now}
          and n.reservation_id = r.id
          and r.id = ${command.reservationId}::uuid
          and r.expert_id = ${command.expertId}::uuid
          and n.callback_expert_id = r.expert_id
          and n.callback_version = ${command.version}
          and r.version = ${command.version}
          and r.status in ('reserved', 'booked')
          and s.starts_at >= ${command.now}
          and e.active and e.verified
          and n.callback_claims::jsonb @> jsonb_build_object(
            'reservationId', r.id::text,
            'expertId', r.expert_id::text,
            'version', r.version
          )
        returning r.id, r.user_id, r.expert_service_id, r.expert_id, e.user_id as actor_user_id
      )
      select
        c.id as "reservationId",
        c.actor_user_id as "actorUserId",
        coalesce(nullif(cp.display_name, ''), 'Клиент') as "clientDisplayName",
        s.starts_at as "startsAt",
        es.name as "serviceName",
        case when note_consent.granted then cp.expert_note else null end as "preparationNote"
      from consumed c
      join reservations r on r.id = c.id
      join slots s on s.id = r.slot_id
      join expert_services es
        on es.id = c.expert_service_id and es.expert_id = c.expert_id
      left join client_profiles cp on cp.user_id = c.user_id
      left join lateral (
        select coalesce(bool_and(latest.decision = 'granted'), false) as granted
        from consents latest
        where latest.user_id = c.user_id
          and latest.consent_type = 'expert_note'
          and latest.created_at = (
            select max(candidate.created_at)
            from consents candidate
            where candidate.user_id = c.user_id
              and candidate.consent_type = 'expert_note'
          )
      ) note_consent on true
    `);
    const row = result.rows[0];
    if (row === undefined) return null;
    await this.beforeClientViewAudit();
    await tx.execute(sql`
      insert into audit_events (
        actor_type, actor_id, authenticated_session_id_hash, action,
        object_type, object_id, decision, reason_code, correlation_id,
        occurred_at, metadata_hash
      ) values (
        'expert', ${row.actorUserId}::uuid,
        ${contentFreeHash({ provider: "telegram", actor: row.actorUserId })},
        'reservation.client_view', 'reservation', ${row.reservationId}::uuid,
        'allowed', 'authorized_single_use_callback', ${command.correlationId},
        ${command.now},
        ${contentFreeHash({ action: "reservation.client_view", version: command.version })}
      )
    `);
    return {
      reservationId: row.reservationId,
      clientDisplayName: row.clientDisplayName,
      startsAt: asDate(row.startsAt),
      serviceName: row.serviceName,
      ...(row.preparationNote === null
        ? {}
        : { preparationNote: row.preparationNote }),
    };
  }

  private validActor(command: {
    expertId: string;
    telegramUserId: string;
    now: Date;
  }): boolean {
    return (
      UUID.test(command.expertId) &&
      TELEGRAM_ID.test(command.telegramUserId) &&
      finiteDate(command.now)
    );
  }

  private async authorized(command: {
    expertId: string;
    telegramUserId: string;
  }): Promise<boolean> {
    const result = await this.db.execute<{ authorized: boolean }>(sql`
      select exists (
        select 1
        from experts e
        join users u on u.id = e.user_id and u.active
        join channel_identities ci
          on ci.user_id = e.user_id
          and ci.provider = 'telegram'
          and ci.external_id = ${command.telegramUserId}
        where e.id = ${command.expertId}::uuid
          and e.active and e.verified
      ) as authorized
    `);
    return result.rows[0]?.authorized === true;
  }
}
