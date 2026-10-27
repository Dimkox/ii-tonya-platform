import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  OutboxLeaseLostError,
  PostgresOutboxRepository,
} from "../../packages/db/src/index.js";
import { sql } from "drizzle-orm";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";
import { runOutboxBatch } from "../../packages/worker/src/outbox-runner.js";
import { LOCAL_OPERATOR_CASE_OUTBOX_TOPICS } from "../../packages/worker/src/local-operator-case-outbox.js";
import { randomUUID } from "node:crypto";
import { CLIENT_ASYNC_OUTBOX_TOPICS } from "../../packages/contracts/src/client-consent-authority.js";
import {
  seedClientConsent,
  seedClientRequestStarted,
} from "../../packages/db/src/testkit/client-consent.js";
import { PostgresHybridMessageRepository } from "../../packages/db/src/repositories/hybrid-message-repository.js";
import { PostgresSelartiProposalRepository } from "../../packages/db/src/repositories/selarti-proposal-repository.js";
import { PostgresB2SensitiveRetentionRepository } from "../../packages/db/src/repositories/b2-sensitive-retention-repository.js";
import { createClientDispatchAdmissionGate } from "../../packages/db/src/repositories/client-consent-authority.js";
import { createClientAsyncOutboxRegistry } from "../../apps/worker/src/client-async-outbox.js";
import {
  PostgresAdminApprovalRepository,
  selartiBudgetPolicyApprovalPayload,
} from "../../packages/db/src/index.js";
import {
  PostgresSelartiBudgetRepository,
  reserveSelartiCost,
} from "../../packages/db/src/repositories/selarti-budget-repository.js";
import { PostgresTestExpertTelegramRepository } from "../../packages/db/src/repositories/test-expert-telegram-repository.js";
import { composeB2TelegramDelivery } from "../../apps/worker/src/main.js";

async function reviewBudget() {
  const requester = await testDb.createUser(),
    approver = await testDb.createUser(),
    expertUser = await testDb.createUser();
  const policyId = randomUUID(),
    approvalId = randomUUID(),
    tariffId = randomUUID(),
    expertId = randomUUID();
  for (const [id, session] of [
    [requester, "review-requester"],
    [approver, "review-approver"],
  ]) {
    await testDb.db.execute(
      sql`insert into admin_sessions(session_id_hash,admin_id,mfa_verified_at,expires_at) values(${session!},${id!}::uuid,clock_timestamp(),clock_timestamp()+interval '1 hour')`,
    );
    await testDb.db.execute(
      sql`insert into admin_role_assignments(admin_id,role) values(${id!}::uuid,'security_admin')`,
    );
  }
  await testDb.db.execute(
    sql`insert into experts(id,user_id,active,verified) values(${expertId}::uuid,${expertUser}::uuid,true,true)`,
  );
  await testDb.db.execute(
    sql`insert into admin_approvals(id,action,object_type,object_id,requester_id,requester_session_id_hash,payload_hash,required_role,requester_mfa_verified_at,expires_at,nonce) values(${approvalId}::uuid,'expert_residency.tariff_create','expert_residency_tariff_version',${tariffId}::uuid,${requester}::uuid,'review-requester','sha256:synthetic','entitlement_admin',now(),now()+interval '1 hour','review-tariff')`,
  );
  await testDb.db.execute(
    sql`insert into expert_residency_tariff_versions(id,tariff_key,display_name,price_minor,currency,duration_seconds,active_from,active_to,approval_id,admin_session_id_hash) values(${tariffId}::uuid,'review','Synthetic',590000,'RUB',2592000,clock_timestamp()-interval '1 day',clock_timestamp()+interval '31 days',${approvalId}::uuid,'review-requester')`,
  );
  await testDb.db.execute(
    // All three settlement timestamps share one SQL instant and an exact 30-day duration.
    sql`insert into expert_residency_orders(expert_id,tariff_version_id,snapshot_display_name,price_minor,currency,duration_seconds,credit_minor,cash_minor,payment_deadline,provider_deadline,idempotency_key,status,settled_at,residency_starts_at,residency_ends_at) values(${expertId}::uuid,${tariffId}::uuid,'Synthetic',590000,'RUB',2592000,0,590000,now()+interval '1 hour',now()+interval '2 hours','review-revenue','settled',now()-interval '1 hour',now()-interval '1 hour',now()-interval '1 hour'+interval '30 days')`,
  );
  await testDb.db.execute(
    sql`insert into admin_object_assignments(admin_id,object_type,object_id) values(${requester}::uuid,'selarti_budget_policy',${policyId}::uuid)`,
  );
  const approvals = new PostgresAdminApprovalRepository(testDb.db);
  const payload = selartiBudgetPolicyApprovalPayload({
    version: 1,
    status: "approved",
    effectiveFrom: "2026-08-01T00:00:00.000Z",
    effectiveTo: null,
    globalCapRubMinor: 1704n,
    globalWarningRubMinor: 568n,
    globalSoftRubMinor: 1704n,
    perUserWarningRubMinor: 568n,
    perUserSoftRubMinor: 1200n,
    perUserHardRubMinor: 1704n,
    officialUsdRubQuoteMicros: 85954100n,
    selartiUpliftBps: 1000,
    usdMicrosPerRequest: 0n,
    usdMicrosPerUnit: 30000n,
    worstCaseBillableUnits: 2n,
    rateVersion: "synthetic",
    modelVersion: "synthetic",
    stressInflationBps: 6000,
  });
  const pending = await approvals.requestApproval({
    sessionIdHash: "review-requester",
    action: "selarti_budget.policy_approve",
    objectType: "selarti_budget_policy",
    objectId: policyId,
    payload,
    nonce: "review-policy",
  });
  expect(pending).not.toBeNull();
  expect(
    await approvals.approveApproval({
      approvalId: pending!.approvalId,
      sessionIdHash: "review-approver",
    }),
  ).toBe(true);
  await testDb.db.execute(
    sql`insert into selarti_budget_policies(id,version,status,effective_from,global_cap_rub_minor,global_warning_rub_minor,global_soft_rub_minor,per_user_warning_rub_minor,per_user_soft_rub_minor,per_user_hard_rub_minor,official_usd_rub_quote_micros,usd_micros_per_request,usd_micros_per_unit,worst_case_billable_units,rate_version,model_version,approval_id) values(${policyId}::uuid,1,'approved','2026-08-01',1704,568,1704,568,1200,1704,85954100,0,30000,2,'synthetic','synthetic',${pending!.approvalId}::uuid)`,
  );
}

async function reserveReviewCost(f: Awaited<ReturnType<typeof reviewClient>>) {
  await reviewBudget();
  const result = await testDb.db.transaction((tx) =>
    reserveSelartiCost(tx, {
      requestId: f.requestId,
      payloadHash: "b".repeat(64),
      userId: f.userId,
      dialogueId: f.dialogueId,
      occurredAt: new Date().toISOString(),
    }),
  );
  expect(["admitted", "warning"]).toContain(result.outcome);
}

