import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

let testDb: TestDatabase | undefined;

type DatabaseErrorEvidence = {
  code?: unknown;
  constraint?: unknown;
  cause?: unknown;
};

const errorChain = (error: unknown): DatabaseErrorEvidence[] => {
  const chain: DatabaseErrorEvidence[] = [];
  const seen = new Set<unknown>();
  let current = error;
  while (
    typeof current === "object" &&
    current !== null &&
    !seen.has(current)
  ) {
    seen.add(current);
    const evidence = current as DatabaseErrorEvidence;
    chain.push(evidence);
    current = evidence.cause;
  }
  return chain;
};

async function expectDatabaseError(
  operation: () => Promise<unknown>,
  expected: { code: string; constraint?: string },
): Promise<void> {
  let caught: unknown;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }
  expect(caught, "database operation should fail").toBeDefined();
  expect(
    errorChain(caught).some(
      (error) =>
        error.code === expected.code &&
        (expected.constraint === undefined ||
          error.constraint === expected.constraint),
    ),
  ).toBe(true);
}

async function columns(tableName: string): Promise<string[]> {
  const result = await testDb!.db.execute<{ columnName: string }>(sql`
    select column_name as "columnName"
    from information_schema.columns
    where table_schema = 'public' and table_name = ${tableName}
    order by ordinal_position
  `);
  return result.rows.map(({ columnName }) => columnName);
}

async function effectiveControl(): Promise<{
  newCommandsEnabled: boolean;
  rewardGrantsEnabled: boolean;
  persisted: boolean;
}> {
  const result = await testDb!.db.execute<{
    newCommandsEnabled: boolean;
    rewardGrantsEnabled: boolean;
    persisted: boolean;
  }>(sql`
    select
      coalesce(c.new_commands_enabled, false) as "newCommandsEnabled",
      coalesce(c.reward_grants_enabled, false) as "rewardGrantsEnabled",
      (c.control_key is not null) as persisted
    from (values (1)) as singleton(marker)
    left join expert_referral_feature_controls c
      on c.control_key = 'expert_referrals'
  `);
  const row = result.rows[0];
  if (row === undefined) throw new Error("effective control row missing");
  return row;
}

async function createAdminApproval(): Promise<{
  approvalId: string;
  sessionIdHash: string;
}> {
  const adminId = randomUUID();
  const approvalId = randomUUID();
  const sessionIdHash = `session:${randomUUID()}`;
  await testDb!.db.execute(sql`
    insert into users (id) values (${adminId}::uuid);
    insert into admin_sessions (
      session_id_hash, admin_id, mfa_verified_at, expires_at
    ) values (
      ${sessionIdHash}, ${adminId}::uuid,
      '2026-08-03T09:00:00.000Z', '2026-08-04T09:00:00.000Z'
    );
    insert into admin_approvals (
      id, action, object_type, object_id, requester_id,
      requester_session_id_hash, payload_hash, required_role,
      requester_mfa_verified_at, expires_at, nonce, created_at
    ) values (
      ${approvalId}::uuid, 'expert_residency.tariff_create',
      'expert_residency_tariff_version', ${randomUUID()}::uuid,
      ${adminId}::uuid, ${sessionIdHash}, 'sha256:test',
      'entitlement_admin', '2026-08-03T09:00:00.000Z',
      '2026-08-04T09:00:00.000Z', ${`nonce:${randomUUID()}`},
      '2026-08-03T10:00:00.000Z'
    )
  `);
  return { approvalId, sessionIdHash };
}

async function createExpert(): Promise<string> {
  const userId = randomUUID();
  const expertId = randomUUID();
  await testDb!.db.execute(sql`
    insert into users (id) values (${userId}::uuid);
    insert into experts (id, user_id, active, verified)
    values (${expertId}::uuid, ${userId}::uuid, true, true)
  `);
  return expertId;
}

async function createTariff(input?: {
  tariffKey?: string;
  activeFrom?: string;
  activeTo?: string;
  priceMinor?: bigint;
}): Promise<string> {
  const { approvalId, sessionIdHash } = await createAdminApproval();
  const tariffId = randomUUID();
  await testDb!.db.execute(sql`
    insert into expert_residency_tariff_versions (
      id, tariff_key, display_name, price_minor, currency,
      duration_seconds, active_from, active_to, approval_id,
      admin_session_id_hash
    ) values (
      ${tariffId}::uuid, ${input?.tariffKey ?? `tariff:${randomUUID()}`},
      'Test residency', ${input?.priceMinor ?? 1000n}, 'RUB', 2592000,
      ${input?.activeFrom ?? "2026-08-01T00:00:00.000Z"}::timestamptz,
      ${input?.activeTo ?? "2026-09-01T00:00:00.000Z"}::timestamptz,
      ${approvalId}::uuid, ${sessionIdHash}
    )
  `);
  return tariffId;
}

async function insertOrder(input: {
  priceMinor: bigint;
  creditMinor: bigint;
  cashMinor: bigint;
}): Promise<void> {
  const expertId = await createExpert();
  const tariffId = await createTariff({ priceMinor: input.priceMinor });
  await testDb!.db.execute(sql`
    insert into expert_residency_orders (
      expert_id, tariff_version_id, snapshot_display_name,
      price_minor, currency, duration_seconds, credit_minor, cash_minor,
      payment_deadline, idempotency_key, created_at
    ) values (
      ${expertId}::uuid, ${tariffId}::uuid, 'Test residency',
      ${input.priceMinor}, 'RUB', 2592000, ${input.creditMinor},
      ${input.cashMinor}, '2026-08-04T00:00:00.000Z',
      ${`order:${randomUUID()}`}, '2026-08-03T00:00:00.000Z'
    )
  `);
}

