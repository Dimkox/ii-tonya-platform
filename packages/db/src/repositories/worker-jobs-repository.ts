import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";

interface BatchResult {
  readonly examined: number;
  readonly changed: number;
  readonly failed: number;
}

interface SafetyBatchResult {
  readonly examined: number;
  readonly escalated: number;
  readonly unchanged: number;
}

interface ReconciliationObservation {
  readonly window: { readonly from: string; readonly to: string };
  readonly mismatches: readonly {
    readonly reservationId: string;
    readonly local: string;
    readonly provider: string;
  }[];
  readonly projectionRepairs: readonly {
    readonly reservationId: string;
    readonly delivery: "delivered";
  }[];
}

const count = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("Invalid PostgreSQL worker count");
  }
  return parsed;
};

export class PostgresWorkerJobsRepository {
  constructor(private readonly db: DrizzleDb) {}

  async expireDueBatch(command: {
    readonly now: Date;
    readonly batchSize: number;
  }): Promise<BatchResult> {
    void command.now;
    return this.db.transaction(async (tx) => {
      const result = await tx.execute<{
        examined: number | string;
        changed: number | string;
        failed: number | string;
      }>(sql`
        with due as materialized (
          select id, user_id, expert_id, version
          from reservations
          where status = 'reserved'
            and reserved_until <= clock_timestamp()
          order by reserved_until, id
          for update skip locked
          limit ${command.batchSize}
        ), expired as (
          update reservations r
          set status = 'expired', version = r.version + 1, updated_at = clock_timestamp()
          from due
          where r.id = due.id and r.status = 'reserved' and r.version = due.version
          returning r.id, r.user_id, r.expert_id, r.version, r.updated_at
        ), audited as (
          insert into audit_events (
            actor_type, actor_id, authenticated_session_id_hash, action,
            object_type, object_id, decision, reason_code, correlation_id,
            occurred_at, metadata_hash
          )
          select
            'system', user_id, 'worker:reservation-expiry',
            'reservation.expired', 'reservation', id, 'allowed',
            'reserved_until_elapsed',
            'reservation-expiry:' || id::text || ':' || version::text,
            updated_at,
            'sha256:' || encode(digest(convert_to(
              id::text || ':' || version::text || ':reservation.expired',
              'UTF8'
            ), 'sha256'), 'hex')
          from expired
          returning id
        ), effects as (
          insert into integration_outbox (
            idempotency_key, topic, payload, correlation_id,
            reconciliation_key, payload_hash
          )
          select
            expired.id::text || ':' || expired.version::text || ':' || topics.topic,
            topics.topic,
            jsonb_build_object(
              'reservationId', expired.id::text,
              'version', expired.version,
              'charge', 0
            ),
            'reservation-expiry:' || expired.id::text || ':' || expired.version::text,
            'booking:' || expired.id::text,
            'sha256:' || encode(digest(convert_to(
              expired.id::text || ':' || expired.version::text || ':' || topics.topic || ':0',
              'UTF8'
            ), 'sha256'), 'hex')
          from expired
          cross join (values
            ('planerka.cancel'),
            ('client.reservation_expired'),
            ('expert.reservation_expired')
          ) as topics(topic)
          on conflict (idempotency_key) do nothing
          returning id
        )
        select
          (select count(*) from due) as examined,
          (select count(*) from expired) as changed,
          (select count(*) from due) - (select count(*) from expired) as failed
      `);
      const row = result.rows[0];
      if (row === undefined) throw new Error("PostgreSQL expiry batch returned no count");
      return {
        examined: count(row.examined),
        changed: count(row.changed),
        failed: count(row.failed),
      };
    });
  }

