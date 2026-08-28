import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { expectPostgresErrorCause } from "../../../../tests/support/postgres-error.js";
import type { DrizzleDb } from "../client.js";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../testkit/expert-referral.js";
import {
  minPaymentDeadline,
  normalizeDatabaseMoney,
  releaseAmountFromReservation,
  parseMoneySnapshot,
  validateTariffVersionCommand,
  PostgresExpertResidencyRepository,
} from "./expert-residency-repository.js";

let testDb: ExpertReferralTestDatabase | undefined;

async function seedCredit(expertId: string, grantedAt: Date): Promise<string> {
  const grantId = randomUUID();
  const entryId = randomUUID();
  const expiresAt = new Date(grantedAt);
  expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + 1);
  await testDb!.db.transaction(async (tx) => {
    await tx.execute(sql`set local session_replication_role=replica`);
    await tx.execute(sql`
      insert into expert_referral_reward_grants (
        id,expert_id,referral_id,first_settlement_id,qualifying_order_id,
        qualifying_payment_attempt_id,amount_minor,granted_at,expires_at,idempotency_key
      ) values (
        ${grantId}::uuid,${expertId}::uuid,${randomUUID()}::uuid,${randomUUID()}::uuid,
        ${randomUUID()}::uuid,${randomUUID()}::uuid,100000,${grantedAt},
        ${expiresAt},${randomUUID()}
      )
    `);
    await tx.execute(sql`
      insert into expert_referral_ledger_entries (
        id,expert_id,entry_kind,amount_minor,source_type,source_id,idempotency_key
      ) values (
        ${entryId}::uuid,${expertId}::uuid,'reward_grant',100000,
        'test_credit',${grantId}::uuid,${randomUUID()}
      )
    `);
    await tx.execute(sql`
      insert into expert_referral_ledger_allocations (
        ledger_entry_id,reward_grant_id,expert_id,amount_minor
      ) values (${entryId}::uuid,${grantId}::uuid,${expertId}::uuid,100000)
    `);
  });
  return grantId;
}

async function seedAbundantCredit(expertId: string): Promise<void> {
  for (let index = 0; index < 4; index += 1)
    await seedCredit(expertId, new Date(Date.now() - (index + 2) * 86_400_000));
}

