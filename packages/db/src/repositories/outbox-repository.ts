import { sql, type SQL } from "drizzle-orm";
import {
  CLIENT_ASYNC_OUTBOX_TOPICS,
  clientDispatchPayloadDigest,
  clientConsentAuthoritySchema,
  isClientAsyncTopic,
  type ClientAsyncTopic,
  type DispatchStartResult,
  CLIENT_CATALOG_OUTBOX_TOPICS,
  LOCAL_OPERATOR_CASE_OUTBOX_TOPICS,
  type ClientCatalogOutboxTopic,
} from "@ii-tonya/contracts";
import type { DrizzleDb } from "../client.js";
import {
  lockClientConsentSubject,
  validateClientConsentAuthority,
} from "./client-consent-authority.js";

const MAX_OUTBOX_RECOVERY_LIMIT = 1_000;
type WorkerOutboxTopics =
  | typeof LOCAL_OPERATOR_CASE_OUTBOX_TOPICS
  | typeof CLIENT_CATALOG_OUTBOX_TOPICS
  | readonly ["telegram.send_text.v1"]
  | typeof CLIENT_ASYNC_OUTBOX_TOPICS;
export interface OutboxRecoveryCount {
  readonly topic: ClientCatalogOutboxTopic | ClientAsyncTopic;
  readonly count: number;
}

function validateTopicAllowlist(
  topics: readonly string[] | undefined,
): WorkerOutboxTopics | undefined {
  if (topics === undefined) return undefined;
  const local =
    topics.length === LOCAL_OPERATOR_CASE_OUTBOX_TOPICS.length &&
    topics.every(
      (topic, index) => topic === LOCAL_OPERATOR_CASE_OUTBOX_TOPICS[index],
    );
  const clientCatalog =
    topics.length === CLIENT_CATALOG_OUTBOX_TOPICS.length &&
    topics.every(
      (topic, index) => topic === CLIENT_CATALOG_OUTBOX_TOPICS[index],
    );
  const telegram = topics.length === 1 && topics[0] === "telegram.send_text.v1";
  const clientAsync =
    topics.length === CLIENT_ASYNC_OUTBOX_TOPICS.length &&
    topics.every((topic, index) => topic === CLIENT_ASYNC_OUTBOX_TOPICS[index]);
  if (!local && !clientCatalog && !telegram && !clientAsync) {
    throw new Error("worker_outbox_topic_allowlist_invalid");
  }
  return clientAsync
    ? CLIENT_ASYNC_OUTBOX_TOPICS
    : telegram
      ? (["telegram.send_text.v1"] as const)
      : clientCatalog
        ? CLIENT_CATALOG_OUTBOX_TOPICS
        : LOCAL_OPERATOR_CASE_OUTBOX_TOPICS;
}

function topicPredicate(topics: WorkerOutboxTopics | undefined) {
  if (topics === undefined) return sql``;
  if (topics.length === 1) return sql` and topic = 'telegram.send_text.v1'`;
  return topics.length === CLIENT_CATALOG_OUTBOX_TOPICS.length
    ? sql` and topic in (${topics[0]}, ${topics[1]}, ${topics[2]})`
    : sql` and topic in (${topics[0]}, ${topics[1]})`;
}

function botPredicate(botKey: string | undefined) {
  return botKey === undefined
    ? sql``
    : sql` and exists (
    select 1 from dialogues scoped_dialogue where scoped_dialogue.bot_key=${botKey}
      and scoped_dialogue.id::text=coalesce(integration_outbox.dialogue_id::text,integration_outbox.payload->>'dialogueId',
        (select p.dialogue_id::text from selarti_response_proposals p where p.request_id=integration_outbox.idempotency_key),
        (select r.dialogue_id::text from selarti_cost_reservations r where r.request_id=integration_outbox.idempotency_key))
  )`;
}

function unresolvedStartPredicate() {
  return sql`exists(select 1 from delivery_attempts started where started.outbox_id=integration_outbox.id and started.outcome='started'
    and not exists(select 1 from delivery_attempts resolved where resolved.outbox_id=started.outbox_id
      and resolved.attempt=started.attempt and resolved.reconciliation_key=started.reconciliation_key and resolved.outcome='not_applied'))`;
}

