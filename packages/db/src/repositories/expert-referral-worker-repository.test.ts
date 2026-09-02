import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { DrizzleDb } from "../client.js";
import { ExpertReferralTestkit } from "../testkit/expert-referral.js";
import { startTestPostgres, type TestDatabase } from "../testkit/postgres.js";
import { verifiedEventFixture } from "../../../integrations/src/expert-residency/testing.testkit.js";
import { PostgresExpertReferralWorkerRepository } from "./expert-referral-worker-repository.js";

const dialect = new PgDialect();
const rendered = (statement: unknown): string =>
  dialect.sqlToQuery(statement as Parameters<PgDialect["sqlToQuery"]>[0]).sql;

function transactionDb(
  rowsByCall: readonly (readonly Record<string, unknown>[])[],
) {
  let call = 0;
  const execute = vi.fn(async (statement: unknown) => {
    void statement;
    return { rows: rowsByCall[call++] ?? [] };
  });
  interface FakeTransaction {
    execute: typeof execute;
    transaction(work: (nested: FakeTransaction) => unknown): Promise<unknown>;
  }
  const tx = { execute } as FakeTransaction;
  tx.transaction = async (work) => work(tx);
  const transaction = vi.fn(async (work: (input: typeof tx) => unknown) =>
    work(tx),
  );
  return {
    db: { transaction } as unknown as DrizzleDb,
    execute,
    transaction,
    tx,
  };
}