let reviewChatSequence = 10_000;
async function reviewClient(botKey = "review-bot") {
  const userId = await testDb.createUser();
  const chat = String(++reviewChatSequence);
  await testDb.db.execute(
    sql`insert into channel_identities(user_id,provider,external_id,bot_key,external_chat_id,status) values(${userId}::uuid,'telegram',${chat},${botKey},${chat},'active')`,
  );
  const messaging = await seedClientConsent(
    testDb.db,
    userId,
    "client_messaging",
  );
  const ai = await seedClientConsent(
    testDb.db,
    userId,
    "selarti_ai_processing",
  );
  const producer = new PostgresHybridMessageRepository(testDb.db);
  const input = {
    // Telegram update IDs are bot-wide, not per chat: same-bot fixtures must differ.
    updateId: BigInt(chat),
    payloadHash: "a".repeat(64),
    provider: "telegram" as const,
    botKey,
    externalUserId: chat,
    externalChatId: chat,
    text: "synthetic review",
    route: "deterministic" as const,
    routingEnabled: false,
    correlationId: chat,
    locale: "ru-RU",
    occurredAt: new Date().toISOString(),
    deadline: new Date(Date.now() + 60_000).toISOString(),
    messagingConsentPolicyVersion: "client-messaging-v1",
  };
  expect(await producer.persist(input)).toBe("claimed");
  const dialogueId = (
    await testDb.db.execute<{ id: string }>(
      sql`select id from dialogues where user_id=${userId}::uuid`,
    )
  ).rows[0]!.id;
  const requestId = `sha256:${randomUUID().replaceAll("-", "").repeat(2)}`;
  const authority = {
    v: 1,
    subjectId: userId,
    purposes: { client_messaging: messaging, selarti_ai_processing: ai },
  };
  const payload = {
    requestId,
    dialogueId,
    userId,
    text: "synthetic request",
    correlationId: chat,
    locale: "ru-RU",
    promptVersion: "fixture-v1",
    deadline: new Date(Date.now() + 60_000).toISOString(),
    consentAuthority: authority,
  };
  const request = (
    await testDb.db.execute<{ id: string }>(
      sql`insert into integration_outbox(idempotency_key,topic,payload,correlation_id,reconciliation_key,payload_hash) values(${requestId},'selarti.request.v1',${JSON.stringify(payload)}::jsonb,${chat},${requestId},${"b".repeat(64)}) returning id`,
    )
  ).rows[0]!;
  const response = {
    requestId,
    dialogueId,
    threadId: requestId,
    tenantKey: botKey,
    text: "synthetic response",
    responsePayloadHash: "c".repeat(64),
    receivedAt: new Date().toISOString(),
  };
  const accept = () =>
    new PostgresSelartiProposalRepository(testDb.db).accept(response);
  return {
    userId,
    botKey,
    dialogueId,
    requestId,
    request,
    payload,
    authority,
    producer,
    input,
    accept,
  };
}

async function holdReviewLock(query: ReturnType<typeof sql>) {
  let release!: () => void;
  let entered!: () => void;
  const ready = new Promise<void>((r) => {
    entered = r;
  });
  const held = testDb.db.transaction(async (tx) => {
    await tx.execute(query);
    entered();
    await new Promise<void>((r) => {
      release = r;
    });
  });
  await ready;
  return async () => {
    release();
    await held;
  };
}

async function claimedRequest(
  f: Awaited<ReturnType<typeof reviewClient>>,
  lease = 60_000,
) {
  const repo = new PostgresOutboxRepository(
    testDb.db,
    CLIENT_ASYNC_OUTBOX_TOPICS,
  );
  const m = (await repo.claim(20, "review-worker", lease, 3)).find(
    (m) => m.id === f.request.id,
  )!;
  expect(m).toBeDefined();
  return {
    repo,
    m,
    start: () =>
      repo.recordAttemptStarted(
        m.id,
        "review-worker",
        m.dispatchClaimToken!,
        randomUUID(),
        m.reconciliationKey,
        new Date(),
        m.attempt,
      ),
  };
}