function unstartedClientClaimPredicate() {
  // Only undo a claim-only increment. Immutable current/prior effect evidence always wins.
  return sql`topic in ('telegram.send_text.v1','selarti.request.v1') and status='processing' and attempt>0
    and not exists(select 1 from delivery_attempts a where a.outbox_id=integration_outbox.id and a.attempt=integration_outbox.attempt)
    and not ${unresolvedStartPredicate()}`;
}

function isLockBusy(error: unknown): boolean {
  const code =
    (error as { code?: string; cause?: { code?: string } })?.cause?.code ??
    (error as { code?: string })?.code;
  return code === "55P03";
}

function excludingBusyIds(ids: readonly string[]): SQL {
  return ids.length === 0
    ? sql``
    : sql` and id not in (${sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`,`,
      )})`;
}

function orderedDialoguePredicate(
  topics: WorkerOutboxTopics | undefined,
  alias = sql`integration_outbox`,
) {
  return sql` and (${alias}.topic <> 'telegram.send_text.v1' or not exists (
    select 1 from integration_outbox earlier
    where earlier.dialogue_id = ${alias}.dialogue_id
      and earlier.dialogue_sequence < ${alias}.dialogue_sequence
      and earlier.status not in ('succeeded','dead_letter')
  ))`;
}

function recoveryCounts(
  topics: WorkerOutboxTopics | undefined,
  rows: readonly { topic: string }[],
): readonly OutboxRecoveryCount[] {
  if (topics === undefined) {
    throw new Error("worker_outbox_topic_allowlist_required");
  }
  return topics
    .map((topic) => ({
      topic,
      count: rows.filter((row) => row.topic === topic).length,
    }))
    .filter((entry) => entry.count > 0);
}

function recoveryCountAggregates(
  topics: WorkerOutboxTopics,
  rows: readonly { topic: string; count: number | string }[],
): readonly OutboxRecoveryCount[] {
  return topics.flatMap((topic) => {
    const raw = rows.find((row) => row.topic === topic)?.count ?? 0;
    const count = Number(raw);
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error("worker_outbox_recovery_count_invalid");
    }
    return count === 0 ? [] : [{ topic, count }];
  });
}

function requireRecoveryTopics(
  topics: WorkerOutboxTopics | undefined,
): WorkerOutboxTopics {
  if (topics === undefined) {
    throw new Error("worker_outbox_topic_allowlist_required");
  }
  return topics;
}

function assertRecoveryLimit(limit: number): void {
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_OUTBOX_RECOVERY_LIMIT
  ) {
    throw new RangeError("limit must be a safe integer between 1 and 1000");
  }
}

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
  payload: unknown;
  dialogueId: string | null;
  dialogueSequence: string | null;
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
      payload,
      dialogue_id::text as "dialogueId",
      dialogue_sequence::text as "dialogueSequence",
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
    throw new OutboxLeaseLostError(
      `Dispatch lease lost for outbox row ${row.id}`,
    );
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
  topics: WorkerOutboxTopics | undefined,
  botKey?: string,
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
        ${topicPredicate(topics)}
        ${botPredicate(botKey)}
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
  topics: WorkerOutboxTopics | undefined,
  botKey?: string,
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
        ${topicPredicate(topics)}
        ${botPredicate(botKey)}
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

async function terminalizeDispatchExhaustedByTopic(
  tx: Transaction,
  maxAttempts: number,
  topics: WorkerOutboxTopics,
  limit: number,
  botKey?: string,
): Promise<readonly OutboxRecoveryCount[]> {
  const result = await tx.execute<{
    topic: string;
    count: number | string;
  }>(sql`
    with candidates as (
      select id from integration_outbox
      where status in ('pending','retry_wait') and attempt >= ${maxAttempts}
        ${topicPredicate(topics)}
        ${botPredicate(botKey)}
      order by created_at,id
      for update skip locked
      limit ${limit}
    ), exhausted as (
      update integration_outbox o
      set status='dead_letter',next_attempt_at=null,
        last_normalized_reason='dispatch_attempts_exhausted_before_claim',
        updated_at=now()
      from candidates where o.id=candidates.id
      returning o.id,o.payload_hash,o.topic
    ), dead as (
      insert into dead_letters (outbox_id,reason,payload_hash)
      select id,'dispatch_attempts_exhausted_before_claim',payload_hash
      from exhausted on conflict (outbox_id) do nothing
    ), alerts as (
      insert into outbox_operator_alerts (outbox_id,reason_code)
      select id,'dispatch_attempts_exhausted_before_claim' from exhausted
      on conflict (outbox_id,reason_code) do nothing
    )
    select topic,count(*)::integer as count from exhausted group by topic
  `);
  return recoveryCountAggregates(topics, result.rows);
}