  async processDueBatch(command: {
    readonly now: Date;
    readonly batchSize: number;
  }): Promise<SafetyBatchResult> {
    void command.now;
    return this.db.transaction(async (tx) => {
      const result = await tx.execute<{
        examined: number | string;
        escalated: number | string;
        unchanged: number | string;
      }>(sql`
        with candidates as materialized (
          select id, owner_id, version, status, acknowledgement_deadline
          from human_escalations
          where (status = 'opened' and owner_id is not null)
             or (status in ('assigned', 'acknowledged')
                 and acknowledgement_deadline <= clock_timestamp())
          order by
            case
              when status = 'assigned' and acknowledged_at is null then 0
              when status = 'opened' then 1
              else 2
            end,
            acknowledgement_deadline, id
          for update skip locked
          limit ${command.batchSize}
        ), transitioned as (
          update human_escalations h
          set
            status = case when candidates.status = 'opened' then 'assigned' else 'escalated' end,
            version = h.version + 1,
            updated_at = clock_timestamp()
          from candidates
          where h.id = candidates.id
            and h.version = candidates.version
            and candidates.status in ('opened', 'assigned')
            and (candidates.status <> 'assigned' or h.acknowledged_at is null)
          returning h.id, h.owner_id, h.version, h.updated_at, candidates.status as prior_status
        ), audited as (
          insert into audit_events (
            actor_type, actor_id, authenticated_session_id_hash, action,
            object_type, object_id, decision, reason_code, correlation_id,
            occurred_at, metadata_hash
          )
          select
            'system', owner_id, 'worker:safety-handoff',
            'safety.handoff_sla_escalated', 'human_escalation', id,
            'escalated', 'acknowledgement_deadline_elapsed',
            'safety-handoff:' || id::text || ':' || version::text,
            updated_at,
            'sha256:' || encode(digest(convert_to(
              id::text || ':' || version::text || ':safety.handoff_sla_escalated',
              'UTF8'
            ), 'sha256'), 'hex')
          from transitioned
          where prior_status = 'assigned'
          returning id
        ), effects as (
          insert into integration_outbox (
            idempotency_key, topic, payload, correlation_id,
            reconciliation_key, payload_hash
          )
          select
            id::text || ':' || version::text || ':safety.operator_escalation',
            'safety.operator_escalation',
            jsonb_build_object('handoffId', id::text, 'version', version, 'charge', 0),
            'safety-handoff:' || id::text || ':' || version::text,
            'safety:' || id::text,
            'sha256:' || encode(digest(convert_to(
              id::text || ':' || version::text || ':safety.operator_escalation:0',
              'UTF8'
            ), 'sha256'), 'hex')
          from transitioned
          where prior_status = 'assigned'
          on conflict (idempotency_key) do nothing
          returning id
        )
        select
          (select count(*) from candidates) as examined,
          (select count(*) from transitioned where prior_status = 'assigned') as escalated,
          (select count(*) from candidates)
            - (select count(*) from transitioned where prior_status = 'assigned') as unchanged
      `);
      const row = result.rows[0];
      if (row === undefined) throw new Error("PostgreSQL safety batch returned no count");
      return {
        examined: count(row.examined),
        escalated: count(row.escalated),
        unchanged: count(row.unchanged),
      };
    });
  }