beforeAll(async () => {
  testDb = await startTestPostgres();
  await migrate(testDb.db, { migrationsFolder: "packages/db/migrations" });
}, 120_000);

beforeEach(async () => testDb!.reset());
afterAll(async () => testDb?.stop(), 60_000);

describe("expert referral residency schema", () => {
  it("creates the reviewed empty relations and fail-closed controls", async () => {
    const relations = await testDb!.db.execute<{ relationName: string }>(sql`
      select table_name as "relationName"
      from information_schema.tables
      where table_schema = 'public' and table_name like 'expert_%'
      union all
      select table_name as "relationName"
      from information_schema.views
      where table_schema = 'public' and table_name = 'expert_referral_balances'
      order by "relationName"
    `);
    expect(relations.rows.map(({ relationName }) => relationName)).toEqual(
      expect.arrayContaining([
        "expert_first_residency_settlements",
        "expert_referral_abuse_holds",
        "expert_referral_balances",
        "expert_referral_code_batches",
        "expert_referral_codes",
        "expert_referral_feature_controls",
        "expert_referral_issuance_overrides",
        "expert_referral_ledger_allocations",
        "expert_referral_ledger_entries",
        "expert_referral_reward_grants",
        "expert_referrals",
        "expert_residency_orders",
        "expert_residency_payment_attempts",
        "expert_residency_provider_event_inbox",
        "expert_residency_tariff_versions",
      ]),
    );
    expect(await columns("expert_residency_orders")).toEqual(
      expect.arrayContaining([
        "price_minor",
        "duration_seconds",
        "credit_minor",
        "cash_minor",
        "payment_deadline",
      ]),
    );
    expect(await columns("expert_referral_abuse_holds")).toEqual(
      expect.arrayContaining([
        "expert_id",
        "status",
        "reason_code",
        "opened_approval_id",
        "closed_approval_id",
      ]),
    );
    expect(await effectiveControl()).toMatchObject({
      newCommandsEnabled: false,
      rewardGrantsEnabled: false,
      persisted: false,
    });
  });

  it("has no mutable stored balance column and starts with no feature data", async () => {
    const forbidden = await testDb!.db.execute<{ count: string }>(sql`
      select count(*)::text as count
      from information_schema.columns
      where table_schema = 'public'
        and table_name like 'expert_referral_%'
        and table_name <> 'expert_referral_balances'
        and column_name in ('balance', 'balance_minor', 'available_balance_minor')
    `);
    expect(forbidden.rows[0]?.count).toBe("0");

    for (const relation of [
      "expert_referral_code_batches",
      "expert_referral_codes",
      "expert_referrals",
      "expert_residency_tariff_versions",
      "expert_residency_orders",
      "expert_referral_reward_grants",
      "expert_referral_feature_controls",
    ]) {
      const result = await testDb!.db.execute<{ count: string }>(
        sql.raw(`select count(*)::text as count from "${relation}"`),
      );
      expect(result.rows[0]?.count, relation).toBe("0");
    }
  });

  it("enforces the exact credit cap and cash remainder", async () => {
    await expectDatabaseError(
      () =>
        insertOrder({ priceMinor: 999n, creditMinor: 500n, cashMinor: 499n }),
      { code: "23514", constraint: "expert_order_credit_cap" },
    );
    await expectDatabaseError(
      () =>
        insertOrder({ priceMinor: 1000n, creditMinor: 400n, cashMinor: 599n }),
      { code: "23514", constraint: "expert_order_cash_remainder" },
    );
  });

  it("rejects overlapping active intervals for the same tariff", async () => {
    const tariffKey = `tariff:${randomUUID()}`;
    await createTariff({
      tariffKey,
      activeFrom: "2026-08-01T00:00:00.000Z",
      activeTo: "2026-09-01T00:00:00.000Z",
    });
    await expectDatabaseError(
      () =>
        createTariff({
          tariffKey,
          activeFrom: "2026-08-15T00:00:00.000Z",
          activeTo: "2026-10-01T00:00:00.000Z",
        }),
      { code: "23P01", constraint: "expert_tariff_active_interval_exclusion" },
    );
  });

  it("publishes the required uniqueness, money, lifecycle, and append-only controls", async () => {
    const constraints = await testDb!.db.execute<{
      constraintName: string;
    }>(sql`
      select conname as "constraintName"
      from pg_constraint
      where connamespace = 'public'::regnamespace
        and conname = any(array[
          'experts_user_id_unique',
          'expert_referrals_code_unique',
          'expert_referrals_invitee_unique',
          'expert_referrals_distinct_experts',
          'expert_reward_grant_exact_amount',
          'expert_first_settlement_expert_unique',
          'expert_referral_controls_singleton',
          'expert_provider_event_unique',
          'expert_order_money_bounds',
          'expert_order_credit_cap',
          'expert_order_cash_remainder'
        ])
      order by conname
    `);
    expect(
      constraints.rows.map(({ constraintName }) => constraintName).sort(),
    ).toHaveLength(11);

    const indexes = await testDb!.db.execute<{ indexName: string }>(sql`
      select indexname as "indexName"
      from pg_indexes
      where schemaname = 'public'
        and indexname = 'expert_abuse_holds_one_open_per_expert'
    `);
    expect(indexes.rows).toHaveLength(1);

    const triggers = await testDb!.db.execute<{ tableName: string }>(sql`
      select c.relname as "tableName"
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and t.tgname = 'expert_referral_append_only'
        and not t.tgisinternal
      order by c.relname
    `);
    expect(triggers.rows.map(({ tableName }) => tableName).sort()).toEqual([
      "expert_first_residency_settlements",
      "expert_referral_ledger_allocations",
      "expert_referral_ledger_entries",
      "expert_referral_reward_grants",
      "expert_referrals",
    ]);
  });
});