async function terminalizeReconciliationExhaustedByTopic(
  tx: Transaction,
  maxAttempts: number,
  topics: WorkerOutboxTopics,
  limit: number,
  botKey?: string,
): Promise<readonly OutboxRecoveryCount[]> {
  const result = await tx.execute<{
    topic: string;
    count: number | string;
  }>(sql`
    with candidates as (
      select id from integration_outbox
      where status='unknown_outcome'
        and reconciliation_attempt >= ${maxAttempts}
        ${topicPredicate(topics)}
        ${botPredicate(botKey)}
      order by updated_at,id
      for update skip locked
      limit ${limit}
    ), exhausted as (
      update integration_outbox o
      set status='dead_letter',next_reconciliation_at=null,
        last_normalized_reason=
          'unknown_outcome_reconciliation_exhausted_before_claim',
        updated_at=now()
      from candidates where o.id=candidates.id
      returning o.id,o.payload_hash,o.topic
    ), dead as (
      insert into dead_letters (outbox_id,reason,payload_hash)
      select id,'unknown_outcome_reconciliation_exhausted_before_claim',
        payload_hash from exhausted
      on conflict (outbox_id) do nothing
    ), alerts as (
      insert into outbox_operator_alerts (outbox_id,reason_code)
      select id,'unknown_outcome_reconciliation_exhausted_before_claim'
      from exhausted on conflict (outbox_id,reason_code) do nothing
    )
    select topic,count(*)::integer as count from exhausted group by topic
  `);
  return recoveryCountAggregates(topics, result.rows);
}