  async acknowledge(command: {
    readonly handoffId: string;
    readonly operatorId: string;
    readonly authenticatedSessionIdHash: string;
    readonly expectedVersion: number;
  }): Promise<{ readonly kind: "acknowledged"; readonly version: number } | { readonly kind: "conflict" }> {
    return this.db.transaction(async (tx) => {
      const result = await tx.execute<{ id: string; version: number; acknowledgedAt: Date }>(sql`
        update human_escalations
        set
          status = 'acknowledged',
          acknowledged_at = clock_timestamp(),
          updated_at = clock_timestamp(),
          version = version + 1
        where id = ${command.handoffId}::uuid
          and owner_id = ${command.operatorId}::uuid
          and status = 'assigned'
          and acknowledged_at is null
          and acknowledgement_deadline >= clock_timestamp()
          and version = ${command.expectedVersion}
        returning id, version, acknowledged_at as "acknowledgedAt"
      `);
      const row = result.rows[0];
      if (row === undefined) return { kind: "conflict" };
      await tx.execute(sql`
        insert into audit_events (
          actor_type, actor_id, authenticated_session_id_hash, action,
          object_type, object_id, decision, reason_code, correlation_id,
          occurred_at, metadata_hash
        ) values (
          'operator', ${command.operatorId}::uuid,
          ${command.authenticatedSessionIdHash},
          'safety.handoff_acknowledged', 'human_escalation', ${row.id}::uuid,
          'acknowledged', 'operator_acknowledged_before_deadline',
          'safety-handoff:' || ${row.id} || ':' || ${row.version}::text,
          ${row.acknowledgedAt},
          'sha256:' || encode(digest(convert_to(
            ${row.id} || ':' || ${row.version}::text || ':safety.handoff_acknowledged',
            'UTF8'
          ), 'sha256'), 'hex')
        )
      `);
      return { kind: "acknowledged", version: row.version };
    });
  }

  async deliverSafetyEscalationsBatch(batchSize: number): Promise<{ delivered: number }> {
    return this.db.transaction(async (tx) => {
      const result = await tx.execute<{ delivered: number | string }>(sql`
        with claimed as materialized (
          select id
          from integration_outbox
          where topic = 'safety.operator_escalation'
            and status in ('pending', 'retry_wait')
            and (next_attempt_at is null or next_attempt_at <= clock_timestamp())
          order by created_at, id
          for update skip locked
          limit ${batchSize}
        ), queued as (
          insert into outbox_operator_alerts (outbox_id, reason_code)
          select id, 'safety_operator_escalation'
          from claimed
          on conflict (outbox_id, reason_code) do nothing
          returning outbox_id
        ), delivered as (
          update integration_outbox o
          set status = 'succeeded', updated_at = clock_timestamp()
          from claimed
          where o.id = claimed.id
          returning o.id
        )
        select count(*) as delivered from delivered
      `);
      return { delivered: count(result.rows[0]?.delivered ?? 0) };
    });
  }

  async listLocalReservations(
    window: { readonly from: string; readonly to: string },
    batchSize: number,
  ) {
    const result = await this.db.execute<{
      id: string;
      externalId: string;
      status:
        | "reserved"
        | "booked"
        | "cancelled_by_client"
        | "cancelled_by_expert"
        | "expired"
        | "completed"
        | "no_show";
    }>(sql`
      select id::text as id, id::text as "externalId", status::text as status
      from reservations
      where updated_at >= ${window.from}::timestamptz
        and updated_at < ${window.to}::timestamptz
      order by updated_at, id
      limit ${batchSize}
    `);
    return result.rows;
  }

  async recordObservation(observation: ReconciliationObservation): Promise<void> {
    if (observation.projectionRepairs.length > 0) {
      throw new Error("Projection repair repository is not bound");
    }
    await this.db.transaction(async (tx) => {
      for (const mismatch of observation.mismatches) {
        await tx.execute(sql`
          insert into integration_errors (provider, reason_code, metadata_hash)
          values (
            'planerka',
            'reservation_state_drift',
            'sha256:' || encode(digest(convert_to(
              ${mismatch.reservationId} || ':' || ${mismatch.local} || ':' || ${mismatch.provider},
              'UTF8'
            ), 'sha256'), 'hex')
          )
        `);
      }
    });
  }

  async recordProviderUnavailable(window: {
    readonly from: string;
    readonly to: string;
  }): Promise<void> {
    await this.db.execute(sql`
      insert into integration_errors (provider, reason_code, metadata_hash)
      values (
        'planerka',
        'provider_unavailable',
        'sha256:' || encode(digest(convert_to(
          ${window.from} || ':' || ${window.to} || ':provider_unavailable',
          'UTF8'
        ), 'sha256'), 'hex')
      )
    `);
  }
}