describe("expert referral worker repository", () => {
  it("claims exact-deadline orders in stable skip-locked order and delegates the locked state machine", async () => {
    const fake = transactionDb([[{ orderId: "order-1" }]]);
    const releaseExpiredOrderInTransaction = vi.fn(async () => ({
      kind: "expired" as const,
      released: true,
    }));
    const repository = new PostgresExpertReferralWorkerRepository(fake.db, {
      releaseExpiredOrderInTransaction,
      replayHeldRewardInTransaction: vi.fn(),
    });

    await expect(
      repository.expireDueBatch({
        now: new Date("2026-09-02T00:00:00.000Z"),
        batchSize: 100,
      }),
    ).resolves.toEqual({ examined: 1, changed: 1, failed: 0 });

    const claimSql = rendered(fake.execute.mock.calls[0]![0]);
    expect(claimSql).toMatch(
      /payment_deadline <= (?:transaction_timestamp\(\)|clock_timestamp\(\))/u,
    );
    expect(claimSql).toMatch(/order by payment_deadline, id/u);
    expect(claimSql).toMatch(/for update skip locked/u);
    expect(releaseExpiredOrderInTransaction).toHaveBeenCalledWith(fake.tx, {
      orderId: "order-1",
    });
  });

  it("keeps one poisoned expiry row bounded and retry-visible", async () => {
    const fake = transactionDb([
      [{ orderId: "order-1" }, { orderId: "order-2" }],
    ]);
    const releaseExpiredOrderInTransaction = vi
      .fn()
      .mockRejectedValueOnce(new Error("conflicting_state"))
      .mockResolvedValueOnce({ kind: "expired", released: false });
    const repository = new PostgresExpertReferralWorkerRepository(fake.db, {
      releaseExpiredOrderInTransaction,
      replayHeldRewardInTransaction: vi.fn(),
    });

    await expect(
      repository.expireDueBatch({
        now: new Date("2026-09-02T00:00:00.000Z"),
        batchSize: 2,
      }),
    ).resolves.toEqual({ examined: 2, changed: 1, failed: 1 });
  });

  it("claims reconciliation candidates with no network call under the database lock", async () => {
    const fake = transactionDb([
      [
        {
          attemptId: "attempt-1",
          providerPaymentId: "payment-1",
          claimedAt: "2026-09-02T00:00:00.000Z",
        },
      ],
    ]);
    const reconcile = vi.fn();
    const repository = new PostgresExpertReferralWorkerRepository(fake.db, {
      releaseExpiredOrderInTransaction: vi.fn(),
      replayHeldRewardInTransaction: vi.fn(),
    });

    await expect(
      repository.claimReconciliationBatch({
        now: new Date("2026-09-02T00:00:00.000Z"),
        batchSize: 1,
      }),
    ).resolves.toEqual([
      {
        attemptId: "attempt-1",
        providerPaymentId: "payment-1",
        claimedAt: "2026-09-02T00:00:00.000Z",
      },
    ]);
    const claimSql = rendered(fake.execute.mock.calls[0]![0]);
    expect(claimSql).toMatch(/order by .*updated_at, .*id/u);
    expect(claimSql).toMatch(/for update skip locked/u);
    expect(claimSql).toMatch(/update expert_residency_payment_attempts/u);
    expect(claimSql).toMatch(/updated_at <= .*interval '5 minutes'/u);
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("classifies a provider identity corruption with one bounded mismatch code", async () => {
    const fake = transactionDb([
      [],
      [
        {
          attemptId: randomUUID(),
          orderId: randomUUID(),
          expertId: randomUUID(),
          provider: "disabled-test",
          providerPaymentId: "payment-local",
          expectedAmountMinor: "100000",
          currency: "RUB",
          attemptStatus: "succeeded",
          orderStatus: "settled",
          reservationProjectionValid: true,
          rewardGrantProjectionValid: true,
          ledgerBalanceProjectionValid: true,
          debtProjectionValid: true,
          residencyActivationValid: true,
        },
      ],
      [],
    ]);
    const repository = new PostgresExpertReferralWorkerRepository(fake.db, {
      releaseExpiredOrderInTransaction: vi.fn(),
      replayHeldRewardInTransaction: vi.fn(),
    });
    const payloadDigest = `sha256:${"d".repeat(64)}`;
    const event = verifiedEventFixture(
      {
        kind: "settled",
        provider: "disabled-test",
        eventId: "event-identity-corruption",
        paymentId: "payment-provider",
        orderId: "00000000-0000-4000-8000-000000000777",
        amountMinor: "100000",
        currency: "RUB",
        occurredAt: "2026-09-02T00:00:00.000Z",
        payloadDigest,
      },
      {
        verificationId: "verification-identity-corruption",
        verifierKeyVersion: "test-v1",
        verifiedAt: "2026-09-02T00:00:00.000Z",
        payloadDigest,
      },
    );

    await expect(
      repository.compareAndRecordReconciliation(
        {
          attemptId: randomUUID(),
          providerPaymentId: "payment-local",
          claimedAt: "2026-09-02T00:00:00.000Z",
        },
        event,
      ),
    ).resolves.toBe("mismatch");
    const incidentQuery = dialect.sqlToQuery(
      fake.execute.mock.calls[2]![0] as Parameters<PgDialect["sqlToQuery"]>[0],
    );
    expect(incidentQuery.params).toContainEqual(
      expect.stringContaining('"mismatchCodes":["provider_identity"]'),
    );
  });

  it("replays only held markers and maps every terminal outcome to bounded counts", async () => {
    const fake = transactionDb([
      [],
      [
        { expertId: "expert-1", qualifyingOrderId: "order-1" },
        { expertId: "expert-2", qualifyingOrderId: "order-2" },
        { expertId: "expert-3", qualifyingOrderId: "order-3" },
        { expertId: "expert-4", qualifyingOrderId: "order-4" },
        { expertId: "expert-5", qualifyingOrderId: "order-5" },
        { expertId: "expert-6", qualifyingOrderId: "order-6" },
      ],
    ]);
    const replayHeldReward = vi
      .fn()
      .mockResolvedValueOnce({ kind: "reward_granted", amountMinor: "100000" })
      .mockResolvedValueOnce({ kind: "debt_repaid", amountMinor: "50000" })
      .mockResolvedValueOnce({ kind: "ineligible", reason: "state" })
      .mockResolvedValueOnce({ kind: "cancelled_by_refund" })
      .mockResolvedValueOnce({ kind: "still_held" })
      .mockRejectedValueOnce(new Error("poisoned"));
    const repository = new PostgresExpertReferralWorkerRepository(fake.db, {
      releaseExpiredOrderInTransaction: vi.fn(),
      replayHeldRewardInTransaction: replayHeldReward,
    });

    await expect(
      repository.replayDueBatch({
        now: new Date("2026-09-02T00:00:00.000Z"),
        batchSize: 6,
      }),
    ).resolves.toEqual({
      examined: 6,
      granted: 1,
      debtRepaid: 1,
      ineligible: 1,
      cancelled: 1,
      stillHeld: 1,
      failed: 1,
    });
    const claimSql = rendered(fake.execute.mock.calls[1]![0]);
    expect(claimSql).toMatch(/eligibility_status = 'pending_feature_hold'/u);
    expect(claimSql).toMatch(
      /order by marker\.settlement_sequence, marker\.id/u,
    );
    expect(claimSql).toMatch(/for update of orders skip locked/u);
    expect(replayHeldReward).toHaveBeenCalledWith(
      fake.tx,
      expect.objectContaining({ qualifyingOrderId: "order-1" }),
    );
  });

  it.each([0, 1_001])("rejects repository batch size %s", async (batchSize) => {
    const fake = transactionDb([]);
    const repository = new PostgresExpertReferralWorkerRepository(fake.db, {
      releaseExpiredOrderInTransaction: vi.fn(),
      replayHeldRewardInTransaction: vi.fn(),
    });

    await expect(
      repository.expireDueBatch({
        now: new Date("2026-09-02T00:00:00.000Z"),
        batchSize,
      }),
    ).rejects.toThrow("invalid_worker_batch_size");
    expect(fake.transaction).not.toHaveBeenCalled();
  });
});

describe("expert referral worker PostgreSQL claims", () => {
  let testDb: TestDatabase;
  let fixtures: ExpertReferralTestkit;
  let repository: PostgresExpertReferralWorkerRepository;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    await testDb.migrate();
    fixtures = new ExpertReferralTestkit(testDb.db);
    repository = new PostgresExpertReferralWorkerRepository(testDb.db);
  }, 120_000);
  beforeEach(async () => testDb.reset());
  afterAll(async () => testDb?.stop(), 120_000);

  async function seedDueOrder(): Promise<string> {
    const expert = await fixtures.createExpert();
    const tariffVersionId = randomUUID();
    const orderId = randomUUID();
    const tariffKey = `worker-expiry-${orderId}`;
    const evidence = await fixtures.createAdminEvidence(
      "expert_residency.tariff_create",
      tariffVersionId,
      {
        tariffKey,
        version: 1,
        displayName: "Worker expiry",
        description: "Exact database deadline fixture",
        priceMinor: "100000",
        durationSeconds: 86_400,
        activeFrom: "2026-01-01T00:00:00.000Z",
        activeTo: null,
      },
    );
    await testDb.db.execute(sql`
      insert into expert_residency_tariff_versions (
        id, tariff_key, version, display_name, description, price_minor,
        currency, duration_seconds, active_from, created_by_admin_id,
        approval_id, admin_session_id_hash
      ) values (
        ${tariffVersionId}::uuid, ${tariffKey}, 1, 'Worker expiry',
        'Exact database deadline fixture', 100000, 'RUB', 86400,
        '2026-01-01T00:00:00.000Z'::timestamptz, ${evidence.adminId}::uuid,
        ${evidence.approvalId}::uuid, ${evidence.sessionIdHash}
      )
    `);
    await testDb.db.execute(sql`
      insert into expert_residency_orders (
        id, expert_id, tariff_version_id, tariff_name, tariff_description,
        price_minor, currency, duration_seconds, credit_minor, cash_minor,
        payment_deadline, provider_deadline, idempotency_key, status, quoted_at
      ) values (
        ${orderId}::uuid, ${expert.expertId}::uuid, ${tariffVersionId}::uuid,
        'Worker expiry', 'Exact database deadline fixture', 100000, 'RUB',
        86400, 0, 100000, transaction_timestamp(),
        transaction_timestamp() + interval '1 day', ${`worker-expiry:${orderId}`},
        'quoted', transaction_timestamp() - interval '1 second'
      )
    `);
    return orderId;
  }

  async function seedSettledReconciliation(): Promise<{
    orderId: string;
    expertId: string;
    attemptId: string;
    providerPaymentId: string;
    event: ReturnType<typeof verifiedEventFixture>;
  }> {
    const orderId = await seedDueOrder();
    const order = (
      await testDb.db.execute<{ expertId: string }>(sql`select
        expert_id as "expertId" from expert_residency_orders
        where id = ${orderId}::uuid`)
    ).rows[0]!;
    const attemptId = randomUUID();
    const providerPaymentId = `payment-${randomUUID()}`;
    await testDb.db.execute(sql`insert into expert_residency_payment_attempts (
      id, order_id, provider, provider_request_id, expected_amount_minor,
      currency, status, idempotency_key, updated_at
    ) values (${attemptId}::uuid, ${orderId}::uuid, 'disabled-test',
      ${providerPaymentId}, 100000, 'RUB', 'succeeded',
      ${`worker-projection:${attemptId}`},
      transaction_timestamp() - interval '10 minutes')`);
    await testDb.db.execute(sql`update expert_residency_orders set
      payment_provider = 'disabled-test', provider_payment_id = ${providerPaymentId},
      status = 'settled', settled_at = '2026-09-01T00:00:00.000Z'::timestamptz,
      residency_starts_at = '2026-09-01T00:00:00.000Z'::timestamptz,
      residency_ends_at = '2026-09-02T00:00:00.000Z'::timestamptz,
      updated_at = clock_timestamp()
      where id = ${orderId}::uuid`);
    const payloadDigest = `sha256:${"c".repeat(64)}`;
    return {
      orderId,
      expertId: order.expertId,
      attemptId,
      providerPaymentId,
      event: verifiedEventFixture(
        {
          kind: "settled",
          provider: "disabled-test",
          eventId: `event-${randomUUID()}`,
          paymentId: providerPaymentId,
          orderId,
          amountMinor: "100000",
          currency: "RUB",
          occurredAt: "2026-09-02T00:00:00.000Z",
          payloadDigest,
        },
        {
          verificationId: `verification-${randomUUID()}`,
          verifierKeyVersion: "test-v1",
          verifiedAt: "2026-09-02T00:00:00.000Z",
          payloadDigest,
        },
      ),
    };
  }

  async function claimedProjectionCandidate(input: { attemptId: string }) {
    const claimed = await repository.claimReconciliationBatch({
      now: new Date(0),
      batchSize: 1,
    });
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.attemptId).toBe(input.attemptId);
    return claimed[0]!;
  }

  it("expires at the exact database deadline and stays idempotent", async () => {
    const orderId = await seedDueOrder();

    await expect(
      repository.expireDueBatch({ now: new Date(0), batchSize: 1 }),
    ).resolves.toEqual({ examined: 1, changed: 1, failed: 0 });
    await expect(
      repository.expireDueBatch({ now: new Date(0), batchSize: 1 }),
    ).resolves.toEqual({ examined: 0, changed: 0, failed: 0 });
    const stored = await testDb.db.execute<{ status: string }>(sql`
      select status from expert_residency_orders where id = ${orderId}::uuid
    `);
    expect(stored.rows[0]?.status).toBe("expired");
  });

  it("records one immutable incident for a verified mismatch and never repairs local state", async () => {
    const orderId = await seedDueOrder();
    const attemptId = randomUUID();
    const providerPaymentId = `payment-${randomUUID()}`;
    await testDb.db.execute(sql`
      insert into expert_residency_payment_attempts (
        id, order_id, provider, provider_request_id, expected_amount_minor,
        currency, status, idempotency_key
      ) values (
        ${attemptId}::uuid, ${orderId}::uuid, 'disabled-test',
        ${providerPaymentId}, 100000, 'RUB', 'pending',
        ${`worker-reconciliation:${attemptId}`}
      )
    `);
    await testDb.db.execute(sql`
      update expert_residency_payment_attempts
      set updated_at = transaction_timestamp() - interval '10 minutes'
      where id = ${attemptId}::uuid
    `);
    const payloadDigest = `sha256:${"a".repeat(64)}`;
    const event = verifiedEventFixture(
      {
        kind: "settled",
        provider: "disabled-test",
        eventId: `event-${randomUUID()}`,
        paymentId: providerPaymentId,
        orderId,
        amountMinor: "100000",
        currency: "RUB",
        occurredAt: "2026-09-02T00:00:00.000Z",
        payloadDigest,
      },
      {
        verificationId: `verification-${randomUUID()}`,
        verifierKeyVersion: "test-v1",
        verifiedAt: "2026-09-02T00:00:00.000Z",
        payloadDigest,
      },
    );
    const claimed = await repository.claimReconciliationBatch({
      now: new Date("2026-09-02T00:00:00.000Z"),
      batchSize: 1,
    });
    expect(claimed).toHaveLength(1);
    const candidate = claimed[0]!;
    await expect(
      repository.claimReconciliationBatch({
        now: new Date("2026-09-02T00:00:00.000Z"),
        batchSize: 1,
      }),
    ).resolves.toEqual([]);

    await expect(
      repository.compareAndRecordReconciliation(candidate, event),
    ).resolves.toBe("mismatch");
    await expect(
      repository.compareAndRecordReconciliation(candidate, event),
    ).resolves.toBe("mismatch");

    const stored = await testDb.db.execute<{
      orderStatus: string;
      attemptStatus: string;
      incidents: number;
      audits: number;
    }>(sql`
      select o.status as "orderStatus", p.status as "attemptStatus",
        (select count(*)::integer from integration_outbox
          where topic = 'worker.expert_residency_reconciliation_mismatch') as incidents,
        (select count(*)::integer from audit_events
          where action = 'worker.expert_residency_reconciliation_mismatch') as audits
      from expert_residency_orders o
      join expert_residency_payment_attempts p on p.order_id = o.id
      where o.id = ${orderId}::uuid
    `);
    expect(stored.rows[0]).toEqual({
      orderStatus: "quoted",
      attemptStatus: "pending",
      incidents: 1,
      audits: 1,
    });
  });

  it("matches a fully consistent locked reconciliation projection", async () => {
    const prepared = await seedSettledReconciliation();
    const candidate = await claimedProjectionCandidate(prepared);

    await expect(
      repository.compareAndRecordReconciliation(candidate, prepared.event),
    ).resolves.toBe("matched");
    const incidents = await testDb.db.execute<{ count: number }>(sql`select
      count(*)::integer as count from integration_outbox
      where topic = 'worker.expert_residency_reconciliation_mismatch'`);
    expect(incidents.rows[0]?.count).toBe(0);
  });

  it.each([
    "provider_state",
    "reservation_projection",
    "reward_grant_projection",
    "ledger_balance_projection",
    "debt_projection",
    "residency_activation",
  ] as const)(
    "locks the full projection and records only bounded %s corruption",
    async (dimension) => {
      const prepared = await seedSettledReconciliation();
      if (dimension === "provider_state") {
        await testDb.db.execute(sql`update expert_residency_payment_attempts
          set status = 'pending' where id = ${prepared.attemptId}::uuid`);
      } else if (dimension === "reservation_projection") {
        await testDb.db.transaction(async (tx) => {
          await tx.execute(sql`set local session_replication_role = replica`);
          await tx.execute(sql`update expert_residency_orders set
            credit_minor = 1, cash_minor = 99999
            where id = ${prepared.orderId}::uuid`);
        });
      } else if (dimension === "reward_grant_projection") {
        const inviter = await fixtures.createExpert();
        await fixtures.seedIssuedQuota(inviter.expertId, 1);
        const code = (await fixtures.storedCodes())[0]!;
        await testDb.db.execute(sql`insert into expert_referrals (
          code_id, inviter_expert_id, invitee_expert_id
        ) values (${code.id}::uuid, ${inviter.expertId}::uuid,
          ${prepared.expertId}::uuid)`);
        await testDb.db.transaction(async (tx) => {
          await tx.execute(sql`set local session_replication_role = replica`);
          await tx.execute(sql`insert into expert_first_residency_settlements (
            expert_id, qualifying_order_id, eligibility_status,
            eligibility_reason_code, expert_active, expert_verified,
            unique_identity, abuse_cleared, settled_at
          ) values (${prepared.expertId}::uuid, ${prepared.orderId}::uuid,
            'eligible', 'eligible', true, true, true, true,
            transaction_timestamp() - interval '1 day')`);
        });
      } else if (dimension === "ledger_balance_projection") {
        await testDb.db.transaction(async (tx) => {
          await tx.execute(sql`set local session_replication_role = replica`);
          await tx.execute(sql`insert into expert_referral_ledger_entries (
            account_expert_id, entry_kind, amount_minor, source_type, source_id,
            idempotency_key
          ) values (${prepared.expertId}::uuid, 'reservation', -10,
            'corruption_probe', ${randomUUID()}::uuid,
            ${`projection-ledger:${prepared.orderId}`})`);
        });
      } else if (dimension === "debt_projection") {
        const evidence = await fixtures.createAdminEvidence(
          "expert_referral.adjust_balance",
          prepared.expertId,
          { amountMinor: "1" },
        );
        await testDb.db.transaction(async (tx) => {
          await tx.execute(sql`set local session_replication_role = replica`);
          const originalId = randomUUID();
          const reversalId = randomUUID();
          await tx.execute(sql`insert into expert_referral_ledger_entries (
            id, account_expert_id, entry_kind, amount_minor, source_type,
            source_id, admin_approval_id, admin_session_id_hash, idempotency_key
          ) values (${originalId}::uuid, ${prepared.expertId}::uuid,
            'administrative_correction', 1, 'projection_probe',
            ${randomUUID()}::uuid, ${evidence.approvalId}::uuid,
            ${evidence.sessionIdHash}, ${`projection-original:${prepared.orderId}`})`);
          await tx.execute(sql`insert into expert_referral_ledger_entries (
            id, account_expert_id, entry_kind, amount_minor, source_type,
            source_id, original_entry_id, idempotency_key
          ) values (${reversalId}::uuid, ${prepared.expertId}::uuid,
            'reversal', -10, 'reward_grant', ${randomUUID()}::uuid,
            ${originalId}::uuid, ${`projection-reversal:${prepared.orderId}`})`);
          await tx.execute(sql`insert into expert_referral_ledger_entries (
            account_expert_id, entry_kind, amount_minor, source_type,
            source_id, original_entry_id, idempotency_key
          ) values (${prepared.expertId}::uuid, 'debt_repayment', 11,
            'reward_grant', ${randomUUID()}::uuid, ${reversalId}::uuid,
            ${`projection-repayment:${prepared.orderId}`})`);
        });
      } else {
        await testDb.db.execute(sql`update expert_residency_orders set
          residency_starts_at = settled_at - interval '1 hour',
          residency_ends_at = settled_at - interval '1 hour'
            + make_interval(secs => duration_seconds)
          where id = ${prepared.orderId}::uuid`);
      }
      const before = await testDb.db.execute(sql`select
        row_to_json(o)::text as order, p.status as "attemptStatus",
        p.expected_amount_minor as "expectedAmountMinor", p.currency
        from expert_residency_orders o
        join expert_residency_payment_attempts p on p.order_id = o.id
        where o.id = ${prepared.orderId}::uuid`);
      const candidate = await claimedProjectionCandidate(prepared);

      await expect(
        repository.compareAndRecordReconciliation(candidate, prepared.event),
      ).resolves.toBe("mismatch");
      await expect(
        repository.compareAndRecordReconciliation(candidate, prepared.event),
      ).resolves.toBe("mismatch");

      const after = await testDb.db.execute<{
        order: string;
        attemptStatus: string;
        expectedAmountMinor: bigint | string;
        currency: string;
        payload: { mismatchCodes: string[] };
        incidents: number;
        audits: number;
      }>(sql`select row_to_json(o)::text as order,
        p.status as "attemptStatus",
        p.expected_amount_minor as "expectedAmountMinor", p.currency,
        incident.payload,
        (select count(*)::integer from integration_outbox
          where topic = 'worker.expert_residency_reconciliation_mismatch') as incidents,
        (select count(*)::integer from audit_events
          where action = 'worker.expert_residency_reconciliation_mismatch') as audits
        from expert_residency_orders o
        join expert_residency_payment_attempts p on p.order_id = o.id
        join integration_outbox incident
          on incident.topic = 'worker.expert_residency_reconciliation_mismatch'
        where o.id = ${prepared.orderId}::uuid`);
      expect(after.rows[0]).toMatchObject({
        payload: { mismatchCodes: [dimension] },
        incidents: 1,
        audits: 1,
      });
      expect(after.rows[0]?.order).toBe(before.rows[0]?.order);
      expect(after.rows[0]).toMatchObject({
        attemptStatus: before.rows[0]?.attemptStatus,
        expectedAmountMinor: before.rows[0]?.expectedAmountMinor,
        currency: before.rows[0]?.currency,
      });
    },
    30_000,
  );

  it("rejects a stale reconciliation owner and recovers an expired lease", async () => {
    const orderId = await seedDueOrder();
    const attemptId = randomUUID();
    const providerPaymentId = `payment-${randomUUID()}`;
    await testDb.db.execute(sql`
      insert into expert_residency_payment_attempts (
        id, order_id, provider, provider_request_id, expected_amount_minor,
        currency, status, idempotency_key, updated_at
      ) values (
        ${attemptId}::uuid, ${orderId}::uuid, 'disabled-test',
        ${providerPaymentId}, 100000, 'RUB', 'pending',
        ${`worker-lease:${attemptId}`},
        transaction_timestamp() - interval '10 minutes'
      )
    `);
    const first = (
      await repository.claimReconciliationBatch({
        now: new Date(0),
        batchSize: 1,
      })
    )[0]!;
    await testDb.db.execute(sql`
      update expert_residency_payment_attempts set updated_at = clock_timestamp()
      where id = ${attemptId}::uuid
    `);
    const payloadDigest = `sha256:${"b".repeat(64)}`;
    const event = verifiedEventFixture(
      {
        kind: "settled",
        provider: "disabled-test",
        eventId: `event-${randomUUID()}`,
        paymentId: providerPaymentId,
        orderId,
        amountMinor: "100000",
        currency: "RUB",
        occurredAt: "2026-09-02T00:00:00.000Z",
        payloadDigest,
      },
      {
        verificationId: `verification-${randomUUID()}`,
        verifierKeyVersion: "test-v1",
        verifiedAt: "2026-09-02T00:00:00.000Z",
        payloadDigest,
      },
    );
    await expect(
      repository.compareAndRecordReconciliation(first, event),
    ).rejects.toThrow("reconciliation_claim_lost");

    await testDb.db.execute(sql`
      update expert_residency_payment_attempts
      set updated_at = transaction_timestamp() - interval '10 minutes'
      where id = ${attemptId}::uuid
    `);
    await expect(
      repository.claimReconciliationBatch({ now: new Date(0), batchSize: 1 }),
    ).resolves.toHaveLength(1);
  });

  it.each([1, 2, 3])(
    "skip-locked concurrency run %s never double-claims a locked order",
    async () => {
      const lockedOrderId = await seedDueOrder();
      await seedDueOrder();
      let locked!: () => void;
      let release!: () => void;
      const lockedReady = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const releaseLock = new Promise<void>((resolve) => {
        release = resolve;
      });
      const holding = testDb.db.transaction(async (tx) => {
        await tx.execute(sql`
          select id from expert_residency_orders
          where id = ${lockedOrderId}::uuid for update
        `);
        locked();
        await releaseLock;
      });
      await lockedReady;
      try {
        await expect(
          repository.expireDueBatch({ now: new Date(0), batchSize: 2 }),
        ).resolves.toEqual({ examined: 1, changed: 1, failed: 0 });
      } finally {
        release();
        await holding;
      }
      await expect(
        repository.expireDueBatch({ now: new Date(0), batchSize: 2 }),
      ).resolves.toEqual({ examined: 1, changed: 1, failed: 0 });
    },
    30_000,
  );
});
