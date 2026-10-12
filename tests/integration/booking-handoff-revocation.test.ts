import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";
import { PostgresBookingHandoffRevocationRepository } from "../../packages/db/src/repositories/booking-handoff-revocation-repository.js";
import { PostgresOutboxRepository } from "../../packages/db/src/repositories/outbox-repository.js";
import { PostgresPrivacyRepository } from "../../packages/db/src/repositories/privacy-repository.js";
import { PostgresBookingRepository } from "../../packages/db/src/repositories/booking-repository.js";
import { seedClientConsent } from "../../packages/db/src/testkit/client-consent.js";

let database: TestDatabase;
const topic = "booking.handoff_revoked";
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const consumer = () =>
  new PostgresBookingHandoffRevocationRepository(database.db);

type TestTransaction = Parameters<
  Parameters<TestDatabase["db"]["transaction"]>[0]
>[0];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

// Test-only scheduling around a REAL transaction executor. The gate pauses
// before submitting one authority statement, never replaces its SQL or result.
function authorityBoundaryGate(boundary: "subject" | "document") {
  const reached = deferred<void>();
  const resume = deferred<void>();
  const execution = deferred<string>();
  const dialect = new PgDialect();
  let intercepted = false;
  const db = new Proxy(database.db, {
    get(target, property) {
      if (property === "transaction") {
        return <T>(
          work: (tx: TestTransaction) => Promise<T>,
          config?: Parameters<TestDatabase["db"]["transaction"]>[1],
        ) =>
          target.transaction(
            (tx) =>
              work(
                new Proxy(tx, {
                  get(transaction, member) {
                    if (member === "execute") {
                      return (
                        query: Parameters<TestTransaction["execute"]>[0],
                      ) => {
                        const text = (
                          typeof query === "string"
                            ? query
                            : dialect.sqlToQuery(query.getSQL()).sql
                        )
                          .replace(/\s+/g, " ")
                          .trim();
                        const matches =
                          boundary === "subject"
                            ? text.startsWith("select pg_advisory_xact_lock(")
                            : text ===
                              "lock table consent_document_versions in share mode";
                        if (!intercepted && matches) {
                          intercepted = true;
                          reached.resolve();
                          return resume.promise.then(async () => {
                            try {
                              const result = await transaction.execute(query);
                              execution.resolve("succeeded");
                              return result;
                            } catch (error) {
                              const code =
                                (
                                  error as {
                                    code?: string;
                                    cause?: { code?: string };
                                  }
                                )?.cause?.code ??
                                (error as { code?: string })?.code;
                              execution.resolve(code ?? "unknown_error");
                              throw error;
                            }
                          });
                        }
                        return transaction.execute(query);
                      };
                    }
                    const value = Reflect.get(transaction, member);
                    return typeof value === "function"
                      ? value.bind(transaction)
                      : value;
                  },
                }),
              ),
            config,
          );
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return {
    db,
    execution: execution.promise,
    release: () => resume.resolve(),
    // A skipped authority call must fail, rather than leave the test hanging.
    waitUntilReached: (work: Promise<unknown>) =>
      Promise.race([
        reached.promise,
        work.then(() => {
          throw new Error("authority_boundary_not_reached");
        }),
      ]),
  };
}

beforeAll(async () => {
  database = await startTestPostgres();
  expect(
    (await database.db.execute(sql`show server_version_num`)).rows,
  ).toEqual([{ server_version_num: "170005" }]);
  await database.migrate();
}, 120000);
afterAll(async () => {
  await database?.stop();
}, 60000);
afterEach(async () => {
  // Retain append-only facts; isolate unfinished synthetic queue fixtures.
  await database.db.execute(
    sql`update integration_outbox set status='dead_letter',dispatch_owner_id=null,dispatch_claim_token=null,lease_until=null,reconciliation_owner_id=null,reconciliation_claim_token=null,reconciliation_lease_until=null where topic=${topic} and status not in ('succeeded','dead_letter')`,
  );
});

async function event(
  options: {
    decision?: string;
    purpose?: string;
    userId?: string;
    mutate?: (payload: Record<string, unknown>) => void;
    hash?: string;
    idempotencyKey?: string;
    reconciliationKey?: string;
    id?: string;
  } = {},
) {
  const userId = options.userId ?? (await database.createUser());
  const consentId = (
    await database.db.execute<{ id: string }>(sql`
    insert into consents(user_id,consent_type,decision,policy_version,basis)
    values(${userId}::uuid,${options.purpose ?? "expert_handoff"},${options.decision ?? "denied"},'handoff-v1','consent') returning id
  `)
  ).rows[0]!.id;
  const payload: Record<string, unknown> = {
    userId,
    consentDecisionId: consentId,
    purpose: "expert_handoff",
  };
  options.mutate?.(payload);
  const id = options.id ?? randomUUID();
  const reconciliationKey =
    options.reconciliationKey ?? `booking.handoff_revoked:${consentId}`;
  await database.db
    .execute(sql`insert into integration_outbox(id,idempotency_key,topic,payload,correlation_id,reconciliation_key,payload_hash)
    values(${id}::uuid,${options.idempotencyKey ?? `privacy:booking.handoff_revoked:${consentId}`},${topic},${JSON.stringify(payload)}::jsonb,${randomUUID()},${reconciliationKey},${options.hash ?? digest(payload)})`);
  return { id, userId, consentId, reconciliationKey };
}
async function receipts(id: string) {
  return (
    await database.db.execute(
      sql`select consent_decision_id,outcome,coverage,known_recipient_count from booking_handoff_revocation_receipts where source_outbox_id=${id}::uuid`,
    )
  ).rows;
}
async function evidenceCounts(id: string) {
  return (
    await database.db.execute(sql`select
    (select count(*)::int from booking_handoff_revocation_receipts where source_outbox_id=${id}::uuid) receipts,
    (select count(*)::int from outbox_operator_alerts where outbox_id=${id}::uuid) alerts,
    (select count(*)::int from delivery_attempts where outbox_id=${id}::uuid) sends,
    (select count(*)::int from booking_notification_deliveries where source_outbox_id=${id}::uuid) deliveries`)
  ).rows[0];
}
async function legacy(id: string, status: string, active = false) {
  await database.db
    .execute(sql`update integration_outbox set status=${status},attempt=1,
    dispatch_owner_id=case when ${status}='processing' then 'old-worker' else null end,
    dispatch_claim_token=case when ${status}='processing' then 'old-token' else null end,
    lease_until=case when ${status}='processing' then clock_timestamp()+${active ? 60 : -60}*interval '1 second' else null end,
    reconciliation_owner_id=case when ${status}='reconciling' then 'old-worker' else null end,
    reconciliation_claim_token=case when ${status}='reconciling' then 'old-token' else null end,
    reconciliation_lease_until=case when ${status}='reconciling' then clock_timestamp()+${active ? 60 : -60}*interval '1 second' else null end
    where id=${id}::uuid`);
}

it.each([0, -1, 1.5, 101, NaN, Infinity])(
  "rejects invalid limit %s before examining work",
  async (limit) => {
    await expect(consumer().consumePending(limit)).rejects.toThrow(RangeError);
  },
);
it.each(["denied", "revoked"])(
  "accounts once for historical %s and retains uncertainty without sending",
  async (decision) => {
    const f = await event({ decision });
    const repository = consumer();
    expect(await repository.consumePending(20)).toEqual({
      examined: 1,
      processed: 1,
      quarantined: 0,
      operatorRequired: 1,
    });
    expect(await receipts(f.id)).toEqual([
      {
        consent_decision_id: f.consentId,
        outcome: "processed",
        coverage: "historical_disclosure_untracked",
        known_recipient_count: 0,
      },
    ]);
    expect(await database.outboxStatus(f.id)).toBe("succeeded");
    expect(await database.ownerAlertReasons(f.id)).toEqual([
      "handoff_historical_disclosure_untracked",
    ]);
    expect(await evidenceCounts(f.id)).toEqual({
      receipts: 1,
      alerts: 1,
      sends: 0,
      deliveries: 0,
    });
    expect(await repository.consumePending(20)).toEqual({
      examined: 0,
      processed: 0,
      quarantined: 0,
      operatorRequired: 0,
    });
    expect((await consumer().consumePending(20)).processed).toBe(0);
  },
);
it.each(["expert_handoff", "expert_note"] as const)(
  "consumes real privacy producer %s even after a later grant",
  async (purpose) => {
    const userId = await database.createUser();
    const privacy = new PostgresPrivacyRepository(database.db, {
      privacyMutationCapability: { enabled: true },
    });
    const withdrawal = await privacy.withdrawConsentAtomically({
      targetUserId: userId,
      purpose,
      policyVersion: "handoff-v1",
      correlationId: randomUUID(),
    });
    const source = (
      await database.db.execute<{ id: string; consentId: string }>(
        sql`select id,payload->>'consentDecisionId' as "consentId" from integration_outbox where topic=${topic} and payload->>'userId'=${userId}`,
      )
    ).rows[0]!;
    if (purpose === "expert_note")
      expect(source.consentId).not.toBe(withdrawal.consentDecisionId);
    await database.db.execute(
      sql`insert into consents(user_id,consent_type,decision,policy_version,basis) values(${userId}::uuid,'expert_handoff','granted','handoff-v1','consent')`,
    );
    expect((await consumer().consumePending(20)).processed).toBe(1);
    expect((await receipts(source.id))[0]).toMatchObject({
      consent_decision_id: source.consentId,
      outcome: "processed",
    });
  },
);
it("accepts the producer digest despite JSONB key ordering", async () => {
  const f = await event();
  const payload = (
    await database.db.execute<{ payload: unknown }>(
      sql`select payload from integration_outbox where id=${f.id}::uuid`,
    )
  ).rows[0]!.payload;
  expect(digest(payload)).not.toBe(
    digest({
      userId: f.userId,
      consentDecisionId: f.consentId,
      purpose: "expert_handoff",
    }),
  );
  expect((await consumer().consumePending(20)).processed).toBe(1);
});
it.each([
  "user",
  "purpose",
  "decision",
  "missing_fact",
  "hash",
  "idempotency",
  "reconciliation",
  "extra",
  "shape",
  "event_purpose",
])(
  "quarantines invalid %s with no trusted consent reference or send",
  async (kind) => {
    const other = await database.createUser();
    const f = await event({
      ...(kind === "purpose" ? { purpose: "expert_note" } : {}),
      ...(kind === "decision" ? { decision: "granted" } : {}),
      ...(kind === "hash" ? { hash: "0".repeat(64) } : {}),
      ...(kind === "idempotency" ? { idempotencyKey: randomUUID() } : {}),
      ...(kind === "reconciliation" ? { reconciliationKey: randomUUID() } : {}),
      mutate: (payload) => {
        if (kind === "user") payload.userId = other;
        if (kind === "missing_fact") payload.consentDecisionId = randomUUID();
        if (kind === "extra") payload.note = "synthetic-private-content";
        if (kind === "shape") payload.userId = "not-a-uuid";
        if (kind === "event_purpose") payload.purpose = "client_messaging";
      },
    });
    expect(await consumer().consumePending(20)).toEqual({
      examined: 1,
      processed: 0,
      quarantined: 1,
      operatorRequired: 1,
    });
    expect(await receipts(f.id)).toEqual([
      {
        consent_decision_id: null,
        outcome: "quarantined_invalid",
        coverage: "invalid_source",
        known_recipient_count: 0,
      },
    ]);
    expect(await database.outboxStatus(f.id)).toBe("dead_letter");
    expect(await database.ownerAlertReasons(f.id)).toEqual([
      "handoff_invalid_source",
    ]);
    expect(await evidenceCounts(f.id)).toEqual({
      receipts: 1,
      alerts: 1,
      sends: 0,
      deliveries: 0,
    });
  },
);
it("serializes two consumers and never duplicates a receipt or operator case", async () => {
  const f = await event();
  const results = await Promise.all([
    consumer().consumePending(20),
    consumer().consumePending(20),
  ]);
  expect(results.reduce((n, r) => n + r.processed, 0)).toBe(1);
  expect(await evidenceCounts(f.id)).toEqual({
    receipts: 1,
    alerts: 1,
    sends: 0,
    deliveries: 0,
  });
});
it("rolls back receipt and alert if the source terminal transition fails", async () => {
  const f = await event();
  await database.db.execute(
    sql`create function handoff_test_fail() returns trigger language plpgsql as $$ begin raise exception 'synthetic_handoff_rollback'; end $$`,
  );
  await database.db.execute(
    sql.raw(
      `create trigger handoff_test_fail before update on integration_outbox for each row when (old.id='${f.id}'::uuid) execute function handoff_test_fail()`,
    ),
  );
  try {
    await expect(consumer().consumePending(20)).rejects.toThrow();
    expect(await database.outboxStatus(f.id)).toBe("pending");
    expect(await evidenceCounts(f.id)).toEqual({
      receipts: 0,
      alerts: 0,
      sends: 0,
      deliveries: 0,
    });
  } finally {
    await database.db.execute(
      sql`drop trigger handoff_test_fail on integration_outbox`,
    );
    await database.db.execute(sql`drop function handoff_test_fail()`);
  }
  expect((await consumer().consumePending(20)).processed).toBe(1);
});
it("continues beyond a contended subject and acquires authority before any source lock", async () => {
  const first = await event({ id: "10000000-0000-4000-8000-000000000001" });
  const later = await event({ id: "f0000000-0000-4000-8000-000000000001" });
  const blocker = await database.db.$client.connect();
  await blocker.query("begin");
  await blocker.query(
    "select pg_advisory_xact_lock(hashtextextended($1::uuid::text,0))",
    [first.userId],
  );
  const gate = authorityBoundaryGate("subject");
  let pending:
    | ReturnType<PostgresBookingHandoffRevocationRepository["consumePending"]>
    | undefined;
  try {
    const repository = new PostgresBookingHandoffRevocationRepository(gate.db);
    pending = repository.consumePending(1);
    await gate.waitUntilReached(pending);
    // Boundary proof, not a sampled server wait: the real subject lock is held,
    // and a source-first implementation would already hold this source row.
    expect(
      (
        await blocker.query(
          "select id from integration_outbox where id=$1 for update nowait",
          [first.id],
        )
      ).rows,
    ).toEqual([{ id: first.id }]);
    gate.release();
    const result = await pending;
    // The unchanged authority SQL now actually waits and hits production 50ms.
    // A fabricated result or skipped statement cannot satisfy this assertion.
    expect(await gate.execution).toBe("55P03");
    expect(result).toEqual({
      examined: 1,
      processed: 0,
      quarantined: 0,
      operatorRequired: 0,
    });
    expect((await repository.consumePending(1)).processed).toBe(1);
    expect(await database.outboxStatus(later.id)).toBe("succeeded");
    expect(await database.outboxStatus(first.id)).toBe("pending");
    await blocker.query(
      "select id from integration_outbox where id=$1 for update nowait",
      [first.id],
    );
  } finally {
    gate.release();
    await pending?.catch(() => undefined);
    await blocker.query("rollback");
    blocker.release();
  }
  expect((await consumer().consumePending(1)).processed).toBe(1);
});
it("rereads topic after the document authority barrier before acting", async () => {
  const f = await event();
  const blocker = await database.db.$client.connect();
  await blocker.query("begin");
  await blocker.query(
    "lock table consent_document_versions in access exclusive mode",
  );
  const gate = authorityBoundaryGate("document");
  let pending:
    | ReturnType<PostgresBookingHandoffRevocationRepository["consumePending"]>
    | undefined;
  try {
    pending = new PostgresBookingHandoffRevocationRepository(
      gate.db,
    ).consumePending(20);
    await gate.waitUntilReached(pending);
    expect(
      (
        await blocker.query(
          "select id from integration_outbox where id=$1 for update nowait",
          [f.id],
        )
      ).rows,
    ).toEqual([{ id: f.id }]);
    // The candidate was read before the gate. Commit a different topic while
    // authority is still held; the resumed REAL lock must succeed before reread.
    await blocker.query(
      "update integration_outbox set topic='unrelated.changed' where id=$1",
      [f.id],
    );
    await blocker.query("commit");
    gate.release();
    const result = await pending;
    expect(await gate.execution).toBe("succeeded");
    expect(result).toEqual({
      examined: 1,
      processed: 0,
      quarantined: 0,
      operatorRequired: 0,
    });
    expect(await database.outboxStatus(f.id)).toBe("pending");
    expect(await evidenceCounts(f.id)).toEqual({
      receipts: 0,
      alerts: 0,
      sends: 0,
      deliveries: 0,
    });
    await database.db.execute(
      sql`update integration_outbox set status='dead_letter' where id=${f.id}::uuid`,
    );
  } finally {
    gate.release();
    await pending?.catch(() => undefined);
    await blocker.query("rollback");
    blocker.release();
  }
});
it("skips a locked source and reaches later work within a bounded page", async () => {
  const f = await event();
  const later = await event();
  const blocker = await database.db.$client.connect();
  await blocker.query("begin");
  await blocker.query(
    "select id from integration_outbox where id=$1 for update",
    [f.id],
  );
  try {
    expect(await consumer().consumePending(20)).toEqual({
      examined: 2,
      processed: 1,
      quarantined: 0,
      operatorRequired: 1,
    });
    expect(await database.outboxStatus(later.id)).toBe("succeeded");
  } finally {
    await blocker.query("rollback");
    blocker.release();
  }
});
it.each(["processing", "reconciling"])(
  "does not steal an active legacy %s lease",
  async (status) => {
    const f = await event();
    await legacy(f.id, status, true);
    expect(await consumer().consumePending(20)).toEqual({
      examined: 1,
      processed: 0,
      quarantined: 0,
      operatorRequired: 0,
    });
    expect(await database.outboxStatus(f.id)).toBe(status);
    expect(await receipts(f.id)).toEqual([]);
    expect(await database.ownerAlertReasons(f.id)).toEqual([]);
  },
);
it.each(["processing", "reconciling", "unknown_outcome", "retry_wait"])(
  "quarantines legacy %s uncertainty without resetting or sending",
  async (status) => {
    const f = await event();
    await legacy(f.id, status);
    await database.db.execute(
      sql`insert into delivery_attempts(outbox_id,attempt_id,attempt,provider,outcome,reconciliation_key) values(${f.id}::uuid,'old-start',1,'booking','started',${f.reconciliationKey})`,
    );
    expect(await consumer().consumePending(20)).toEqual({
      examined: 1,
      processed: 0,
      quarantined: 1,
      operatorRequired: 1,
    });
    expect(await receipts(f.id)).toEqual([
      {
        consent_decision_id: f.consentId,
        outcome: "quarantined_legacy",
        coverage: "historical_disclosure_untracked",
        known_recipient_count: 0,
      },
    ]);
    expect(await database.outboxStatus(f.id)).toBe("dead_letter");
    expect(await database.ownerAlertReasons(f.id)).toEqual([
      "handoff_legacy_outcome_unverified",
    ]);
    expect(await evidenceCounts(f.id)).toEqual({
      receipts: 1,
      alerts: 1,
      sends: 1,
      deliveries: 0,
    });
  },
);
it("processes retry work with no external attempts locally", async () => {
  const f = await event();
  await database.db.execute(
    sql`update integration_outbox set status='retry_wait',next_attempt_at=clock_timestamp()+interval '1 day' where id=${f.id}::uuid`,
  );
  expect((await consumer().consumePending(20)).processed).toBe(1);
});
it.each([
  { status: "pending", counter: 0, fact: true },
  { status: "retry_wait", counter: 0, fact: true },
  { status: "pending", counter: 1, fact: false },
  { status: "retry_wait", counter: 1, fact: false },
])(
  "preserves independent legacy evidence $status counter=$counter fact=$fact",
  async ({ status, counter, fact }) => {
    const f = await event();
    await database.db.execute(
      sql`update integration_outbox set status=${status},attempt=${counter} where id=${f.id}::uuid`,
    );
    if (fact)
      await database.db.execute(
        sql`insert into delivery_attempts(outbox_id,attempt_id,attempt,provider,outcome,reconciliation_key) values(${f.id}::uuid,'independent-start',1,'booking','started',${f.reconciliationKey})`,
      );
    expect(await consumer().consumePending(20)).toEqual({
      examined: 1,
      processed: 0,
      quarantined: 1,
      operatorRequired: 1,
    });
    expect(await receipts(f.id)).toEqual([
      {
        consent_decision_id: f.consentId,
        outcome: "quarantined_legacy",
        coverage: "historical_disclosure_untracked",
        known_recipient_count: 0,
      },
    ]);
    expect(await database.outboxStatus(f.id)).toBe("dead_letter");
    expect(await evidenceCounts(f.id)).toEqual({
      receipts: 1,
      alerts: 1,
      sends: fact ? 1 : 0,
      deliveries: 0,
    });
  },
);
it("bounds examination to the requested limit and reaches the rest next poll", async () => {
  await event();
  await event();
  await event();
  const repository = consumer();
  expect(await repository.consumePending(2)).toEqual({
    examined: 2,
    processed: 2,
    quarantined: 0,
    operatorRequired: 2,
  });
  expect((await repository.consumePending(2)).processed).toBe(1);
});
it("generic unrestricted claim and exhaustion leave this topic alone and retain unrelated claims", async () => {
  const pending = await event();
  const exhausted = await event();
  await database.db.execute(
    sql`update integration_outbox set attempt=5 where id=${exhausted.id}::uuid`,
  );
  const unrelated = await database.insertOutbox({
    topic: "unrelated.product",
    reconciliationKey: randomUUID(),
  });
  const claims = await new PostgresOutboxRepository(database.db).claim(
    100,
    "generic",
    60000,
    5,
  );
  expect(claims.some((c) => c.id === unrelated)).toBe(true);
  expect(claims.some((c) => [pending.id, exhausted.id].includes(c.id))).toBe(
    false,
  );
  expect(await database.outboxStatus(exhausted.id)).toBe("pending");
  expect(await database.ownerAlertReasons(exhausted.id)).toEqual([]);
});
it("generic unknown claim, reconciliation exhaustion and lease recovery preserve dedicated sources", async () => {
  const dispatch = await event();
  const reconciling = await event();
  const unknown = await event();
  const exhausted = await event();
  await legacy(dispatch.id, "processing");
  await legacy(reconciling.id, "reconciling");
  await legacy(unknown.id, "unknown_outcome");
  await legacy(exhausted.id, "unknown_outcome");
  await database.db.execute(
    sql`update integration_outbox set reconciliation_attempt=5 where id=${exhausted.id}::uuid`,
  );
  const repository = new PostgresOutboxRepository(database.db);
  await repository.recoverExpiredDispatchLeases(100);
  await repository.recoverExpiredReconciliationLeases(100);
  const claims = await repository.claimUnknown(100, "generic", 60000, 5);
  expect(
    claims.some((c) =>
      [dispatch.id, reconciling.id, unknown.id, exhausted.id].includes(c.id),
    ),
  ).toBe(false);
  expect(await database.outboxStatus(dispatch.id)).toBe("processing");
  expect(await database.outboxStatus(reconciling.id)).toBe("reconciling");
  expect(await database.outboxStatus(exhausted.id)).toBe("unknown_outcome");
  for (const f of [dispatch, reconciling, unknown, exhausted])
    expect(await evidenceCounts(f.id)).toEqual({
      receipts: 0,
      alerts: 0,
      sends: 0,
      deliveries: 0,
    });
});
it.each([
  "start",
  "succeed",
  "retry",
  "dead",
  "unknown",
  "reconciled",
  "retry_reconciled",
  "dead_reconciled",
  "still_unknown",
])(
  "generic stale direct %s cannot mutate dedicated work",
  async (operation) => {
    const f = await event();
    const reconcile = [
      "reconciled",
      "retry_reconciled",
      "dead_reconciled",
      "still_unknown",
    ].includes(operation);
    await legacy(f.id, reconcile ? "reconciling" : "processing", true);
    if (operation === "unknown")
      await database.db.execute(
        sql`insert into delivery_attempts(outbox_id,attempt_id,attempt,provider,outcome,reconciliation_key) values(${f.id}::uuid,'started',1,'booking','started',${f.reconciliationKey})`,
      );
    const repository = new PostgresOutboxRepository(database.db);
    const action = () => {
      switch (operation) {
        case "start":
          return repository.recordAttemptStarted(
            f.id,
            "old-worker",
            "old-token",
            "started",
            f.reconciliationKey,
            new Date(),
            1,
          );
        case "succeed":
          return repository.succeed(f.id, "old-worker", "old-token");
        case "retry":
          return repository.retry(
            f.id,
            "old-worker",
            "old-token",
            new Date(),
            "synthetic",
          );
        case "dead":
          return repository.deadLetterAndAlert(
            f.id,
            "old-worker",
            "old-token",
            "synthetic",
          );
        case "unknown":
          return repository.markUnknownOutcome(
            f.id,
            "old-worker",
            "old-token",
            "started",
            f.reconciliationKey,
            "synthetic",
          );
        case "reconciled":
          return repository.succeedAfterReconciliation(
            f.id,
            "old-worker",
            "old-token",
          );
        case "retry_reconciled":
          return repository.retryAfterReconciliation(
            f.id,
            "old-worker",
            "old-token",
            new Date(),
            "synthetic",
          );
        case "dead_reconciled":
          return repository.deadLetterAfterReconciliationAndAlert(
            f.id,
            "old-worker",
            "old-token",
            "synthetic",
          );
        default:
          return repository.markStillUnknown(
            f.id,
            "old-worker",
            "old-token",
            "synthetic",
            new Date(),
          );
      }
    };
    await expect(action()).rejects.toThrow("outbox_topic_dedicated_owner");
    expect(await database.outboxStatus(f.id)).toBe(
      reconcile ? "reconciling" : "processing",
    );
    expect(await evidenceCounts(f.id)).toEqual({
      receipts: 0,
      alerts: 0,
      sends: operation === "unknown" ? 1 : 0,
      deliveries: 0,
    });
  },
);
it("does not suppress neutral notifications or change independent messaging authority", async () => {
  const f = await database.createReservableFixture();
  const userId = f.command.userId;
  const botKey = randomUUID();
  await database.db.execute(
    sql`insert into booking_notification_bot_controls(bot_key,admission_enabled) values(${botKey},true)`,
  );
  await database.db.execute(
    sql`update slots set starts_at=clock_timestamp()+interval '2 days',ends_at=clock_timestamp()+interval '2 days 1 hour',observed_at=clock_timestamp() where id=${f.command.slotId}::uuid`,
  );
  await database.db.execute(
    sql`update slots set ends_at=starts_at+interval '1 hour' where id=${f.command.slotId}::uuid`,
  );
  await database.db.execute(
    sql`insert into channel_identities(user_id,provider,external_id,external_chat_id,bot_key,status) select user_id,'telegram','301','301',${botKey},'active' from experts where id=${f.expertId}::uuid`,
  );
  const authority = await seedClientConsent(
    database.db,
    userId,
    "client_messaging",
  );
  const bookings = new PostgresBookingRepository(database.db, {
    notificationOrigin: {
      botKey,
      messagingPolicyVersion: "client-messaging-v1",
    },
  });
  f.command.now = new Date();
  const reserved = await bookings.reserve(f.command);
  if (reserved.kind === "unavailable")
    throw Error("synthetic_reservation_unavailable");
  const source = await event({ userId });
  expect((await consumer().consumePending(20)).processed).toBe(1);
  expect(
    (
      await database.db.execute(
        sql`select state from booking_notification_deliveries where reservation_id=${reserved.reservationId}::uuid`,
      )
    ).rows,
  ).toEqual([{ state: "pending" }]);
  expect(
    (
      await database.db.execute(
        sql`select last_decision_id from consent_states where user_id=${userId}::uuid and purpose='client_messaging'`,
      )
    ).rows,
  ).toEqual([{ last_decision_id: authority.decisionId }]);
  expect((await evidenceCounts(source.id))!.sends).toBe(0);
});
it("keeps receipts append-only and rejects contradictory recipient/coverage claims", async () => {
  const f = await event();
  expect((await consumer().consumePending(20)).processed).toBe(1);
  await expect(
    database.db.execute(
      sql`update booking_handoff_revocation_receipts set known_recipient_count=1 where source_outbox_id=${f.id}::uuid`,
    ),
  ).rejects.toThrow();
  await expect(
    database.db.execute(
      sql`delete from booking_handoff_revocation_receipts where source_outbox_id=${f.id}::uuid`,
    ),
  ).rejects.toThrow();
  const other = await event();
  await expect(
    database.db.execute(
      sql`insert into booking_handoff_revocation_receipts(source_outbox_id,consent_decision_id,outcome,coverage,known_recipient_count) values(${other.id}::uuid,${other.consentId}::uuid,'processed','historical_disclosure_untracked',1)`,
    ),
  ).rejects.toMatchObject({
    cause: {
      code: "23514",
      constraint: "booking_handoff_revocation_recipient_count_check",
    },
  });
  await expect(
    database.db.execute(
      sql`insert into booking_handoff_revocation_receipts(source_outbox_id,outcome,coverage,known_recipient_count) values(${other.id}::uuid,'processed','historical_disclosure_untracked',0)`,
    ),
  ).rejects.toThrow();
  await expect(
    database.db.execute(
      sql`insert into booking_handoff_revocation_receipts(source_outbox_id,consent_decision_id,outcome,coverage,known_recipient_count) values(${other.id}::uuid,${other.consentId}::uuid,'processed','remote_deleted',0)`,
    ),
  ).rejects.toThrow();
});