describe("PostgresExpertResidencyRepository checkout snapshots", () => {
  beforeAll(async () => {
    testDb = await startExpertReferralTestDatabase();
  }, 120_000);
  beforeEach(async () => {
    await testDb!.reset();
    await testDb!.enableExpertReferralCommands();
  });
  afterAll(async () => testDb?.stop());

  it.each([
    ["START", 390000, 117000, 273000, 0, "basic", "standard", 2],
    ["BASE", 590000, 177000, 413000, 1, "expanded", "standard", 2],
    ["PRO", 999000, 299700, 699300, 3, "expanded", "priority", 3],
  ] as const)(
    "persists and replays the complete %s V2 checkout snapshot",
    async (
      tariffKey,
      priceMinor,
      creditMinor,
      cashMinor,
      groupEventLimit,
      statisticsLevel,
      supportPriority,
      allocationCount,
    ) => {
      const expert = await testDb!.createExpertIdentity();
      const tariffVersionId = await testDb!.createResidencyTariff({
        tariffKey,
        displayName: `${tariffKey} residency`,
        priceMinor,
        durationSeconds: 2_592_000,
        commercialPolicyVersion: "expert_residency_v2",
        creditCapBps: 3000,
        individualServicesEnabled: true,
        groupEventLimit,
        statisticsLevel,
        supportPriority,
      });
      await seedAbundantCredit(expert.expertId);
      const repository = new PostgresExpertResidencyRepository(testDb!.db);
      const command = {
        expertId: expert.expertId,
        tariffVersionId,
        providerDeadline: new Date(Date.now() + 3_600_000),
        idempotencyKey: `v2-${tariffKey}-${randomUUID()}`,
      };

      const created = await repository.createCheckoutOrder(command);
      const replayed = await repository.createCheckoutOrder(command);
      const expected = {
        expertId: expert.expertId,
        tariffVersionId,
        displayName: `${tariffKey} residency`,
        priceMinor: String(priceMinor),
        currency: "RUB",
        durationSeconds: 2_592_000,
        creditMinor: String(creditMinor),
        cashMinor: String(cashMinor),
        commercialPolicyVersion: "expert_residency_v2",
        creditCapBps: 3000,
        individualServicesEnabled: true,
        groupEventLimit,
        statisticsLevel,
        supportPriority,
        status: "payment_pending",
      };
      expect(created).toMatchObject(expected);
      expect(replayed).toEqual(created);
      const persisted = await testDb!.db.execute(sql`
        select price_minor, duration_seconds, commercial_policy_version, credit_cap_bps,
          individual_services_enabled, group_event_limit, statistics_level, support_priority,
          credit_minor, cash_minor
        from expert_residency_orders where id=${created.id}::uuid
      `);
      expect(persisted.rows).toEqual([
        {
          price_minor: String(priceMinor),
          duration_seconds: 2_592_000,
          commercial_policy_version: "expert_residency_v2",
          credit_cap_bps: 3000,
          individual_services_enabled: true,
          group_event_limit: groupEventLimit,
          statistics_level: statisticsLevel,
          support_priority: supportPriority,
          credit_minor: String(creditMinor),
          cash_minor: String(cashMinor),
        },
      ]);
      const duplicates = await testDb!.db.execute<{
        orders: number;
        reservations: number;
        allocations: number;
        spends: number;
      }>(sql`
        select
          (select count(*)::int from expert_residency_orders where expert_id=${expert.expertId}::uuid and idempotency_key=${command.idempotencyKey}) orders,
          (select count(*)::int from expert_referral_ledger_entries where order_id=${created.id}::uuid and entry_kind='reservation') reservations,
          (select count(*)::int from expert_referral_ledger_allocations a join expert_referral_ledger_entries e on e.id=a.ledger_entry_id where e.order_id=${created.id}::uuid) allocations,
          (select count(*)::int from expert_referral_ledger_entries where order_id=${created.id}::uuid and entry_kind='spend') spends
      `);
      expect(duplicates.rows[0]).toEqual({
        orders: 1,
        reservations: 1,
        allocations: allocationCount,
        spends: 0,
      });
    },
  );

  it("uses the legacy policy defaults, audit action, and exact fifty-fifty checkout", async () => {
    const expert = await testDb!.createExpertIdentity();
    const tariffVersionId = await testDb!.createResidencyTariff({
      tariffKey: `legacy-${randomUUID()}`,
      displayName: "Legacy",
      priceMinor: 100000,
      durationSeconds: 2_592_000,
      commercialPolicyVersion: "legacy_residency_v1",
    });
    await seedAbundantCredit(expert.expertId);
    const tariff = await testDb!.db.execute(sql`
      select t.commercial_policy_version,t.credit_cap_bps,a.action
      from expert_residency_tariff_versions t join admin_approvals a on a.id=t.approval_id
      where t.id=${tariffVersionId}::uuid
    `);
    expect(tariff.rows[0]).toEqual({
      commercial_policy_version: "legacy_residency_v1",
      credit_cap_bps: 5000,
      action: "expert_residency.tariff_create",
    });
    const order = await new PostgresExpertResidencyRepository(
      testDb!.db,
    ).createCheckoutOrder({
      expertId: expert.expertId,
      tariffVersionId,
      providerDeadline: new Date(Date.now() + 3_600_000),
      idempotencyKey: randomUUID(),
    });
    expect(order).toMatchObject({
      commercialPolicyVersion: "legacy_residency_v1",
      creditCapBps: 5000,
      creditMinor: "50000",
      cashMinor: "50000",
    });
  });

  it("rejects an explicit credit cap that conflicts with its tariff policy", async () => {
    await expect(
      testDb!.createResidencyTariff({
        tariffKey: `legacy-${randomUUID()}`,
        displayName: "Legacy",
        priceMinor: 100000,
        durationSeconds: 2_592_000,
        commercialPolicyVersion: "legacy_residency_v1",
        creditCapBps: 3000,
      }),
    ).rejects.toThrow("Tariff policy and credit cap conflict");
    await expect(
      testDb!.createResidencyTariff({
        tariffKey: "START",
        displayName: "Start",
        priceMinor: 390000,
        durationSeconds: 2_592_000,
        commercialPolicyVersion: "expert_residency_v2",
        creditCapBps: 5000,
      }),
    ).rejects.toThrow("Tariff policy and credit cap conflict");
  });

  it("allocates checkout credit from the oldest grants first", async () => {
    const expert = await testDb!.createExpertIdentity();
    const tariffVersionId = await testDb!.createResidencyTariff({
      tariffKey: "START",
      displayName: "Start",
      priceMinor: 390000,
      durationSeconds: 2_592_000,
    });
    const oldest = await seedCredit(
      expert.expertId,
      new Date(Date.now() - 2 * 86_400_000),
    );
    const newest = await seedCredit(
      expert.expertId,
      new Date(Date.now() - 86_400_000),
    );
    const order = await new PostgresExpertResidencyRepository(
      testDb!.db,
    ).createCheckoutOrder({
      expertId: expert.expertId,
      tariffVersionId,
      providerDeadline: new Date(Date.now() + 3_600_000),
      idempotencyKey: randomUUID(),
    });
    expect(order.allocations).toEqual([
      { grantId: oldest, amountMinor: "100000" },
      { grantId: newest, amountMinor: "17000" },
    ]);
  });

  it("rolls back an inserted checkout order when the reservation hits the existing idempotency constraint", async () => {
    const expert = await testDb!.createExpertIdentity();
    const tariffVersionId = await testDb!.createResidencyTariff({
      tariffKey: "START",
      displayName: "Start",
      priceMinor: 390000,
      durationSeconds: 2_592_000,
    });
    await seedAbundantCredit(expert.expertId);
    const idempotencyKey = randomUUID();
    await testDb!.db.execute(
      sql`create function fail_a1_checkout_reservation() returns trigger language plpgsql as $$ begin raise exception 'a1 checkout reservation failure'; end $$`,
    );
    await testDb!.db.execute(
      sql`create trigger fail_a1_checkout_reservation before insert on expert_referral_ledger_entries for each row execute function fail_a1_checkout_reservation()`,
    );
    let failure: unknown;
    try {
      await new PostgresExpertResidencyRepository(
        testDb!.db,
      ).createCheckoutOrder({
        expertId: expert.expertId,
        tariffVersionId,
        providerDeadline: new Date(Date.now() + 3_600_000),
        idempotencyKey,
      });
    } catch (error) {
      failure = error;
    }
    expectPostgresErrorCause(
      failure,
      "P0001",
      "a1 checkout reservation failure",
    );
    const leftovers = await testDb!.db.execute(sql`
      select
        (select count(*)::int from expert_residency_orders where expert_id=${expert.expertId}::uuid and idempotency_key=${idempotencyKey}) orders,
        (select count(*)::int from expert_referral_ledger_entries where idempotency_key=${`checkout:${expert.expertId}:${idempotencyKey}`}) entries,
        (select count(*)::int from expert_referral_ledger_allocations a join expert_referral_ledger_entries e on e.id=a.ledger_entry_id where e.order_id in (select id from expert_residency_orders where expert_id=${expert.expertId}::uuid and idempotency_key=${idempotencyKey})) allocations
    `);
    expect(leftovers.rows[0]).toEqual({
      orders: 0,
      entries: 0,
      allocations: 0,
    });
  });
});

