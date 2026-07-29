import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";

type Transaction = Parameters<DrizzleDb["transaction"]>[0] extends (
  transaction: infer T,
) => unknown
  ? T
  : never;

interface RawOutboxMessage extends Record<string, unknown> {
  id: string;
  topic: string;
  payload: unknown;
  correlationId: string;
  attempt: number;
  reconciliationKey: string;
  reconciliationAttempt: number;
}

export interface PersistedOutboxMessage {
  id: string;
  topic: string;
  payload: unknown;
  correlationId: string;
  attempt: number;
  reconciliationKey: string;
  reconciliationAttempt: number;
}

interface LockedOutboxRow extends Record<string, unknown> {
  id: string;
  status: string;
  topic: string;
  payloadHash: string;
  reconciliationKey: string;
  attempt: number;
}

export class OutboxStateConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutboxStateConflictError";
  }
}

function messages(rows: RawOutboxMessage[]): readonly PersistedOutboxMessage[] {
  return rows.map((row) => ({
    ...row,
    attempt: Number(row.attempt),
    reconciliationAttempt: Number(row.reconciliationAttempt),
  }));
}

async function lockedRow(
  tx: Transaction,
  id: string,
): Promise<LockedOutboxRow> {
  const row = (
    await tx.execute<LockedOutboxRow>(sql`
    select
      id,
      status,
      topic,
      payload_hash as "payloadHash",
      reconciliation_key as "reconciliationKey",
      attempt
    from integration_outbox
    where id = ${id}::uuid
    for update
  `)
  ).rows[0];
  if (row === undefined)
    throw new OutboxStateConflictError(`Outbox row not found: ${id}`);
  return row;
}

function requireStatus(row: LockedOutboxRow, expected: string): void {
  if (row.status !== expected) {
    throw new OutboxStateConflictError(
      `Outbox row ${row.id} must be ${expected}, received ${row.status}`,
    );
  }
}

export class PostgresOutboxRepository {
  constructor(private readonly db: DrizzleDb) {}

  async claim(
    limit: number,
    owner: string,
    leaseUntil: Date,
  ): Promise<readonly PersistedOutboxMessage[]> {
    if (!Number.isSafeInteger(limit) || limit < 1) return [];
    return this.db.transaction(async (tx) => {
      const result = await tx.execute<RawOutboxMessage>(sql`
        with claimable as (
          select id
          from integration_outbox
          where (
            status = 'pending'
            or (
              status = 'retry_wait'
              and (next_attempt_at is null or next_attempt_at <= now())
            )
          )
          order by created_at, id
          for update skip locked
          limit ${limit}
        )
        update integration_outbox o
        set
          status = 'processing',
          attempt = o.attempt + 1,
          dispatch_owner_id = ${owner},
          lease_until = ${leaseUntil},
          next_attempt_at = null,
          updated_at = now()
        from claimable
        where o.id = claimable.id
        returning
          o.id,
          o.topic,
          o.payload,
          o.correlation_id as "correlationId",
          o.attempt,
          o.reconciliation_key as "reconciliationKey",
          o.reconciliation_attempt as "reconciliationAttempt"
      `);
      return messages(result.rows);
    });
  }

  async claimUnknown(
    limit: number,
    owner: string,
    leaseUntil: Date,
  ): Promise<readonly PersistedOutboxMessage[]> {
    if (!Number.isSafeInteger(limit) || limit < 1) return [];
    return this.db.transaction(async (tx) => {
      const result = await tx.execute<RawOutboxMessage>(sql`
        with claimable as (
          select id
          from integration_outbox
          where status = 'unknown_outcome'
            and (next_reconciliation_at is null or next_reconciliation_at <= now())
          order by updated_at, id
          for update skip locked
          limit ${limit}
        )
        update integration_outbox o
        set
          status = 'reconciling',
          reconciliation_attempt = o.reconciliation_attempt + 1,
          reconciliation_owner_id = ${owner},
          reconciliation_lease_until = ${leaseUntil},
          next_reconciliation_at = null,
          updated_at = now()
        from claimable
        where o.id = claimable.id
        returning
          o.id,
          o.topic,
          o.payload,
          o.correlation_id as "correlationId",
          o.attempt,
          o.reconciliation_key as "reconciliationKey",
          o.reconciliation_attempt as "reconciliationAttempt"
      `);
      return messages(result.rows);
    });
  }