describe("review regressions for client outbox operational boundaries", () => {
  // Owner exception 1 (logical run 4) reproduced this convoy: 0/2 free deliveries.
  // Owner exception 2 (logical run 5) passed this case; all PG authorization is exhausted.
  it("dispatches unrelated subjects while a cleanup-busy subject remains pending and later resumes without loss", async () => {
    const busy = await reviewClient();
    const free = await reviewClient("free-bot");
    const repository = new PostgresOutboxRepository(
      testDb.db,
      CLIENT_ASYNC_OUTBOX_TOPICS,
    );
    const gate = createClientDispatchAdmissionGate(testDb.db);
    const delivered: string[] = [];
    const release = await holdReviewLock(
      sql`select pg_advisory_xact_lock(hashtextextended(${busy.userId}::uuid::text,0))`,
    );
    const run = () =>
      runOutboxBatch({
        ...runnerDeps(
          repository,
          vi.fn(),
          vi.fn(async () => "still_unknown"),
        ),
        metrics: { record: () => undefined },
        dispatcher: {
          dispatch: async (message, admission) => {
            if (!admission) throw new Error("missing durable admission");
            expect(await gate.consume(message, admission)).toBe(true);
            delivered.push(
              (message.payload as { dialogueId: string }).dialogueId,
            );
            return { kind: "applied" };
          },
        },
      });
    const pending = run();
    let progressBeforeRelease: string[] = [];
    let busyState: { status: string; attempt: number }[] = [];
    try {
      // Observe consumer progress, not merely SKIP LOCKED/claim return values.
      for (let i = 0; i < 100 && delivered.length < 2; i++) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      progressBeforeRelease = [...delivered];
      busyState = (
        await testDb.db.execute<{ status: string; attempt: number }>(sql`
        select status,attempt from integration_outbox where payload->>'dialogueId'=${busy.dialogueId} order by id`)
      ).rows;
    } finally {
      await release();
      await pending;
    }
    expect(progressBeforeRelease).toEqual([free.dialogueId, free.dialogueId]);
    expect(busyState).toEqual([
      { status: "pending", attempt: 0 },
      { status: "pending", attempt: 0 },
    ]);
    await run();
    expect(delivered.filter((id) => id === busy.dialogueId)).toHaveLength(2);
    expect(delivered.filter((id) => id === free.dialogueId)).toHaveLength(2);
    expect(
      (
        await testDb.db.execute<{ n: number }>(
          sql`select count(*)::int n from integration_outbox where status<>'succeeded'`,
        )
      ).rows[0]!.n,
    ).toBe(0);
  });
  // Final PG run: all six failed fixture setup before lock/behavior assertions.
  // Synthetic fixture update-ID collision corrected; post-claim behavior remains UNVERIFIED.
  it.each([
    { metrics: false, lock: "subject" },
    { metrics: true, lock: "subject" },
    { metrics: false, lock: "authority" },
    { metrics: true, lock: "authority" },
    { metrics: false, lock: "outbox" },
    { metrics: true, lock: "outbox" },
  ] as const)(
    "defers post-claim $lock contention without lost work or spent attempts (metrics=$metrics)",
    async ({ metrics, lock }) => {
      const busy = await reviewClient();
      const free = await reviewClient();
      const foreign = await reviewClient("foreign-bot");
      await reserveReviewCost(busy);
      const reservation = (
        await testDb.db.execute(
          sql`select * from selarti_cost_reservations where request_id=${busy.requestId}`,
        )
      ).rows;
      let release: (() => Promise<void>) | undefined;
      let arm = true;
      const afterClaim = async () => {
        if (!arm) return;
        arm = false;
        release = await holdReviewLock(
          lock === "subject"
            ? sql`select pg_advisory_xact_lock(hashtextextended(${busy.userId}::uuid::text,0))`
            : lock === "authority"
              ? sql`select user_id from consent_states where user_id=${busy.userId}::uuid for update`
              : sql`select id from integration_outbox where payload->>'dialogueId'=${busy.dialogueId} for update`,
        );
      };
      class ContendedRepository extends PostgresOutboxRepository {
        override async claim(
          ...args: Parameters<PostgresOutboxRepository["claim"]>
        ) {
          const messages = await super.claim(...args);
          await afterClaim();
          return messages;
        }
        override async claimWithMetrics(
          ...args: Parameters<PostgresOutboxRepository["claimWithMetrics"]>
        ) {
          const batch = await super.claimWithMetrics(...args);
          await afterClaim();
          return batch;
        }
      }
      const repository = new ContendedRepository(
        testDb.db,
        CLIENT_ASYNC_OUTBOX_TOPICS,
        busy.botKey,
      );
      const gate = createClientDispatchAdmissionGate(testDb.db);
      const delivered: string[] = [];
      const outcomes: string[] = [];
      const run = () =>
        runOutboxBatch({
          ...runnerDeps(
            repository,
            vi.fn(),
            vi.fn(async () => "still_unknown"),
          ),
          maxAttempts: 1,
          ...(metrics
            ? {
                metrics: {
                  record: (labels: { outcome: string }) => {
                    outcomes.push(labels.outcome);
                  },
                },
              }
            : {}),
          dispatcher: {
            dispatch: async (message, admission) => {
              if (!admission) throw new Error("missing durable admission");
              expect(await gate.consume(message, admission)).toBe(true);
              delivered.push(
                (message.payload as { dialogueId: string }).dialogueId,
              );
              return { kind: "applied" };
            },
          },
        });
      const state = async (dialogueId: string) =>
        (
          await testDb.db.execute<{ status: string; attempt: number }>(sql`
      select status,attempt from integration_outbox where payload->>'dialogueId'=${dialogueId} order by id`)
        ).rows;
      const pending = run();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          pending,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("dispatch admission convoy")),
              5_000,
            );
          }),
        ]);
        expect(delivered).toEqual([free.dialogueId, free.dialogueId]);
        // With a locked source row, release is necessarily deferred to fenced lease recovery.
        expect(await state(busy.dialogueId)).toEqual(
          Array.from({ length: 2 }, () => ({
            status: lock === "outbox" ? "processing" : "pending",
            attempt: lock === "outbox" ? 1 : 0,
          })),
        );
        await run();
        await run();
        expect(delivered).toHaveLength(2);
        expect(
          (
            await testDb.db.execute<{ n: number }>(sql`
        select count(*)::int n from delivery_attempts a join integration_outbox o on o.id=a.outbox_id
        where o.payload->>'dialogueId'=${busy.dialogueId}`)
          ).rows[0]!.n,
        ).toBe(0);
        expect(
          (
            await testDb.db.execute(
              sql`select * from selarti_cost_reservations where request_id=${busy.requestId}`,
            )
          ).rows,
        ).toEqual(reservation);
        expect(
          (
            await testDb.db.execute<{ n: number }>(
              sql`select count(*)::int n from selarti_actual_usage_facts where request_id=${busy.requestId}`,
            )
          ).rows[0]!.n,
        ).toBe(0);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        await release?.();
        await pending;
      }
      if (lock === "outbox") {
        await testDb.db
          .execute(sql`update integration_outbox set lease_until=clock_timestamp()-interval '1 second'
        where payload->>'dialogueId'=${busy.dialogueId} and status='processing'`);
        if (metrics)
          expect(
            await repository.recoverExpiredDispatchLeasesByTopic(),
          ).toEqual([]);
        else expect(await repository.recoverExpiredDispatchLeases()).toBe(0);
      }
      expect(await state(busy.dialogueId)).toEqual([
        { status: "pending", attempt: 0 },
        { status: "pending", attempt: 0 },
      ]);
      await run();
      expect(delivered.filter((id) => id === busy.dialogueId)).toHaveLength(2);
      expect(delivered.filter((id) => id === free.dialogueId)).toHaveLength(2);
      expect(await state(busy.dialogueId)).toEqual([
        { status: "succeeded", attempt: 1 },
        { status: "succeeded", attempt: 1 },
      ]);
      expect(await state(foreign.dialogueId)).toEqual([
        { status: "pending", attempt: 0 },
        { status: "pending", attempt: 0 },
      ]);
      expect(
        (
          await testDb.db.execute<{ n: number }>(
            sql`select count(*)::int n from dead_letters`,
          )
        ).rows[0]!.n,
      ).toBe(0);
      for (const falseOutcome of [
        "terminal",
        "dead_letter",
        "unknown",
        "retry",
      ])
        expect(outcomes).not.toContain(falseOutcome);
    },
    15_000,
  );

  // Static review finding, no separately executed RED: recovery-limit overflow.
  // Both API cases passed in owner exception 2; no PG invocation remains.
  it.each([false, true])(
    "preserves an unstarted backlog beyond recovery limit one until ordinary dispatch (metrics=%s)",
    async (metrics) => {
      const ours = await reviewClient();
      const foreign = await reviewClient("foreign-bot");
      const repository = new PostgresOutboxRepository(
        testDb.db,
        CLIENT_ASYNC_OUTBOX_TOPICS,
        ours.botKey,
      );
      const otherRepository = new PostgresOutboxRepository(
        testDb.db,
        CLIENT_ASYNC_OUTBOX_TOPICS,
        foreign.botKey,
      );
      expect(await repository.claim(10, "old-worker", 60_000, 1)).toHaveLength(
        2,
      );
      expect(
        await otherRepository.claim(10, "foreign-worker", 60_000, 1),
      ).toHaveLength(2);
      await testDb.db
        .execute(sql`update integration_outbox set lease_until=clock_timestamp()-interval '1 second'
        where status='processing' and payload->>'dialogueId' in (${ours.dialogueId},${foreign.dialogueId})`);
      const state = async (dialogueId: string) =>
        (
          await testDb.db.execute<{ status: string; attempt: number }>(sql`
        select status,attempt from integration_outbox where payload->>'dialogueId'=${dialogueId}`)
        ).rows
          .map((row) => `${row.status}:${row.attempt}`)
          .sort();
      const recover = async () => {
        if (metrics)
          expect(
            await repository.recoverExpiredDispatchLeasesByTopic(1),
          ).toEqual([]);
        else expect(await repository.recoverExpiredDispatchLeases(1)).toBe(0);
      };
      await recover();
      expect(await state(ours.dialogueId)).toEqual([
        "pending:0",
        "processing:1",
      ]);
      expect(await state(foreign.dialogueId)).toEqual([
        "processing:1",
        "processing:1",
      ]);
      expect(
        (
          await testDb.db.execute<{ n: number }>(
            sql`select count(*)::int n from delivery_attempts`,
          )
        ).rows[0]!.n,
      ).toBe(0);
      await recover();
      expect(await state(ours.dialogueId)).toEqual(["pending:0", "pending:0"]);
      expect(
        (
          await testDb.db.execute<{ n: number }>(
            sql`select count(*)::int n from delivery_attempts`,
          )
        ).rows[0]!.n,
      ).toBe(0);
      const gate = createClientDispatchAdmissionGate(testDb.db);
      const delivered: string[] = [];
      const run = () =>
        runOutboxBatch({
          ...runnerDeps(
            repository,
            vi.fn(),
            vi.fn(async () => "still_unknown"),
          ),
          batchSize: 1,
          maxAttempts: 1,
          ...(metrics ? { metrics: { record: () => undefined } } : {}),
          dispatcher: {
            dispatch: async (message, admission) => {
              if (!admission) throw new Error("missing durable admission");
              expect(await gate.consume(message, admission)).toBe(true);
              delivered.push(message.id);
              return { kind: "applied" };
            },
          },
        });
      await run();
      await run();
      await run();
      expect(delivered).toHaveLength(2);
      expect(new Set(delivered).size).toBe(2);
      expect(await state(ours.dialogueId)).toEqual([
        "succeeded:1",
        "succeeded:1",
      ]);
      expect(await state(foreign.dialogueId)).toEqual([
        "processing:1",
        "processing:1",
      ]);
      expect(
        (
          await testDb.db.execute<{ outcome: string; n: number }>(sql`
        select outcome,count(*)::int n from delivery_attempts group by outcome order by outcome`)
        ).rows,
      ).toEqual([
        { outcome: "dispatch_consumed", n: 2 },
        { outcome: "started", n: 2 },
      ]);
      expect(
        (
          await testDb.db.execute<{ n: number }>(
            sql`select count(*)::int n from dead_letters`,
          )
        ).rows[0]!.n,
      ).toBe(0);
    },
  );

  // Both API cases passed in owner exception 2: no-start recovery preserves real starts.
  it.each([false, true])(
    "preserves started client uncertainty during recovery (metrics=%s)",
    async (metrics) => {
      const f = await reviewClient();
      await reserveReviewCost(f);
      const c = await claimedRequest(f);
      expect(await c.start()).toMatchObject({ kind: "admitted" });
      await testDb.db.execute(
        sql`update integration_outbox set lease_until=clock_timestamp()-interval '1 second' where id=${c.m.id}::uuid`,
      );
      if (metrics)
        expect(await c.repo.recoverExpiredDispatchLeasesByTopic()).toEqual([
          { topic: "selarti.request.v1", count: 1 },
        ]);
      else expect(await c.repo.recoverExpiredDispatchLeases()).toBe(1);
      expect(
        (
          await testDb.db.execute(
            sql`select status,attempt from integration_outbox where id=${c.m.id}::uuid`,
          )
        ).rows,
      ).toEqual([{ status: "unknown_outcome", attempt: 1 }]);
      expect(
        (
          await testDb.db.execute<{ outcome: string }>(
            sql`select outcome from delivery_attempts where outbox_id=${c.m.id}::uuid order by created_at`,
          )
        ).rows.map((row) => row.outcome),
      ).toEqual(["started", "unknown_outcome"]);
      expect(
        (
          await testDb.db.execute<{ n: number }>(
            sql`select count(*)::int n from selarti_cost_reservations where request_id=${f.requestId}`,
          )
        ).rows[0]!.n,
      ).toBe(1);
      expect(
        (
          await testDb.db.execute<{ n: number }>(
            sql`select count(*)::int n from selarti_actual_usage_facts where request_id=${f.requestId}`,
          )
        ).rows[0]!.n,
      ).toBe(0);
    },
  );

  it("honors authoritative budget nonapplication and rejects the inverse contradiction without inventing usage", async () => {
    const f = await reviewClient();
    await reserveReviewCost(f);
    await seedClientRequestStarted(testDb.db, f.requestId);
    const budget = new PostgresSelartiBudgetRepository(testDb.db);
    expect(
      await budget.recordOutcome({
        requestId: f.requestId,
        factId: "review-not-applied",
        outcome: "not_applied",
      }),
    ).toBe("recorded");
    expect(await f.accept()).toBe("late");
    expect(
      (
        await testDb.db.execute<{ n: number }>(
          sql`select count(*)::int n from selarti_response_proposals`,
        )
      ).rows[0]!.n,
    ).toBe(0);
  });

  it("serializes accepted replies with budget outcomes on the existing request barrier", async () => {
    const f = await reviewClient();
    await reserveReviewCost(f);
    await seedClientRequestStarted(testDb.db, f.requestId);
    const release = await holdReviewLock(
      sql`select pg_advisory_xact_lock(hashtextextended(${f.requestId},0))`,
    );
    let completed = false;
    const accepting = f.accept().then((result) => {
      completed = true;
      return result;
    });
    await new Promise((r) => setTimeout(r, 80));
    const beforeRelease = completed;
    await release();
    expect(await accepting).toBe("accepted");
    expect(beforeRelease).toBe(false);
    expect(
      await new PostgresSelartiBudgetRepository(testDb.db).recordOutcome({
        requestId: f.requestId,
        factId: "contradictory",
        outcome: "not_applied",
      }),
    ).toBe("conflict");
    expect(
      (
        await testDb.db.execute<{ n: number }>(
          sql`select count(*)::int n from selarti_actual_usage_facts`,
        )
      ).rows[0]!.n,
    ).toBe(0);
  });

  it("runs real residual production through combined metrics, persisted receipt, synthetic transport and response reconciliation", async () => {
    const f = await reviewClient();
    await reviewBudget();
    // Remove only the synthetic request fixture; this test's request must come from enqueueResidual.
    await testDb.db.execute(
      sql`delete from integration_outbox where id=${f.request.id}::uuid`,
    );
    const prompt = randomUUID(),
      campaign = randomUUID(),
      session = randomUUID();
    await testDb.db.execute(
      sql`insert into test_expert_prompt_assets(id,asset_key,version,sha256,source_path,official_contract_evidence) values(${prompt}::uuid,'review',1,${"f".repeat(64)},'synthetic-fixture','synthetic-local-only')`,
    );
    await testDb.db.execute(
      sql`update test_expert_prompt_assets set status='approved' where id=${prompt}::uuid`,
    );
    await testDb.db.execute(
      sql`insert into test_expert_campaign_versions(id,code,version,prompt_asset_id,prompt_asset_version,effective_from) values(${campaign}::uuid,'test-expert',1,${prompt}::uuid,1,clock_timestamp()-interval '1 day')`,
    );
    await testDb.db.execute(
      sql`update test_expert_campaign_versions set status='active' where id=${campaign}::uuid`,
    );
    await testDb.db.execute(
      sql`insert into test_expert_sessions(id,user_id,dialogue_id,bot_key,external_chat_id,state,name_digest,specialization_digest,segment,copy_version) values(${session}::uuid,${f.userId}::uuid,${f.dialogueId}::uuid,${f.botKey},${f.input.externalChatId},'ready',${"a".repeat(64)},${"b".repeat(64)},'EXPERT','fixture-v1')`,
    );
    const producer = new PostgresTestExpertTelegramRepository(testDb.db, {
      messagingConsentPolicyVersion: "client-messaging-v1",
      selartiConsentPolicyVersion: "selarti-ai-v1",
    });
    const input = {
      botKey: f.botKey,
      telegramUserId: f.input.externalUserId,
      chatId: f.input.externalChatId,
      userId: f.userId,
      sessionId: session,
      expectedSessionVersion: 1,
      text: "synthetic residual",
      providerCalls: 1 as const,
      requestKey: "real-residual",
      requestDigest: "9".repeat(64),
      correlationId: "residual",
      occurredAt: new Date().toISOString(),
    };
    // Missing two-purpose authority must fail before trial/cost reservations or content.
    await testDb.db.execute(
      sql`delete from consent_states where user_id=${f.userId}::uuid and purpose='selarti_ai_processing'`,
    );
    await expect(producer.enqueueResidual(input)).rejects.toThrow(
      "test_expert_consent_denied",
    );
    expect(
      (
        await testDb.db.execute<{ n: number }>(
          sql`select count(*)::int n from test_expert_reservations`,
        )
      ).rows[0]!.n,
    ).toBe(0);
    const ai = await seedClientConsent(
      testDb.db,
      f.userId,
      "selarti_ai_processing",
    );
    const result = await producer.enqueueResidual(input);
    expect(result.kind).toBe("pending");
    const request = (
      await testDb.db.execute<{
        id: string;
        payload: Record<string, unknown>;
        requestId: string;
      }>(
        sql`select id,payload,reconciliation_key "requestId" from integration_outbox where topic='selarti.request.v1'`,
      )
    ).rows[0]!;
    expect(request.payload.consentAuthority).toEqual({
      ...f.authority,
      purposes: { ...f.authority.purposes, selarti_ai_processing: ai },
    });
    let calls = 0;
    const registry = createClientAsyncOutboxRegistry(
      testDb.db,
      f.botKey,
      {
        telegram: {
          transport: {
            request: async () => ({
              status: 200,
              body: { ok: true, result: { message_id: 1 } },
            }),
          },
          sendMessageUrl: new URL("https://invalid.test"),
        },
        selarti: {
          request: async (p) => {
            calls++;
            expect(p).not.toHaveProperty("consentAuthority");
            return {
              kind: "unknown_outcome",
              reconciliationKey: p.requestId,
              reasonCode: "synthetic_timeout",
            };
          },
        },
      },
      true,
    );
    await composeB2TelegramDelivery(
      testDb.db,
      true,
      { enabled: true },
      registry,
    )!.run();
    expect(calls).toBe(1);
    expect(
      (
        await testDb.db.execute<{ n: number }>(
          sql`select count(*)::int n from delivery_attempts where outbox_id=${request.id}::uuid and outcome='dispatch_consumed'`,
        )
      ).rows[0]!.n,
    ).toBe(1);
    expect(
      await new PostgresSelartiProposalRepository(testDb.db).accept({
        requestId: request.requestId,
        threadId: request.requestId,
        dialogueId: f.dialogueId,
        tenantKey: f.botKey,
        text: "synthetic accepted",
        responsePayloadHash: "d".repeat(64),
        receivedAt: new Date().toISOString(),
      }),
    ).toBe("accepted");
    await composeB2TelegramDelivery(
      testDb.db,
      true,
      { enabled: true },
      registry,
    )!.run();
    expect(calls).toBe(1);
    expect(await testDb.outboxStatus(request.id)).toBe("succeeded");
    expect(
      (
        await testDb.db.execute<{ consumed: number; reserved: number }>(
          sql`select consumed_units consumed,reserved_units reserved from test_expert_redemptions`,
        )
      ).rows[0],
    ).toEqual({ consumed: 2, reserved: 0 });
  });
  it("terminalizes malformed derived authority without poisoning the cleanup batch and reports exact counts", async () => {
    const f = await reviewClient();
    await seedClientRequestStarted(testDb.db, f.requestId);
    expect(await f.accept()).toBe("accepted");
    await testDb.db.execute(
      sql`update integration_outbox set payload=payload-'consentAuthority' where topic='telegram.send_text.v1' and dialogue_sequence=2`,
    );
    const batch = await new PostgresOutboxRepository(
      testDb.db,
      CLIENT_ASYNC_OUTBOX_TOPICS,
    ).claimWithMetrics(20, "review-worker", 60_000, 3);
    expect(batch).toMatchObject({
      authorityInvalid: [{ topic: "telegram.send_text.v1", count: 1 }],
    });
    expect(
      (
        await testDb.db.execute<{ n: number }>(
          sql`select count(*)::int n from dead_letters where reason='client_authority_invalid'`,
        )
      ).rows[0]!.n,
    ).toBe(1);
  });

  it("keeps a derived reply admissible after prompt redaction with only original digest retained", async () => {
    const f = await reviewClient();
    await seedClientRequestStarted(testDb.db, f.requestId);
    expect(await f.accept()).toBe("accepted");
    await testDb.db.execute(
      sql`update integration_outbox set status='succeeded' where id=${f.request.id}::uuid or (topic='telegram.send_text.v1' and dialogue_sequence=1)`,
    );
    await new PostgresB2SensitiveRetentionRepository(testDb.db).purgeExpired(
      new Date(),
      100,
    );
    const parent = (
      await testDb.db.execute<{ payload: Record<string, unknown> }>(
        sql`select payload from integration_outbox where id=${f.request.id}::uuid`,
      )
    ).rows[0]!.payload;
    expect(Object.keys(parent).sort()).toEqual([
      "consentAuthorityDigest",
      "redacted",
    ]);
    expect(parent).not.toHaveProperty("text");
    const repo = new PostgresOutboxRepository(
      testDb.db,
      CLIENT_ASYNC_OUTBOX_TOPICS,
    );
    const reply = (await repo.claim(10, "review-worker", 60_000, 3))[0]!;
    expect(reply?.topic).toBe("telegram.send_text.v1");
    expect(
      await repo.recordAttemptStarted(
        reply.id,
        "review-worker",
        reply.dispatchClaimToken!,
        "retained-binding",
        reply.reconciliationKey,
        new Date(),
        reply.attempt,
      ),
    ).toMatchObject({ kind: "admitted" });
  });

  it("rechecks request deadline after waiting for authority rows", async () => {
    const f = await reviewClient();
    await testDb.db.execute(
      sql`update integration_outbox set payload=jsonb_set(payload,'{deadline}',to_jsonb((clock_timestamp()+interval '400 milliseconds')::text)) where id=${f.request.id}::uuid`,
    );
    const c = await claimedRequest(f);
    const release = await holdReviewLock(
      sql`select user_id from consent_states where user_id=${f.userId}::uuid for update`,
    );
    const pending = c.start();
    await new Promise((r) => setTimeout(r, 600));
    await release();
    expect(await pending).toMatchObject({ kind: "blocked" });
    expect(
      (
        await testDb.db.execute<{ n: number }>(
          sql`select count(*)::int n from delivery_attempts where outbox_id=${c.m.id}::uuid and outcome='started'`,
        )
      ).rows[0]!.n,
    ).toBe(0);
  });

  it("rechecks dispatch lease after waiting for authority rows", async () => {
    const f = await reviewClient();
    const c = await claimedRequest(f, 400);
    const release = await holdReviewLock(
      sql`select user_id from consent_states where user_id=${f.userId}::uuid for update`,
    );
    const pending = c.start().then(
      (value) => value,
      (error: unknown) => error,
    );
    await new Promise((r) => setTimeout(r, 600));
    await release();
    expect(await pending).toBeInstanceOf(OutboxLeaseLostError);
  });

  it("rechecks receipt lease after a row-lock wait without consuming or sending", async () => {
    const f = await reviewClient();
    const c = await claimedRequest(f, 500);
    const receipt = await c.start();
    if (receipt?.kind !== "admitted")
      throw new Error("fixture admission missing");
    const release = await holdReviewLock(
      sql`select id from integration_outbox where id=${c.m.id}::uuid for update`,
    );
    const pending = createClientDispatchAdmissionGate(testDb.db).consume(
      c.m,
      receipt,
    );
    await new Promise((r) => setTimeout(r, 650));
    await release();
    expect(await pending).toBe(false);
    expect(
      (
        await testDb.db.execute<{ n: number }>(
          sql`select count(*)::int n from delivery_attempts where outbox_id=${c.m.id}::uuid and outcome='dispatch_consumed'`,
        )
      ).rows[0]!.n,
    ).toBe(0);
  });

  it("terminalizes invalid retries with a confirmed before-write outcome instead of manufacturing unknown", async () => {
    const f = await reviewClient();
    const c = await claimedRequest(f);
    expect(await c.start()).toMatchObject({ kind: "admitted" });
    await c.repo.retry(
      c.m.id,
      "review-worker",
      c.m.dispatchClaimToken!,
      new Date(),
      "before_write",
    );
    const retry = (await c.repo.claim(20, "review-worker", 60_000, 3)).find(
      (m) => m.id === c.m.id,
    )!;
    await testDb.db.execute(
      sql`delete from consent_states where user_id=${f.userId}::uuid`,
    );
    expect(
      await c.repo.recordAttemptStarted(
        retry.id,
        "review-worker",
        retry.dispatchClaimToken!,
        "blocked-retry",
        retry.reconciliationKey,
        new Date(),
        retry.attempt,
      ),
    ).toMatchObject({ kind: "blocked" });
    expect(await testDb.outboxStatus(retry.id)).toBe("dead_letter");
    expect(
      (
        await testDb.db.execute<{ n: number }>(
          sql`select count(*)::int n from delivery_attempts where outbox_id=${retry.id}::uuid and outcome='not_applied'`,
        )
      ).rows[0]!.n,
    ).toBeGreaterThan(0);
  });

  it("scopes combined claims, cleanup and recovery to the configured bot", async () => {
    const ours = await reviewClient();
    const other = await reviewClient("other-bot");
    await testDb.db.execute(
      sql`update integration_outbox set status='processing',attempt=1,dispatch_owner_id='other',dispatch_claim_token='other',lease_until=clock_timestamp()-interval '1 second' where id=${other.request.id}::uuid`,
    );
    // The third argument is the reviewed production bot capability, not a payload hint.
    const repo = new PostgresOutboxRepository(
      testDb.db,
      CLIENT_ASYNC_OUTBOX_TOPICS,
      "review-bot",
    );
    expect(await repo.recoverExpiredDispatchLeasesByTopic(100)).toEqual([]);
    const batch = await repo.claimWithMetrics(100, "review-worker", 60_000, 3);
    expect(
      batch.messages.map(
        (m) => (m.payload as { dialogueId: string }).dialogueId,
      ),
    ).toEqual([ours.dialogueId, ours.dialogueId]);
    expect(await testDb.outboxStatus(other.request.id)).toBe("processing");
  });

  it("skips busy cleanup subjects so unrelated messages remain claimable", async () => {
    const busy = await reviewClient();
    const free = await reviewClient("free-bot");
    const release = await holdReviewLock(
      sql`select pg_advisory_xact_lock(hashtextextended(${busy.userId}::uuid::text,0))`,
    );
    let finished = false;
    const pending = new PostgresOutboxRepository(
      testDb.db,
      CLIENT_ASYNC_OUTBOX_TOPICS,
    )
      .claimWithMetrics(100, "review-worker", 60_000, 3)
      .then((batch) => {
        finished = true;
        return batch;
      });
    await new Promise((r) => setTimeout(r, 200));
    const completedBeforeUnlock = finished;
    await release();
    const batch = await pending;
    expect(completedBeforeUnlock).toBe(true);
    expect(batch.messages.some((m) => m.id === free.request.id)).toBe(true);
  });

  it("combined metrics claims preserve an unresolved sequence-one barrier", async () => {
    const f = await reviewClient();
    expect(
      await f.producer.persist({
        ...f.input,
        updateId: 2n,
        payloadHash: "e".repeat(64),
      }),
    ).toBe("claimed");
    const repo = new PostgresOutboxRepository(
      testDb.db,
      CLIENT_ASYNC_OUTBOX_TOPICS,
    );
    const first = await repo.claimWithMetrics(100, "review-worker", 60_000, 3);
    expect(
      first.messages.filter((m) => m.topic === "telegram.send_text.v1"),
    ).toHaveLength(1);
    expect(
      (await repo.claimWithMetrics(100, "review-worker", 60_000, 3)).messages,
    ).toHaveLength(0);
  });

  it("reconciles persisted response evidence after redaction without sending content", async () => {
    const f = await reviewClient();
    await seedClientRequestStarted(testDb.db, f.requestId);
    expect(await f.accept()).toBe("accepted");
    await testDb.db.execute(
      sql`update integration_outbox set status='succeeded' where id=${f.request.id}::uuid`,
    );
    await new PostgresB2SensitiveRetentionRepository(testDb.db).purgeExpired(
      new Date(),
      100,
    );
    const registry = createClientAsyncOutboxRegistry(
      testDb.db,
      "review-bot",
      {
        telegram: {
          transport: {
            request: async () => {
              throw new Error("no transport");
            },
          },
          sendMessageUrl: new URL("https://invalid.test"),
        },
        selarti: {
          request: async () => {
            throw new Error("no transport");
          },
        },
      },
      true,
    );
    const message = {
      id: f.request.id,
      topic: "selarti.request.v1",
      payload: { redacted: true },
      correlationId: "review",
      attempt: 1,
      reconciliationKey: f.requestId,
      reconciliationAttempt: 1,
      dispatchClaimToken: null,
      reconciliationClaimToken: "r",
    };
    expect(await registry.reconcile(message)).toBe("applied");
  });
});

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await startTestPostgres();
  await testDb.migrate();
}, 120_000);
beforeEach(async () => testDb.reset());
afterAll(async () => testDb?.stop(), 120_000);

