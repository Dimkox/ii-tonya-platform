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
  dispatchClaimToken: string | null;
  reconciliationClaimToken: string | null;
}

export interface PersistedOutboxMessage {
  id: string;
  topic: string;
  payload: unknown;
  correlationId: string;
  attempt: number;
  reconciliationKey: string;
  reconciliationAttempt: number;
  dispatchClaimToken: string | null;
  reconciliationClaimToken: string | null;
}

interface LockedOutboxRow extends Record<string, unknown> {
  id: string;
  status: string;
  topic: string;
  payloadHash: string;
  reconciliationKey: string;
  attempt: number;
  dispatchOwnerId: string | null;
  dispatchClaimToken: string | null;
  leaseUntil: Date | string | null;
  reconciliationOwnerId: string | null;
  reconciliationClaimToken: string | null;
  reconciliationLeaseUntil: Date | string | null;
  dispatchLeaseValid: boolean;
  reconciliationLeaseValid: boolean;
}

export class OutboxStateConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutboxStateConflictError";
  }
}

export class OutboxLeaseLostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutboxLeaseLostError";
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
      attempt,
      dispatch_owner_id as "dispatchOwnerId",
      dispatch_claim_token as "dispatchClaimToken",
      lease_until as "leaseUntil",
      reconciliation_owner_id as "reconciliationOwnerId",
      reconciliation_claim_token as "reconciliationClaimToken",
      reconciliation_lease_until as "reconciliationLeaseUntil",
      (
        lease_until is not null
        and lease_until >= clock_timestamp()
      ) as "dispatchLeaseValid",
      (
        reconciliation_lease_until is not null
        and reconciliation_lease_until >= clock_timestamp()
      ) as "reconciliationLeaseValid"
    from integration_outbox
    where id = ${id}::uuid
    for update
  `)
  ).rows[0];
  if (row === undefined)
    throw new OutboxStateConflictError(`Outbox row not found: ${id}`);
  return row;
}

function requireDispatchLease(
  row: LockedOutboxRow,
  owner: string,
  claimToken: string,
): void {
  if (
    row.status !== "processing" ||
    row.dispatchOwnerId !== owner ||
    row.dispatchClaimToken !== claimToken ||
    !row.dispatchLeaseValid ||
    row.leaseUntil === null
  ) {
    throw new OutboxLeaseLostError(`Dispatch lease lost for outbox row ${row.id}`);
  }
}

function requireReconciliationLease(
  row: LockedOutboxRow,
  owner: string,
  claimToken: string,
): void {
  if (
    row.status !== "reconciling" ||
    row.reconciliationOwnerId !== owner ||
    row.reconciliationClaimToken !== claimToken ||
    !row.reconciliationLeaseValid ||
    row.reconciliationLeaseUntil === null
  ) {
    throw new OutboxLeaseLostError(
      `Reconciliation lease lost for outbox row ${row.id}`,
    );
  }
}

async function terminalizeDispatchExhausted(
  tx: Transaction,
  maxAttempts: number,
): Promise<void> {
  await tx.execute(sql`
    with exhausted as (
      update integration_outbox
      set
        status = 'dead_letter',
        next_attempt_at = null,
        last_normalized_reason = 'dispatch_attempts_exhausted_before_claim',
        updated_at = now()
      where status in ('pending', 'retry_wait') and attempt >= ${maxAttempts}
      returning id, payload_hash
    ),
    dead as (
      insert into dead_letters (outbox_id, reason, payload_hash)
      select id, 'dispatch_attempts_exhausted_before_claim', payload_hash
      from exhausted
      on conflict (outbox_id) do nothing
    )
    insert into outbox_operator_alerts (outbox_id, reason_code)
    select id, 'dispatch_attempts_exhausted_before_claim'
    from exhausted
    on conflict (outbox_id, reason_code) do nothing
  `);
}

async function terminalizeReconciliationExhausted(
  tx: Transaction,
  maxAttempts: number,
): Promise<void> {
  await tx.execute(sql`
    with exhausted as (
      update integration_outbox
      set
        status = 'dead_letter',
        next_reconciliation_at = null,
        last_normalized_reason =
          'unknown_outcome_reconciliation_exhausted_before_claim',
        updated_at = now()
      where status = 'unknown_outcome'
        and reconciliation_attempt >= ${maxAttempts}
      returning id, payload_hash
    ),
    dead as (
      insert into dead_letters (outbox_id, reason, payload_hash)
      select
        id,
        'unknown_outcome_reconciliation_exhausted_before_claim',
        payload_hash
      from exhausted
      on conflict (outbox_id) do nothing
    )
    insert into outbox_operator_alerts (outbox_id, reason_code)
    select
      id,
      'unknown_outcome_reconciliation_exhausted_before_claim'
    from exhausted
    on conflict (outbox_id, reason_code) do nothing
  `);
}

async function writeDeadLetterAndAlert(
  tx: Transaction,
  row: LockedOutboxRow,
  reasonCode: string,
): Promise<void> {
  await tx.execute(sql`
    update integration_outbox
    set
      status = 'dead_letter',
      dispatch_owner_id = null,
      dispatch_claim_token = null,
      lease_until = null,
      reconciliation_owner_id = null,
      reconciliation_claim_token = null,
      reconciliation_lease_until = null,
      next_attempt_at = null,
      next_reconciliation_at = null,
      last_normalized_reason = ${reasonCode},
      updated_at = now()
    where id = ${row.id}::uuid
  `);
  await tx.execute(sql`
    insert into dead_letters (outbox_id, reason, payload_hash)
    values (${row.id}::uuid, ${reasonCode}, ${row.payloadHash})
    on conflict (outbox_id) do nothing
  `);
  await tx.execute(sql`
    insert into outbox_operator_alerts (outbox_id, reason_code)
    values (${row.id}::uuid, ${reasonCode})
    on conflict (outbox_id, reason_code) do nothing
  `);
}

export class PostgresOutboxRepository {
  constructor(private readonly db: DrizzleDb) {}

  async claim(
    limit: number,
    owner: string,
    leaseDurationMs: number,
    maxAttempts: number,
  ): Promise<readonly PersistedOutboxMessage[]> {
    if (!Number.isSafeInteger(limit) || limit < 1) return [];
    if (!Number.isSafeInteger(leaseDurationMs) || leaseDurationMs < 1) {
      throw new RangeError("leaseDurationMs must be a positive integer");
    }
    return this.db.transaction(async (tx) => {
      await terminalizeDispatchExhausted(tx, maxAttempts);
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
            and attempt < ${maxAttempts}
          order by created_at, id
          for update skip locked
          limit ${limit}
        )
        update integration_outbox o
        set
          status = 'processing',
          attempt = o.attempt + 1,
          dispatch_owner_id = ${owner},
          dispatch_claim_token = gen_random_uuid()::text,
          reconciliation_claim_token = null,
          lease_until =
            clock_timestamp() + (${leaseDurationMs} * interval '1 millisecond'),
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
          o.reconciliation_attempt as "reconciliationAttempt",
          o.dispatch_claim_token as "dispatchClaimToken",
          o.reconciliation_claim_token as "reconciliationClaimToken"
      `);
      return messages(result.rows);
    });
  }

  async claimUnknown(
    limit: number,
    owner: string,
    leaseDurationMs: number,
    maxReconciliationAttempts: number,
  ): Promise<readonly PersistedOutboxMessage[]> {
    if (!Number.isSafeInteger(limit) || limit < 1) return [];
    if (!Number.isSafeInteger(leaseDurationMs) || leaseDurationMs < 1) {
      throw new RangeError("leaseDurationMs must be a positive integer");
    }
    return this.db.transaction(async (tx) => {
      await terminalizeReconciliationExhausted(
        tx,
        maxReconciliationAttempts,
      );
      const result = await tx.execute<RawOutboxMessage>(sql`
        with claimable as (
          select id
          from integration_outbox
          where status = 'unknown_outcome'
            and reconciliation_attempt < ${maxReconciliationAttempts}
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
          reconciliation_claim_token = gen_random_uuid()::text,
          dispatch_claim_token = null,
          reconciliation_lease_until =
            clock_timestamp() + (${leaseDurationMs} * interval '1 millisecond'),
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
          o.reconciliation_attempt as "reconciliationAttempt",
          o.dispatch_claim_token as "dispatchClaimToken",
          o.reconciliation_claim_token as "reconciliationClaimToken"
      `);
      return messages(result.rows);
    });
  }

  async recordAttemptStarted(
    id: string,
    owner: string,
    claimToken: string,
    attemptId: string,
    reconciliationKey: string,
    startedAt: Date,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const row = await lockedRow(tx, id);
      requireDispatchLease(row, owner, claimToken);
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
    owner: string,
    claimToken: string,
    attemptId: string,
    reconciliationKey: string,
    reasonCode: string,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const row = await lockedRow(tx, id);
      requireDispatchLease(row, owner, claimToken);
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
          dispatch_claim_token = null,
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
    claimToken: string,
    reasonCode: string,
    nextCheckAt: Date,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const row = await lockedRow(tx, id);
      requireReconciliationLease(row, owner, claimToken);
      await tx.execute(sql`
        update integration_outbox
        set
          status = 'unknown_outcome',
          reconciliation_owner_id = null,
          reconciliation_claim_token = null,
          reconciliation_lease_until = null,
          next_reconciliation_at = ${nextCheckAt},
          last_normalized_reason = ${reasonCode},
          updated_at = now()
        where id = ${id}::uuid
      `);
    });
  }

  async succeed(id: string, owner: string, claimToken: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const row = await lockedRow(tx, id);
      requireDispatchLease(row, owner, claimToken);
      await this.transitionSucceeded(tx, id);
    });
  }

  async retry(
    id: string,
    owner: string,
    claimToken: string,
    nextAttemptAt: Date,
    reasonCode: string,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const row = await lockedRow(tx, id);
      requireDispatchLease(row, owner, claimToken);
      await this.transitionRetry(tx, id, nextAttemptAt, reasonCode);
    });
  }

  async deadLetterAndAlert(
    id: string,
    owner: string,
    claimToken: string,
    reasonCode: string,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const row = await lockedRow(tx, id);
      requireDispatchLease(row, owner, claimToken);
      await writeDeadLetterAndAlert(tx, row, reasonCode);
    });
  }

  async succeedAfterReconciliation(
    id: string,
    owner: string,
    claimToken: string,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const row = await lockedRow(tx, id);
      requireReconciliationLease(row, owner, claimToken);
      await this.transitionSucceeded(tx, id);
    });
  }

  async retryAfterReconciliation(
    id: string,
    owner: string,
    claimToken: string,
    nextAttemptAt: Date,
    reasonCode: string,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const row = await lockedRow(tx, id);
      requireReconciliationLease(row, owner, claimToken);
      await this.transitionRetry(tx, id, nextAttemptAt, reasonCode);
    });
  }

  async deadLetterAfterReconciliationAndAlert(
    id: string,
    owner: string,
    claimToken: string,
    reasonCode: string,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const row = await lockedRow(tx, id);
      requireReconciliationLease(row, owner, claimToken);
      await writeDeadLetterAndAlert(tx, row, reasonCode);
    });
  }

  private async transitionSucceeded(
    tx: Transaction,
    id: string,
  ): Promise<void> {
    await tx.execute(sql`
      update integration_outbox
      set
        status = 'succeeded',
        dispatch_owner_id = null,
        dispatch_claim_token = null,
        lease_until = null,
        reconciliation_owner_id = null,
        reconciliation_claim_token = null,
        reconciliation_lease_until = null,
        next_attempt_at = null,
        next_reconciliation_at = null,
        last_normalized_reason = null,
        updated_at = now()
      where id = ${id}::uuid
    `);
  }

  private async transitionRetry(
    tx: Transaction,
    id: string,
    nextAttemptAt: Date,
    reasonCode: string,
  ): Promise<void> {
    await tx.execute(sql`
      update integration_outbox
      set
        status = 'retry_wait',
        dispatch_owner_id = null,
        dispatch_claim_token = null,
        lease_until = null,
        reconciliation_owner_id = null,
        reconciliation_claim_token = null,
        reconciliation_lease_until = null,
        next_attempt_at = ${nextAttemptAt},
        next_reconciliation_at = null,
        last_normalized_reason = ${reasonCode},
        updated_at = now()
      where id = ${id}::uuid
    `);
  }

  async recoverExpiredDispatchLeases(limit = 1_000): Promise<number> {
    return this.db.transaction(async (tx) => {
      const result = await tx.execute<{ id: string }>(sql`
        with candidates as materialized (
          select id
          from integration_outbox
          where status = 'processing'
            and lease_until < clock_timestamp()
          order by lease_until, id
          for update skip locked
          limit ${limit}
        ), recovered as (
          update integration_outbox o
          set
            status = 'unknown_outcome',
            dispatch_owner_id = null,
            dispatch_claim_token = null,
            lease_until = null,
            next_reconciliation_at = clock_timestamp(),
            last_normalized_reason = 'dispatch_lease_expired_unknown_outcome',
            updated_at = now()
          from candidates
          where o.id = candidates.id
          returning o.id, o.topic, o.attempt, o.reconciliation_key
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

  async recoverExpiredReconciliationLeases(limit = 1_000): Promise<number> {
    return this.db.transaction(async (tx) => {
      const result = await tx.execute<{ id: string }>(sql`
        with candidates as materialized (
          select id
          from integration_outbox
          where status = 'reconciling'
            and reconciliation_lease_until < clock_timestamp()
          order by reconciliation_lease_until, id
          for update skip locked
          limit ${limit}
        ), recovered as (
          update integration_outbox o
          set
            status = 'unknown_outcome',
            reconciliation_owner_id = null,
            reconciliation_claim_token = null,
            reconciliation_lease_until = null,
            next_reconciliation_at = clock_timestamp(),
            last_normalized_reason = 'reconciliation_lease_expired',
            updated_at = now()
          from candidates
          where o.id = candidates.id
          returning o.id, o.topic, o.attempt, o.reconciliation_attempt, o.reconciliation_key
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