  async recordAttemptStarted(
    id: string,
    attemptId: string,
    reconciliationKey: string,
    startedAt: Date,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const row = await lockedRow(tx, id);
      requireStatus(row, "processing");
      if (row.reconciliationKey !== reconciliationKey) {
        throw new OutboxStateConflictError(
          "Outbox reconciliation key mismatch",
        );
      }
      await tx.execute(sql`
        insert into delivery_attempts (
          outbox_id,
          attempt_id,
          attempt,
          provider,
          outcome,
          reconciliation_key,
          created_at
        ) values (
          ${id}::uuid,
          ${attemptId},
          ${row.attempt},
          split_part(${row.topic}, '.', 1),
          'started',
          ${reconciliationKey},
          ${startedAt}
        )
      `);
    });
  }

  async markUnknownOutcome(
    id: string,
    attemptId: string,
    reconciliationKey: string,
    reasonCode: string,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const row = await lockedRow(tx, id);
      requireStatus(row, "processing");
      if (row.reconciliationKey !== reconciliationKey) {
        throw new OutboxStateConflictError(
          "Outbox reconciliation key mismatch",
        );
      }
      const started =
        (
          await tx.execute<{ exists: boolean }>(sql`
        select exists(
          select 1
          from delivery_attempts
          where outbox_id = ${id}::uuid
            and attempt_id = ${attemptId}
            and outcome = 'started'
            and reconciliation_key = ${reconciliationKey}
        ) as exists
      `)
        ).rows[0]?.exists ?? false;
      if (!started) {
        throw new OutboxStateConflictError(
          "Outbox attempt was not recorded as started",
        );
      }
      await tx.execute(sql`
        update integration_outbox
        set
          status = 'unknown_outcome',
          dispatch_owner_id = null,
          lease_until = null,
          next_reconciliation_at = now(),
          last_normalized_reason = ${reasonCode},
          updated_at = now()
        where id = ${id}::uuid
      `);
      await tx.execute(sql`
        insert into delivery_attempts (
          outbox_id, attempt_id, attempt, provider, outcome,
          reconciliation_key, normalized_reason
        ) values (
          ${id}::uuid, ${attemptId}, ${row.attempt}, split_part(${row.topic}, '.', 1),
          'unknown_outcome', ${reconciliationKey}, ${reasonCode}
        )
      `);
    });
  }

  async markStillUnknown(
    id: string,
    owner: string,
    reasonCode: string,
    nextCheckAt: Date,
  ): Promise<void> {
    const result = await this.db.execute<{ id: string }>(sql`
      update integration_outbox
      set
        status = 'unknown_outcome',
        reconciliation_owner_id = null,
        reconciliation_lease_until = null,
        next_reconciliation_at = ${nextCheckAt},
        last_normalized_reason = ${reasonCode},
        updated_at = now()
      where id = ${id}::uuid
        and status = 'reconciling'
        and reconciliation_owner_id = ${owner}
      returning id
    `);
    if (result.rows.length !== 1) {
      throw new OutboxStateConflictError(
        "Outbox reconciliation lease ownership mismatch",
      );
    }
  }

  async succeed(id: string): Promise<void> {
    const result = await this.db.execute<{ id: string }>(sql`
      update integration_outbox
      set
        status = 'succeeded',
        dispatch_owner_id = null,
        lease_until = null,
        reconciliation_owner_id = null,
        reconciliation_lease_until = null,
        next_attempt_at = null,
        next_reconciliation_at = null,
        last_normalized_reason = null,
        updated_at = now()
      where id = ${id}::uuid and status in ('processing', 'reconciling')
      returning id
    `);
    if (result.rows.length !== 1) {
      throw new OutboxStateConflictError(
        "Outbox row cannot transition to succeeded",
      );
    }
  }

  async retry(
    id: string,
    nextAttemptAt: Date,
    reasonCode: string,
  ): Promise<void> {
    const result = await this.db.execute<{ id: string }>(sql`
      update integration_outbox
      set
        status = 'retry_wait',
        dispatch_owner_id = null,
        lease_until = null,
        reconciliation_owner_id = null,
        reconciliation_lease_until = null,
        next_attempt_at = ${nextAttemptAt},
        next_reconciliation_at = null,
        last_normalized_reason = ${reasonCode},
        updated_at = now()
      where id = ${id}::uuid and status in ('processing', 'reconciling')
      returning id
    `);
    if (result.rows.length !== 1) {
      throw new OutboxStateConflictError(
        "Outbox row cannot transition to retry_wait",
      );
    }
  }

  async deadLetterAndAlert(id: string, reasonCode: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const row = await lockedRow(tx, id);
      if (row.status === "succeeded") {
        throw new OutboxStateConflictError(
          "Succeeded outbox row cannot be dead-lettered",
        );
      }
      if (row.status !== "dead_letter") {
        await tx.execute(sql`
          update integration_outbox
          set
            status = 'dead_letter',
            dispatch_owner_id = null,
            lease_until = null,
            reconciliation_owner_id = null,
            reconciliation_lease_until = null,
            next_attempt_at = null,
            next_reconciliation_at = null,
            last_normalized_reason = ${reasonCode},
            updated_at = now()
          where id = ${id}::uuid
        `);
      }
      await tx.execute(sql`
        insert into dead_letters (outbox_id, reason, payload_hash)
        values (${id}::uuid, ${reasonCode}, ${row.payloadHash})
        on conflict (outbox_id) do nothing
      `);
      await tx.execute(sql`
        insert into outbox_operator_alerts (outbox_id, reason_code)
        values (${id}::uuid, ${reasonCode})
        on conflict (outbox_id, reason_code) do nothing
      `);
    });
  }

  async recoverExpiredDispatchLeases(now: Date): Promise<number> {
    return this.db.transaction(async (tx) => {
      const result = await tx.execute<{ id: string }>(sql`
        with recovered as (
          update integration_outbox
          set
            status = 'unknown_outcome',
            dispatch_owner_id = null,
            lease_until = null,
            next_reconciliation_at = ${now},
            last_normalized_reason = 'dispatch_lease_expired_unknown_outcome',
            updated_at = now()
          where status = 'processing' and lease_until < ${now}
          returning id, topic, attempt, reconciliation_key
        )
        insert into delivery_attempts (
          outbox_id, attempt_id, attempt, provider, outcome,
          reconciliation_key, normalized_reason
        )
        select
          id,
          'dispatch-lease-recovery:' || attempt::text,
          attempt,
          split_part(topic, '.', 1),
          'unknown_outcome',
          reconciliation_key,
          'dispatch_lease_expired_unknown_outcome'
        from recovered
        returning outbox_id as id
      `);
      return result.rows.length;
    });
  }

  async recoverExpiredReconciliationLeases(now: Date): Promise<number> {
    return this.db.transaction(async (tx) => {
      const result = await tx.execute<{ id: string }>(sql`
        with recovered as (
          update integration_outbox
          set
            status = 'unknown_outcome',
            reconciliation_owner_id = null,
            reconciliation_lease_until = null,
            next_reconciliation_at = ${now},
            last_normalized_reason = 'reconciliation_lease_expired',
            updated_at = now()
          where status = 'reconciling' and reconciliation_lease_until < ${now}
          returning id, topic, attempt, reconciliation_attempt, reconciliation_key
        )
        insert into delivery_attempts (
          outbox_id, attempt_id, attempt, provider, outcome,
          reconciliation_key, normalized_reason
        )
        select
          id,
          'reconciliation-lease-recovery:' || reconciliation_attempt::text,
          attempt,
          split_part(topic, '.', 1),
          'reconciliation_lease_expired',
          reconciliation_key,
          'reconciliation_lease_expired'
        from recovered
        returning outbox_id as id
      `);
      return result.rows.length;
    });
  }
}