const runnerDeps = (
  repository: PostgresOutboxRepository,
  dispatch: ReturnType<typeof vi.fn>,
  reconcile: ReturnType<typeof vi.fn>,
  now = new Date(),
) => ({
  repository,
  dispatcher: { dispatch },
  reconciler: { reconcile },
  now: () => now,
  retryDelayMs: () => 1_000,
  maxAttempts: 3,
  maxReconciliationAttempts: 2,
  batchSize: 10,
  workerId: "worker-budget",
  newAttemptId: () => "attempt-test",
});

describe("PostgreSQL unknown-outcome lifecycle", () => {
  it("filters claims, exhaustion and expired recovery to the registered local topics", async () => {
    const repository = new PostgresOutboxRepository(
      testDb.db,
      LOCAL_OPERATOR_CASE_OUTBOX_TOPICS,
    );
    const localPending = await testDb.insertOutbox({
      topic: "safety.operator_escalation",
      reconciliationKey: "local:safety-pending",
    });
    const localRetry = await testDb.insertOutbox({
      topic: "admin.negative_feedback",
      reconciliationKey: "local:feedback-retry",
    });
    await testDb.db.execute(sql`
      update integration_outbox
      set status='retry_wait',next_attempt_at=clock_timestamp()-interval '1 second'
      where id=${localRetry}::uuid
    `);
    const localUnknown = await testDb.insertUnknownOutbox({
      attempt: 1,
      reconciliationAttempt: 0,
      reconciliationKey: "local:safety-unknown",
    });
    await testDb.db.execute(sql`
      update integration_outbox
      set topic='safety.operator_escalation'
      where id=${localUnknown}::uuid
    `);

    const providerPending = await testDb.insertOutbox({
      topic: "provider.pending",
      reconciliationKey: "provider:pending",
    });
    const providerRetry = await testDb.insertOutbox({
      topic: "provider.retry",
      reconciliationKey: "provider:retry",
    });
    const providerUnknown = await testDb.insertUnknownOutbox({
      attempt: 1,
      reconciliationAttempt: 0,
      reconciliationKey: "provider:unknown",
    });
    const providerProcessing = await testDb.insertOutbox({
      topic: "provider.processing",
      reconciliationKey: "provider:processing",
    });
    const providerReconciling = await testDb.insertUnknownOutbox({
      attempt: 1,
      reconciliationAttempt: 1,
      reconciliationKey: "provider:reconciling",
    });
    const providerDispatchExhausted = await testDb.insertOutbox({
      topic: "provider.exhausted",
      reconciliationKey: "provider:dispatch-exhausted",
      attempt: 3,
    });
    const providerReconciliationExhausted = await testDb.insertUnknownOutbox({
      attempt: 1,
      reconciliationAttempt: 2,
      reconciliationKey: "provider:reconciliation-exhausted",
    });
    await testDb.db.execute(sql`
      update integration_outbox set
        status='retry_wait',next_attempt_at=clock_timestamp()-interval '1 second'
      where id=${providerRetry}::uuid
    `);
    await testDb.db.execute(sql`
      update integration_outbox set
        status='processing',attempt=1,dispatch_owner_id='provider-worker',
        dispatch_claim_token='provider-dispatch-token',
        lease_until=clock_timestamp()-interval '1 second'
      where id=${providerProcessing}::uuid
    `);
    await testDb.db.execute(sql`
      update integration_outbox set
        status='reconciling',reconciliation_owner_id='provider-worker',
        reconciliation_claim_token='provider-reconciliation-token',
        reconciliation_lease_until=clock_timestamp()-interval '1 second'
      where id=${providerReconciling}::uuid
    `);

    await expect(repository.recoverExpiredDispatchLeases()).resolves.toBe(0);
    await expect(repository.recoverExpiredReconciliationLeases()).resolves.toBe(
      0,
    );
    await expect(
      repository.claimUnknown(10, "local-reconciler", 30_000, 2),
    ).resolves.toEqual([expect.objectContaining({ id: localUnknown })]);
    await expect(
      repository.claim(10, "local-dispatcher", 30_000, 3),
    ).resolves.toEqual([
      expect.objectContaining({ id: localPending }),
      expect.objectContaining({ id: localRetry }),
    ]);

    for (const [id, status] of [
      [providerPending, "pending"],
      [providerRetry, "retry_wait"],
      [providerUnknown, "unknown_outcome"],
      [providerProcessing, "processing"],
      [providerReconciling, "reconciling"],
      [providerDispatchExhausted, "pending"],
      [providerReconciliationExhausted, "unknown_outcome"],
    ] as const) {
      await expect(testDb.outboxStatus(id)).resolves.toBe(status);
    }
  });

  it("fences terminal reconciliation into one dead letter and bounded operator case", async () => {
    const repository = new PostgresOutboxRepository(
      testDb.db,
      LOCAL_OPERATOR_CASE_OUTBOX_TOPICS,
    );
    const id = await testDb.insertUnknownOutbox({
      attempt: 1,
      reconciliationAttempt: 0,
      reconciliationKey: "local:terminal",
    });
    await testDb.db.execute(sql`
      update integration_outbox
      set topic='admin.negative_feedback'
      where id=${id}::uuid
    `);
    const reconcile = vi.fn(async () => ({
      kind: "terminal" as const,
      reasonCode: "local_source_invalid" as const,
    }));

    await runOutboxBatch(runnerDeps(repository, vi.fn(), reconcile));

    expect(await testDb.outboxStatus(id)).toBe("dead_letter");
    expect(await testDb.deadLetterReasons(id)).toEqual([
      "local_source_invalid",
    ]);
    expect(await testDb.ownerAlertReasons(id)).toEqual([
      "local_source_invalid",
    ]);
    const cases = await testDb.db.execute<{
      count: string;
      caseType: string;
      caseReasonCode: string;
    }>(sql`
      select count(*)::text as count,
        min(case_type) as "caseType",
        min(case_reason_code) as "caseReasonCode"
      from outbox_operator_alerts
      where outbox_id=${id}::uuid
    `);
    expect(cases.rows[0]).toEqual({
      count: "1",
      caseType: "delivery_failure",
      caseReasonCode: "delivery_failure",
    });
    expect(reconcile).toHaveBeenCalledOnce();
  });

  it("round-trips the reconciliation key and recovers a crashed reconciliation lease", async () => {
    const now = new Date();
    const repository = new PostgresOutboxRepository(testDb.db);
    const id = await testDb.insertOutbox({
      topic: "planerka.reserve",
      reconciliationKey: "reservation:provider-key-1",
    });
    const [claimed] = await repository.claim(1, "dispatch-a", 30_000, 3);
    await repository.recordAttemptStarted(
      id,
      "dispatch-a",
      claimed!.dispatchClaimToken!,
      "attempt-1",
      claimed!.reconciliationKey,
      now,
    );
    await repository.markUnknownOutcome(
      id,
      "dispatch-a",
      claimed!.dispatchClaimToken!,
      "attempt-1",
      "reservation:provider-key-1",
      "response_timeout",
    );
    const [firstReconciliation] = await repository.claimUnknown(
      1,
      "reconciler-a",
      30_000,
      3,
    );
    expect(firstReconciliation).toMatchObject({
      id,
      reconciliationKey: "reservation:provider-key-1",
      reconciliationAttempt: 1,
    });

    await testDb.expireReconciliationLease(id);
    expect(await repository.recoverExpiredReconciliationLeases()).toBe(1);
    const [recovered] = await repository.claimUnknown(
      1,
      "reconciler-b",
      30_000,
      3,
    );
    expect(recovered).toMatchObject({
      id,
      reconciliationKey: "reservation:provider-key-1",
      reconciliationAttempt: 2,
    });
  });

  it("turns an expired dispatch lease into unknown outcome before any resend", async () => {
    const repository = new PostgresOutboxRepository(testDb.db);
    const id = await testDb.insertOutbox({
      topic: "selarti.send",
      reconciliationKey: "message:provider-key-1",
    });
    await repository.claim(1, "dispatch-a", 30_000, 3);

    await testDb.expireDispatchLease(id);
    expect(await repository.recoverExpiredDispatchLeases()).toBe(1);
    expect(await testDb.outboxStatus(id)).toBe("unknown_outcome");
    expect(await repository.claim(1, "must-not-resend", 30_000, 3)).toEqual([]);
  });

  it("rejects an outcome reconciliation key that differs from the stable command key", async () => {
    const now = new Date();
    const repository = new PostgresOutboxRepository(testDb.db);
    const id = await testDb.insertOutbox({
      topic: "telegram.send",
      reconciliationKey: "message:stable-key",
    });
    const [claimed] = await repository.claim(1, "dispatch-a", 30_000, 3);
    await repository.recordAttemptStarted(
      id,
      "dispatch-a",
      claimed!.dispatchClaimToken!,
      "attempt-key",
      claimed!.reconciliationKey,
      now,
    );

    await expect(
      repository.markUnknownOutcome(
        id,
        "dispatch-a",
        claimed!.dispatchClaimToken!,
        "attempt-key",
        "message:different-key",
        "response_timeout",
      ),
    ).rejects.toThrow("reconciliation key");
    expect(await testDb.outboxStatus(id)).toBe("processing");
  });

  it("rejects stale dispatch and reconciliation workers with a typed lease-lost error", async () => {
    const repository = new PostgresOutboxRepository(testDb.db);
    const id = await testDb.insertOutbox({
      topic: "selarti.send",
      reconciliationKey: "message:lease-key",
    });
    const [claimed] = await repository.claim(1, "dispatch-owner", 30_000, 3);

    await expect(
      repository.recordAttemptStarted(
        id,
        "wrong-owner",
        claimed!.dispatchClaimToken!,
        "attempt-lease",
        claimed!.reconciliationKey,
        new Date(),
      ),
    ).rejects.toBeInstanceOf(OutboxLeaseLostError);

    await repository.recordAttemptStarted(
      id,
      "dispatch-owner",
      claimed!.dispatchClaimToken!,
      "attempt-lease",
      claimed!.reconciliationKey,
      new Date(),
    );
    await testDb.expireDispatchLease(id);
    await repository.recoverExpiredDispatchLeases();
    await expect(
      repository.succeed(id, "dispatch-owner", claimed!.dispatchClaimToken!),
    ).rejects.toBeInstanceOf(OutboxLeaseLostError);
    expect(await testDb.outboxStatus(id)).toBe("unknown_outcome");

    const [unknown] = await repository.claimUnknown(
      1,
      "reconciliation-owner",
      30_000,
      3,
    );
    await expect(
      repository.succeedAfterReconciliation(
        unknown!.id,
        "wrong-owner",
        unknown!.reconciliationClaimToken!,
      ),
    ).rejects.toBeInstanceOf(OutboxLeaseLostError);
    expect(await testDb.outboxStatus(id)).toBe("reconciling");
  });

  it("terminalizes database rows already at either budget before external work", async () => {
    const repository = new PostgresOutboxRepository(testDb.db);
    const dispatch = vi.fn();
    const reconcile = vi.fn();
    const dispatchId = await testDb.insertOutbox({
      topic: "telegram.send",
      reconciliationKey: "message:dispatch-exhausted",
      attempt: 3,
    });
    const reconciliationId = await testDb.insertUnknownOutbox({
      attempt: 2,
      reconciliationAttempt: 2,
      reconciliationKey: "message:reconciliation-exhausted",
    });

    await runOutboxBatch(runnerDeps(repository, dispatch, reconcile));

    expect(dispatch).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
    expect(await testDb.outboxStatus(dispatchId)).toBe("dead_letter");
    expect(await testDb.outboxStatus(reconciliationId)).toBe("dead_letter");
    expect(await testDb.ownerAlertReasons(dispatchId)).toEqual([
      "dispatch_attempts_exhausted_before_claim",
    ]);
    expect(await testDb.ownerAlertReasons(reconciliationId)).toEqual([
      "unknown_outcome_reconciliation_exhausted_before_claim",
    ]);
  });

  it("uses the PostgreSQL clock so worker clock skew cannot recover an active lease", async () => {
    const repository = new PostgresOutboxRepository(testDb.db);
    const id = await testDb.insertOutbox({
      topic: "telegram.send",
      reconciliationKey: "message:clock-authority",
    });
    const [claimed] = await repository.claim(1, "clock-worker", 60_000, 3);
    expect(claimed).toMatchObject({
      id,
      dispatchClaimToken: expect.any(String),
    });

    expect(await repository.recoverExpiredDispatchLeases()).toBe(0);
    expect(await testDb.outboxStatus(id)).toBe("processing");
  });

  it("rejects a stale same-owner generation after recovery and reclaim", async () => {
    const repository = new PostgresOutboxRepository(testDb.db);
    const id = await testDb.insertOutbox({
      topic: "selarti.send",
      reconciliationKey: "message:generation",
    });
    const [first] = await repository.claim(1, "same-worker", 60_000, 3);
    await testDb.expireDispatchLease(id);
    expect(await repository.recoverExpiredDispatchLeases()).toBe(1);
    const [unknown] = await repository.claimUnknown(
      1,
      "same-worker",
      60_000,
      3,
    );
    await repository.retryAfterReconciliation(
      id,
      "same-worker",
      unknown!.reconciliationClaimToken!,
      new Date(),
      "reconciled_not_applied",
    );
    await testDb.makeOutboxRetryDue(id);
    const [second] = await repository.claim(1, "same-worker", 60_000, 3);
    expect(second!.dispatchClaimToken).not.toBe(first!.dispatchClaimToken);

    await expect(
      repository.succeed(id, "same-worker", first!.dispatchClaimToken!),
    ).rejects.toBeInstanceOf(OutboxLeaseLostError);
    expect(await testDb.outboxStatus(id)).toBe("processing");
    await repository.succeed(id, "same-worker", second!.dispatchClaimToken!);
    expect(await testDb.outboxStatus(id)).toBe("succeeded");
  });

  it("never retries beyond either budget and atomically alerts the owner", async () => {
    const repository = new PostgresOutboxRepository(testDb.db);
    const dispatch = vi.fn();
    const reconcile = vi.fn().mockResolvedValue("still_unknown");
    const unknownId = await testDb.insertUnknownOutbox({
      attempt: 3,
      reconciliationAttempt: 1,
      reconciliationKey: "telegram:message-2",
    });

    await runOutboxBatch(runnerDeps(repository, dispatch, reconcile));

    expect(await testDb.outboxStatus(unknownId)).toBe("dead_letter");
    expect(await testDb.ownerAlertReasons(unknownId)).toEqual([
      "unknown_outcome_reconciliation_exhausted",
    ]);
    expect(await testDb.deadLetterReasons(unknownId)).toEqual([
      "unknown_outcome_reconciliation_exhausted",
    ]);
    expect(dispatch).not.toHaveBeenCalled();

    const notAppliedId = await testDb.insertUnknownOutbox({
      attempt: 3,
      reconciliationAttempt: 0,
      reconciliationKey: "planerka:reservation-3",
    });
    reconcile.mockResolvedValueOnce("not_applied");
    await runOutboxBatch(
      runnerDeps(repository, dispatch, reconcile, new Date()),
    );
    expect(await testDb.outboxStatus(notAppliedId)).toBe("dead_letter");
    expect(await testDb.ownerAlertReasons(notAppliedId)).toEqual([
      "dispatch_attempts_exhausted_after_reconciliation",
    ]);
  });
});