async function writeDeadLetterAndAlert(
  tx: Transaction,
  row: LockedOutboxRow,
  reasonCode: string,
): Promise<void> {
  if (reasonCode === "client_authority_invalid") {
    await tx.execute(sql`insert into delivery_attempts(outbox_id,attempt_id,attempt,provider,outcome,reconciliation_key,normalized_reason)
      values(${row.id}::uuid,${"authority-blocked:" + row.attempt},${row.attempt},split_part(${row.topic},'.',1),'not_applied',${row.reconciliationKey},'client_authority_invalid')`);
  }
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
  private readonly topics: WorkerOutboxTopics | undefined;

  constructor(
    private readonly db: DrizzleDb,
    topics?: readonly string[],
    private readonly botKey?: string,
  ) {
    this.topics = validateTopicAllowlist(topics);
  }

  /** Optional additional selection only; original client authority is always mandatory at start. */
  protected egressGatePredicate(): SQL {
    return sql``;
  }

  private async lockSubjectForOutbox(tx: Transaction, id: string) {
    // Resolve without source locks; all authoritative reads happen after this wait.
    const subject = (
      await tx.execute<{ userId: string }>(sql`
      select d.user_id::text as "userId" from integration_outbox o
      join dialogues d on d.id::text=o.payload->>'dialogueId'
      where o.id=${id}::uuid and o.topic in ('telegram.send_text.v1','selarti.request.v1')
    `)
    ).rows[0];
    if (subject) await lockClientConsentSubject(tx, subject.userId);
    return subject?.userId;
  }

  private async validClientSource(
    tx: Transaction,
    row: LockedOutboxRow,
    lockedSubject: string | undefined,
  ) {
    if (
      !lockedSubject ||
      !row.payload ||
      typeof row.payload !== "object" ||
      Array.isArray(row.payload)
    )
      return false;
    const payload = row.payload as Record<string, unknown>;
    if (
      typeof payload.text !== "string" ||
      payload.text.length < 1 ||
      payload.text.length > 4096 ||
      /[\u0000-\u001F\u007F-\u009F]/u.test(payload.text)
    )
      return false;
    const dialogue = (
      await tx.execute<{ userId: string; botKey: string; chatId: string }>(sql`
      select user_id::text as "userId",bot_key as "botKey",external_chat_id as "chatId" from dialogues
      where id::text=${typeof payload.dialogueId === "string" ? payload.dialogueId : ""} for share
    `)
    ).rows[0];
    if (dialogue?.userId !== lockedSubject) return false;
    let requireSelarti = row.topic === "selarti.request.v1";
    if (row.topic === "telegram.send_text.v1") {
      if (
        payload.dialogueId !== row.dialogueId ||
        String(payload.sequence) !== row.dialogueSequence ||
        payload.botKey !== dialogue.botKey ||
        payload.chatId !== dialogue.chatId
      )
        return false;
      const delivery = (
        await tx.execute<{
          source: string;
          original: unknown;
          retained: unknown;
        }>(sql`
        select delivery.source,request.payload->'consentAuthority' as original,request.payload as retained from dialogue_deliveries delivery
        left join selarti_response_proposals proposal on proposal.id::text=delivery.source_id and delivery.source='selarti'
        left join integration_outbox request on request.idempotency_key=proposal.request_id and request.topic='selarti.request.v1'
        where delivery.outbox_id=${row.id}::uuid and delivery.id::text=${typeof payload.deliveryId === "string" ? payload.deliveryId : ""}
          and delivery.dialogue_id=${row.dialogueId}::uuid and delivery.payload_hash=${row.payloadHash}
      `)
      ).rows[0];
      if (!delivery) return false;
      requireSelarti = delivery.source === "selarti";
      if (requireSelarti) {
        const derived = clientConsentAuthoritySchema.safeParse(
          payload.consentAuthority,
        );
        const original = clientConsentAuthoritySchema.safeParse(
          delivery.original,
        );
        if (!derived.success || !derived.data.purposes.selarti_ai_processing)
          return false;
        const retained = delivery.retained as Record<string, unknown> | null;
        const digest =
          original.success && original.data.purposes.selarti_ai_processing
            ? clientDispatchPayloadDigest(original.data)
            : retained?.redacted === true &&
                Object.keys(retained).sort().join("|") ===
                  "consentAuthorityDigest|redacted" &&
                typeof retained.consentAuthorityDigest === "string" &&
                /^[0-9a-f]{64}$/u.test(retained.consentAuthorityDigest)
              ? retained.consentAuthorityDigest
              : undefined;
        if (
          digest === undefined ||
          digest !== clientDispatchPayloadDigest(derived.data)
        )
          return false;
      }
    } else {
      if (
        payload.userId !== lockedSubject ||
        payload.requestId !== row.reconciliationKey ||
        typeof payload.deadline !== "string"
      )
        return false;
      const deadline = new Date(payload.deadline);
      const clock = (
        await tx.execute<{ now: Date | string }>(
          sql`select clock_timestamp() as now`,
        )
      ).rows[0]!;
      if (
        !Number.isFinite(deadline.getTime()) ||
        deadline <= new Date(clock.now)
      )
        return false;
    }
    const authority = await validateClientConsentAuthority(
      tx,
      payload.consentAuthority,
      payload.dialogueId,
      requireSelarti,
    );
    if (authority?.subjectId !== lockedSubject) return false;
    if (row.topic === "selarti.request.v1") {
      const clock = (
        await tx.execute<{ valid: boolean }>(
          sql`select ${payload.deadline as string}::timestamptz > clock_timestamp() as valid`,
        )
      ).rows[0]!;
      return clock.valid;
    }
    return true;
  }

  /** Bounded cleanup only of work with no durable start, never of uncertain effects. */
  private async fenceUnstarted(limit: number) {
    const invalid: { topic: string }[] = [];
    const busyIds: string[] = [];
    const candidates = (
      await this.db.execute<{ id: string }>(sql`
      select id from integration_outbox where topic in ('telegram.send_text.v1','selarti.request.v1')
        ${topicPredicate(this.topics)} and status in ('pending','retry_wait')
        ${botPredicate(this.botKey)}
        and not ${unresolvedStartPredicate()}
      order by created_at,id limit ${Math.min(limit, MAX_OUTBOX_RECOVERY_LIMIT)}
    `)
    ).rows;
    for (const candidate of candidates) {
      try {
        const topic = await this.db.transaction(async (tx) => {
          // Bounds every document/subject/source/authority lock in this candidate only.
          await tx.execute(sql`set local lock_timeout='10ms'`);
          const subject = await this.lockSubjectForOutbox(tx, candidate.id);
          const row = await lockedRow(tx, candidate.id);
          if (
            this.botKey !== undefined &&
            !(
              await tx.execute(
                sql`select id from integration_outbox where id=${row.id}::uuid ${botPredicate(this.botKey)}`,
              )
            ).rows.length
          )
            return;
          if (!["pending", "retry_wait"].includes(row.status)) return;
          const started = (
            await tx.execute<{ found: boolean }>(
              sql`select ${unresolvedStartPredicate()} as found from integration_outbox where id=${row.id}::uuid`,
            )
          ).rows[0]!.found;
          if (!started && !(await this.validClientSource(tx, row, subject))) {
            await writeDeadLetterAndAlert(tx, row, "client_authority_invalid");
            return row.topic;
          }
        });
        if (topic) invalid.push({ topic });
      } catch (error) {
        if (!isLockBusy(error)) throw error;
        busyIds.push(candidate.id);
      }
    }
    return {
      busyIds,
      authorityInvalid:
        this.topics === undefined ? [] : recoveryCounts(this.topics, invalid),
    };
  }

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
    const { busyIds } = await this.fenceUnstarted(limit);
    return this.db.transaction(async (tx) => {
      await terminalizeDispatchExhausted(
        tx,
        maxAttempts,
        this.topics,
        this.botKey,
      );
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
            ${excludingBusyIds(busyIds)}
            ${topicPredicate(this.topics)}
            ${botPredicate(this.botKey)}
            ${orderedDialoguePredicate(this.topics)}
            ${this.egressGatePredicate()}
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

  async claimWithMetrics(
    limit: number,
    owner: string,
    leaseDurationMs: number,
    maxAttempts: number,
  ): Promise<{
    readonly messages: readonly PersistedOutboxMessage[];
    readonly exhausted: readonly OutboxRecoveryCount[];
    readonly authorityInvalid?: readonly OutboxRecoveryCount[];
  }> {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      return { messages: [], exhausted: [] };
    }
    if (!Number.isSafeInteger(leaseDurationMs) || leaseDurationMs < 1) {
      throw new RangeError("leaseDurationMs must be a positive integer");
    }
    const topics = requireRecoveryTopics(this.topics);
    const { authorityInvalid, busyIds } = await this.fenceUnstarted(limit);
    return this.db.transaction(async (tx) => {
      const exhausted = await terminalizeDispatchExhaustedByTopic(
        tx,
        maxAttempts,
        topics,
        limit,
        this.botKey,
      );
      const result = await tx.execute<RawOutboxMessage>(sql`
        with claimable as (
          select id from integration_outbox
          where (
            status='pending' or (
              status='retry_wait'
              and (next_attempt_at is null or next_attempt_at <= now())
            )
          )
            and attempt < ${maxAttempts}
            ${excludingBusyIds(busyIds)}
            ${topicPredicate(topics)}
            ${botPredicate(this.botKey)}
            ${orderedDialoguePredicate(topics)}
          order by created_at,id
          for update skip locked
          limit ${limit}
        )
        update integration_outbox o
        set status='processing',attempt=o.attempt+1,
          dispatch_owner_id=${owner},
          dispatch_claim_token=gen_random_uuid()::text,
          reconciliation_claim_token=null,
          lease_until=clock_timestamp()+(${leaseDurationMs} * interval '1 millisecond'),
          next_attempt_at=null,updated_at=now()
        from claimable where o.id=claimable.id
        returning o.id,o.topic,o.payload,
          o.correlation_id as "correlationId",o.attempt,
          o.reconciliation_key as "reconciliationKey",
          o.reconciliation_attempt as "reconciliationAttempt",
          o.dispatch_claim_token as "dispatchClaimToken",
          o.reconciliation_claim_token as "reconciliationClaimToken"
      `);
      return { messages: messages(result.rows), exhausted, authorityInvalid };
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
        this.topics,
        this.botKey,
      );
      const result = await tx.execute<RawOutboxMessage>(sql`
        with claimable as (
          select id
          from integration_outbox
          where status = 'unknown_outcome'
            and reconciliation_attempt < ${maxReconciliationAttempts}
            and (next_reconciliation_at is null or next_reconciliation_at <= now())
            ${topicPredicate(this.topics)}
            ${botPredicate(this.botKey)}
            ${orderedDialoguePredicate(this.topics)}
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

  async claimUnknownWithMetrics(
    limit: number,
    owner: string,
    leaseDurationMs: number,
    maxReconciliationAttempts: number,
  ): Promise<{
    readonly messages: readonly PersistedOutboxMessage[];
    readonly exhausted: readonly OutboxRecoveryCount[];
  }> {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      return { messages: [], exhausted: [] };
    }
    if (!Number.isSafeInteger(leaseDurationMs) || leaseDurationMs < 1) {
      throw new RangeError("leaseDurationMs must be a positive integer");
    }
    const topics = requireRecoveryTopics(this.topics);
    return this.db.transaction(async (tx) => {
      const exhausted = await terminalizeReconciliationExhaustedByTopic(
        tx,
        maxReconciliationAttempts,
        topics,
        limit,
        this.botKey,
      );
      const result = await tx.execute<RawOutboxMessage>(sql`
        with claimable as (
          select id from integration_outbox
          where status='unknown_outcome'
            and reconciliation_attempt < ${maxReconciliationAttempts}
            and (next_reconciliation_at is null or next_reconciliation_at <= now())
            ${topicPredicate(topics)}
            ${botPredicate(this.botKey)}
            ${orderedDialoguePredicate(topics)}
          order by updated_at,id
          for update skip locked
          limit ${limit}
        )
        update integration_outbox o
        set status='reconciling',
          reconciliation_attempt=o.reconciliation_attempt+1,
          reconciliation_owner_id=${owner},
          reconciliation_claim_token=gen_random_uuid()::text,
          dispatch_claim_token=null,
          reconciliation_lease_until=
            clock_timestamp()+(${leaseDurationMs} * interval '1 millisecond'),
          next_reconciliation_at=null,updated_at=now()
        from claimable where o.id=claimable.id
        returning o.id,o.topic,o.payload,
          o.correlation_id as "correlationId",o.attempt,
          o.reconciliation_key as "reconciliationKey",
          o.reconciliation_attempt as "reconciliationAttempt",
          o.dispatch_claim_token as "dispatchClaimToken",
          o.reconciliation_claim_token as "reconciliationClaimToken"
      `);
      return { messages: messages(result.rows), exhausted };
    });
  }

  async recordAttemptStarted(
    id: string,
    owner: string,
    claimToken: string,
    attemptId: string,
    reconciliationKey: string,
    startedAt: Date,
    expectedAttempt?: number,
  ): Promise<void | DispatchStartResult> {
    let client = false;
    try {
      return await this.db.transaction(async (tx) => {
        const source = (
          await tx.execute<{ topic: string }>(
            sql`select topic from integration_outbox where id=${id}::uuid`,
          )
        ).rows[0];
        client = source !== undefined && isClientAsyncTopic(source.topic);
        // Document table -> subject -> source/authority, as in all other client writers.
        if (client) await tx.execute(sql`set local lock_timeout='10ms'`);
        const subject = await this.lockSubjectForOutbox(tx, id);
        // Permit short row waits, but never an unbounded sequential-worker convoy.
        // Fresh deadline/lease checks below remain mandatory after every successful wait.
        if (client) await tx.execute(sql`set local lock_timeout='1000ms'`);
        const row = await lockedRow(tx, id);
        if (
          this.botKey !== undefined &&
          !(
            await tx.execute(
              sql`select id from integration_outbox where id=${id}::uuid ${botPredicate(this.botKey)}`,
            )
          ).rows.length
        )
          throw new OutboxStateConflictError("Outbox bot mismatch");
        requireDispatchLease(row, owner, claimToken);
        if (row.reconciliationKey !== reconciliationKey) {
          throw new OutboxStateConflictError(
            "Outbox reconciliation key mismatch",
          );
        }
        if (isClientAsyncTopic(row.topic)) {
          if (expectedAttempt !== row.attempt)
            throw new OutboxStateConflictError("Outbox attempt mismatch");
          const started = (
            await tx.execute<{ found: boolean }>(
              sql`select exists(select 1 from delivery_attempts where outbox_id=${id}::uuid and attempt=${row.attempt} and outcome='started') as found`,
            )
          ).rows[0]!.found;
          if (started)
            return { kind: "blocked", reasonCode: "attempt_already_started" };
          if (!(await this.validClientSource(tx, row, subject))) {
            const everStarted = (
              await tx.execute<{ found: boolean }>(
                sql`select ${unresolvedStartPredicate()} as found from integration_outbox where id=${id}::uuid`,
              )
            ).rows[0]!.found;
            if (!everStarted)
              await writeDeadLetterAndAlert(
                tx,
                row,
                "client_authority_invalid",
              );
            return { kind: "blocked", reasonCode: "client_authority_invalid" };
          }
        }
        // Refresh clock-dependent lease authority only after all blocking reads.
        const current = await lockedRow(tx, id);
        requireDispatchLease(current, owner, claimToken);
        if (
          current.attempt !== row.attempt ||
          current.reconciliationKey !== reconciliationKey
        )
          throw new OutboxStateConflictError("Outbox attempt changed");
        await tx.execute(sql`
        insert into delivery_attempts (
          outbox_id,
          attempt_id,
          attempt,
          provider,
          outcome,
          reconciliation_key,
          normalized_reason,
          created_at
        ) values (
          ${id}::uuid,
          ${attemptId},
          ${row.attempt},
          split_part(${row.topic}, '.', 1),
          'started',
          ${reconciliationKey},
          ${isClientAsyncTopic(row.topic) ? clientDispatchPayloadDigest(row.payload) : null},
          ${isClientAsyncTopic(row.topic) ? sql`clock_timestamp()` : sql`${startedAt}`}
        )
      `);
        if (isClientAsyncTopic(row.topic))
          return {
            kind: "admitted",
            outboxId: id,
            topic: row.topic,
            owner,
            claimToken,
            attempt: row.attempt,
            attemptId,
            reconciliationKey,
            payloadDigest: clientDispatchPayloadDigest(row.payload),
          };
      });
    } catch (error) {
      if (!client || !isLockBusy(error)) throw error;
      // Admission transaction rolled back, including any attempted journal write.
      await this.deferUnstartedClientClaim(
        id,
        owner,
        claimToken,
        reconciliationKey,
        expectedAttempt,
      );
      return { kind: "deferred", reasonCode: "client_authority_busy" };
    }
  }

  private async deferUnstartedClientClaim(
    id: string,
    owner: string,
    claimToken: string,
    reconciliationKey: string,
    attempt: number | undefined,
  ) {
    if (attempt === undefined) return;
    try {
      await this.db.transaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout='10ms'`);
        await tx.execute(sql`
          with candidate as materialized (
            select id from integration_outbox where id=${id}::uuid
              and dispatch_owner_id=${owner} and dispatch_claim_token=${claimToken}
              and reconciliation_key=${reconciliationKey} and attempt=${attempt}
              and ${unstartedClientClaimPredicate()} ${botPredicate(this.botKey)}
            for update skip locked
          )
          update integration_outbox o set status='pending',attempt=o.attempt-1,
            dispatch_owner_id=null,dispatch_claim_token=null,lease_until=null,
            next_attempt_at=null,updated_at=now()
          from candidate where o.id=candidate.id`);
      });
    } catch (error) {
      // If even source release is busy, scoped expiry recovery performs the same
      // no-effect transition. Never fabricate an unknown/not_applied fact here.
      if (!isLockBusy(error)) throw error;
    }
  }

  private async recoverExpiredUnstartedClientClaims(
    tx: Transaction,
    limit: number,
  ) {
    await tx.execute(sql`
      with candidates as materialized (
        select id from integration_outbox where lease_until<clock_timestamp()
          and ${unstartedClientClaimPredicate()}
          ${topicPredicate(this.topics)} ${botPredicate(this.botKey)}
        order by lease_until,id for update skip locked limit ${limit}
      )
      update integration_outbox o set status='pending',attempt=o.attempt-1,
        dispatch_owner_id=null,dispatch_claim_token=null,lease_until=null,
        next_attempt_at=null,updated_at=now()
      from candidates where o.id=candidates.id`);
    // No unknown-outcome metrics: no dispatch took place. Started/uncertain work
    // is deliberately left for the existing recovery transitions below.
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
    // This transition is called only for a confirmed not-applied result, never unknown.
    await tx.execute(sql`insert into delivery_attempts(outbox_id,attempt_id,attempt,provider,outcome,reconciliation_key,normalized_reason)
      select id,'confirmed-not-applied:'||attempt::text,attempt,split_part(topic,'.',1),'not_applied',reconciliation_key,${reasonCode}
      from integration_outbox where id=${id}::uuid and topic in ('telegram.send_text.v1','selarti.request.v1')
      and not exists(select 1 from delivery_attempts a where a.outbox_id=integration_outbox.id and a.attempt=integration_outbox.attempt and a.outcome='not_applied')`);
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
    assertRecoveryLimit(limit);
    return this.db.transaction(async (tx) => {
      await this.recoverExpiredUnstartedClientClaims(tx, limit);
      const result = await tx.execute<{ id: string }>(sql`
        with candidates as materialized (
          select id
          from integration_outbox
          where status = 'processing'
            and lease_until < clock_timestamp()
            and not (${unstartedClientClaimPredicate()})
            ${topicPredicate(this.topics)}
            ${botPredicate(this.botKey)}
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

  async recoverExpiredDispatchLeasesByTopic(
    limit = 1_000,
  ): Promise<readonly OutboxRecoveryCount[]> {
    assertRecoveryLimit(limit);
    const topics = requireRecoveryTopics(this.topics);
    const rows = await this.db.transaction(async (tx) => {
      await this.recoverExpiredUnstartedClientClaims(tx, limit);
      const result = await tx.execute<{ topic: string }>(sql`
        with candidates as materialized (
          select id
          from integration_outbox
          where status = 'processing'
            and lease_until < clock_timestamp()
            and not (${unstartedClientClaimPredicate()})
            ${topicPredicate(this.topics)}
            ${botPredicate(this.botKey)}
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
        ), attempts as (
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
        returning outbox_id
        )
        select recovered.topic
        from recovered join attempts on attempts.outbox_id=recovered.id
      `);
      return result.rows;
    });
    return recoveryCounts(topics, rows);
  }

  async recoverExpiredReconciliationLeases(limit = 1_000): Promise<number> {
    assertRecoveryLimit(limit);
    return this.db.transaction(async (tx) => {
      const result = await tx.execute<{ id: string }>(sql`
        with candidates as materialized (
          select id
          from integration_outbox
          where status = 'reconciling'
            and reconciliation_lease_until < clock_timestamp()
            ${topicPredicate(this.topics)}
            ${botPredicate(this.botKey)}
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

  async recoverExpiredReconciliationLeasesByTopic(
    limit = 1_000,
  ): Promise<readonly OutboxRecoveryCount[]> {
    assertRecoveryLimit(limit);
    const topics = requireRecoveryTopics(this.topics);
    const rows = await this.db.transaction(async (tx) => {
      const result = await tx.execute<{ topic: string }>(sql`
        with candidates as materialized (
          select id
          from integration_outbox
          where status = 'reconciling'
            and reconciliation_lease_until < clock_timestamp()
            ${topicPredicate(this.topics)}
            ${botPredicate(this.botKey)}
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
        ), attempts as (
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
        returning outbox_id
        )
        select recovered.topic
        from recovered join attempts on attempts.outbox_id=recovered.id
      `);
      return result.rows;
    });
    return recoveryCounts(topics, rows);
  }
}

/** B2 dispatcher view: one topic and a strict unfinished-sequence barrier. */
export class PostgresOrderedTelegramOutboxRepository extends PostgresOutboxRepository {
  /** Compatibility argument cannot disable the mandatory client fence. */
  constructor(
    db: DrizzleDb,
    _consentGate: {
      readonly enabled: boolean;
      readonly purpose?: string;
    },
    botKey?: string,
  ) {
    super(db, ["telegram.send_text.v1"], botKey);
    // Kept for source compatibility; this legacy flag cannot disable original-authority fencing.
    void _consentGate;
  }

  protected override egressGatePredicate(): SQL {
    // Original-authority fencing is mandatory in the base repository, regardless of legacy flags.
    return sql``;
  }

  override async claimWithMetrics(
    limit: number,
    owner: string,
    leaseDurationMs: number,
    maxAttempts: number,
  ) {
    return super.claimWithMetrics(limit, owner, leaseDurationMs, maxAttempts);
  }

  override async claimUnknownWithMetrics(
    limit: number,
    owner: string,
    leaseDurationMs: number,
    maxReconciliationAttempts: number,
  ) {
    return super.claimUnknownWithMetrics(
      limit,
      owner,
      leaseDurationMs,
      maxReconciliationAttempts,
    );
  }
}