describe("expert residency repository boundaries", () => {
  it("returns the database-ordered active tariff projection with a hard limit", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            version: 1,
            newCommandsEnabled: true,
            rewardGrantsEnabled: true,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ active: true, verified: true }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "00000000-0000-4000-8000-000000000102",
            displayName: "Two months",
            priceMinor: "300001",
            currency: "RUB",
            durationSeconds: 5_184_000,
          },
          {
            id: "00000000-0000-4000-8000-000000000103",
            displayName: "Three months",
            priceMinor: 400002n,
            currency: "RUB",
            durationSeconds: 7_776_000,
          },
        ],
      });
    const db = {
      transaction: async (work: (tx: { execute: typeof execute }) => unknown) =>
        work({ execute }),
    } as unknown as DrizzleDb;

    await expect(
      new PostgresExpertResidencyRepository(db).listActiveTariffs({
        expertId: "00000000-0000-4000-8000-000000000101",
        limit: 20,
      }),
    ).resolves.toEqual([
      {
        tariffVersionId: "00000000-0000-4000-8000-000000000102",
        displayName: "Two months",
        priceMinor: "300001",
        currency: "RUB",
        durationSeconds: 5_184_000,
      },
      {
        tariffVersionId: "00000000-0000-4000-8000-000000000103",
        displayName: "Three months",
        priceMinor: "400002",
        currency: "RUB",
        durationSeconds: 7_776_000,
      },
    ]);
    expect(execute).toHaveBeenCalledTimes(4);
  });

  it("serializes money and uses the earliest deadline", () => {
    expect(
      parseMoneySnapshot({
        priceMinor: 250001n,
        creditMinor: 125000n,
        cashMinor: 125001n,
      }),
    ).toEqual({
      priceMinor: "250001",
      creditMinor: "125000",
      cashMinor: "125001",
    });
    expect(
      minPaymentDeadline(
        new Date("2026-08-03T12:00:00Z"),
        new Date("2026-08-03T11:00:00Z"),
      ),
    ).toEqual(new Date("2026-08-03T11:00:00Z"));
  });

  it("normalizes raw PostgreSQL bigint strings before arithmetic", () => {
    expect(normalizeDatabaseMoney("250001", "tariff.priceMinor")).toBe(250001n);
    expect(releaseAmountFromReservation("-125000")).toBe(125000n);
  });

  it.each([
    { priceMinor: 0n },
    { priceMinor: -1n },
    { priceMinor: 1_000_000_000_000n },
    { priceMinor: Number.NaN as unknown as bigint },
    { priceMinor: 1.5 as unknown as bigint },
    { priceMinor: Number.MAX_SAFE_INTEGER as unknown as bigint },
    { durationSeconds: Number.NaN },
    { durationSeconds: 86400.5 },
    { durationSeconds: Number.MAX_SAFE_INTEGER + 1 },
    { tariffKey: "" },
    { tariffKey: "x".repeat(129) },
    { displayName: "   " },
    { displayName: "x".repeat(257) },
  ])("rejects unstable tariff input %#", (override) => {
    expect(() =>
      validateTariffVersionCommand({
        tariffKey: "base",
        displayName: "Base",
        priceMinor: 100000n,
        durationSeconds: 86400,
        activeFrom: new Date("2026-08-03T10:00:00Z"),
        activeTo: new Date("2026-08-04T10:00:00Z"),
        approvalId: "00000000-0000-4000-8000-000000000001",
        adminSessionIdHash: "session",
        ...override,
      }),
    ).toThrowError(/Invalid tariff version/);
  });
});
