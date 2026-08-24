import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

let testDb: TestDatabase;
const execFileAsync = promisify(execFile);

type LedgerClient = {
  query(query: string, values?: unknown[]): Promise<unknown>;
  release(): void;
};

const requiredRelations = [
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
] as const;

async function expectDatabaseError(
  operation: () => Promise<unknown>,
  expected: { code: string; constraint: string },
): Promise<void> {
  let caught: unknown;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }
  expect(caught, "database operation should fail").toBeDefined();
  const seen = new Set<unknown>();
  let current = caught;
  while (
    typeof current === "object" &&
    current !== null &&
    !seen.has(current)
  ) {
    seen.add(current);
    const evidence = current as {
      code?: unknown;
      constraint?: unknown;
      cause?: unknown;
    };
    if (
      evidence.code === expected.code &&
      evidence.constraint === expected.constraint
    ) {
      return;
    }
    current = evidence.cause;
  }
  throw new Error(
    `expected SQLSTATE ${expected.code} / ${expected.constraint}`,
  );
}

async function insertExpert(): Promise<{ expertId: string; userId: string }> {
  const userId = randomUUID();
  const expertId = randomUUID();
  await testDb.db.execute(sql`insert into users (id) values (${userId}::uuid)`);
  await testDb.db.execute(sql`
    insert into experts (id, user_id, active, verified)
    values (${expertId}::uuid, ${userId}::uuid, true, true)
  `);
  return { expertId, userId };
}

async function insertAdminEvidence(): Promise<{
  adminId: string;
  approvalId: string;
  sessionIdHash: string;
}> {
  const adminId = randomUUID();
  const approvalId = randomUUID();
  const sessionIdHash = `sha256:${randomUUID()}`;
  await testDb.db.execute(
    sql`insert into users (id) values (${adminId}::uuid)`,
  );
  await testDb.db.execute(sql`
    insert into admin_sessions (
      session_id_hash, admin_id, mfa_verified_at, expires_at
    ) values (
      ${sessionIdHash}, ${adminId}::uuid,
      '2026-08-01T00:00:00Z', '2028-08-01T00:00:00Z'
    )
  `);
  await testDb.db.execute(sql`
    insert into admin_approvals (
      id, action, object_type, object_id, requester_id,
      expires_at, nonce
    ) values (
      ${approvalId}::uuid, 'expert_referral.schema_fixture', 'expert',
      ${adminId}::uuid, ${adminId}::uuid, '2028-08-01T00:00:00Z',
      ${randomUUID()}
    )
  `);
  return { adminId, approvalId, sessionIdHash };
}

async function insertTariff(
  input: {
    tariffKey?: string;
    version?: number;
    activeFrom?: string;
    activeTo?: string;
    priceMinor?: bigint;
    durationSeconds?: number;
  } = {},
): Promise<string> {
  const tariffVersionId = randomUUID();
  const evidence = await insertAdminEvidence();
  await testDb.db.execute(sql`
    insert into expert_residency_tariff_versions (
      id, tariff_key, version, display_name, description,
      price_minor, currency, duration_seconds, active_from, active_to,
      created_by_admin_id, approval_id, admin_session_id_hash
    ) values (
      ${tariffVersionId}::uuid, ${input.tariffKey ?? `tariff-${randomUUID()}`},
      ${input.version ?? 1}, 'Residency', 'Residency tariff snapshot',
      ${input.priceMinor ?? 1_000n}, 'RUB',
      ${input.durationSeconds ?? 2_592_000},
      ${input.activeFrom ?? "2026-01-01T00:00:00Z"},
      ${input.activeTo ?? "2027-01-01T00:00:00Z"},
      ${evidence.adminId}::uuid, ${evidence.approvalId}::uuid,
      ${evidence.sessionIdHash}
    )
  `);
  return tariffVersionId;
}

async function insertOrder(input: {
  expertId: string;
  tariffVersionId: string;
  priceMinor?: bigint;
  creditMinor?: bigint;
  cashMinor?: bigint;
  durationSeconds?: number;
  status?: string;
  quotedAt?: string;
  paymentDeadline?: string;
  providerDeadline?: string;
}): Promise<string> {
  const orderId = randomUUID();
  await testDb.db.execute(sql`
    insert into expert_residency_orders (
      id, expert_id, tariff_version_id, tariff_name, tariff_description,
      price_minor, currency, duration_seconds, credit_minor, cash_minor,
      payment_deadline, provider_deadline, idempotency_key, status, quoted_at
    ) values (
      ${orderId}::uuid, ${input.expertId}::uuid,
      ${input.tariffVersionId}::uuid, 'Residency', 'Immutable snapshot',
      ${input.priceMinor ?? 999n}, 'RUB',
      ${input.durationSeconds ?? 2_592_000}, ${input.creditMinor ?? 499n},
      ${input.cashMinor ?? 500n},
      ${input.paymentDeadline ?? "2027-01-01T00:00:00Z"},
      ${input.providerDeadline ?? input.paymentDeadline ?? "2027-01-01T00:00:00Z"},
      ${`order-${randomUUID()}`}, ${input.status ?? "quoted"},
      ${input.quotedAt ?? "2026-08-01T00:00:00Z"}
    )
  `);
  return orderId;
}

async function settleOrder(
  orderId: string,
  settledAt = "2026-08-15T00:00:00Z",
): Promise<void> {
  await testDb.db.execute(sql`
    update expert_residency_orders
    set status = 'settled',
        settled_at = ${settledAt},
        residency_starts_at = ${settledAt},
        residency_ends_at = ${settledAt}::timestamptz
          + duration_seconds * interval '1 second',
        updated_at = statement_timestamp()
    where id = ${orderId}::uuid
  `);
}

async function insertRewardFixture(
  input: {
    inviterExpertId?: string;
    ledgerAmountMinor?: bigint;
    ledgerSourceId?: string;
    ledgerSourceType?: string;
  } = {},
): Promise<{
  grantId: string;
  inviterExpertId: string;
  rewardLedgerId: string;
}> {
  const inviter =
    input.inviterExpertId === undefined
      ? await insertExpert()
      : { expertId: input.inviterExpertId };
  const invitee = await insertExpert();
  const evidence = await insertAdminEvidence();
  const tariffVersionId = await insertTariff();
  const orderId = await insertOrder({
    expertId: invitee.expertId,
    tariffVersionId,
    quotedAt: "2026-08-01T00:00:00Z",
    paymentDeadline: "2026-09-01T00:00:00Z",
  });
  await settleOrder(orderId);
  const batchId = randomUUID();
  const codeId = randomUUID();
  const referralId = randomUUID();
  const settlementId = randomUUID();
  const grantId = randomUUID();
  const rewardLedgerId = randomUUID();
  await testDb.db.execute(sql`
    insert into expert_referral_code_batches (
      id, inviter_expert_id, requested_count, issued_by_admin_id,
      approval_id, admin_session_id_hash, status
    ) values (
      ${batchId}::uuid, ${inviter.expertId}::uuid, 1,
      ${evidence.adminId}::uuid, ${evidence.approvalId}::uuid,
      ${evidence.sessionIdHash}, 'issued'
    )
  `);
  await testDb.db.execute(sql`
    insert into expert_referral_codes (
      id, batch_id, inviter_expert_id, code_hash, masked_suffix,
      hmac_key_version, status
    ) values (
      ${codeId}::uuid, ${batchId}::uuid, ${inviter.expertId}::uuid,
      ${`sha256:${randomUUID()}`}, '…FIX1', 1, 'issued'
    )
  `);
  await testDb.db.execute(sql`
    insert into expert_referrals (
      id, code_id, inviter_expert_id, invitee_expert_id
    ) values (
      ${referralId}::uuid, ${codeId}::uuid, ${inviter.expertId}::uuid,
      ${invitee.expertId}::uuid
    )
  `);
  await testDb.db.execute(sql`
    insert into expert_first_residency_settlements (
      id, expert_id, qualifying_order_id, eligibility_status,
      eligibility_reason_code, expert_active, expert_verified,
      unique_identity, abuse_cleared, settled_at
    ) values (
      ${settlementId}::uuid, ${invitee.expertId}::uuid, ${orderId}::uuid,
      'eligible', 'eligible', true, true, true, true,
      '2026-08-15T00:00:00Z'
    )
  `);
  const client = await (
    testDb.db.$client as unknown as { connect(): Promise<LedgerClient> }
  ).connect();
  const ledgerAmountMinor = input.ledgerAmountMinor ?? 100_000n;
  try {
    await client.query("begin");
    await client.query(
      `insert into expert_referral_reward_grants (
        id, inviter_expert_id, referral_id, qualifying_order_id,
        first_settlement_id, amount_minor, granted_at, expires_at
      ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 100000,
        '2026-08-15T00:00:00Z', '2027-08-15T00:00:00Z')`,
      [grantId, inviter.expertId, referralId, orderId, settlementId],
    );
    await client.query(
      `insert into expert_referral_ledger_entries (
        id, account_expert_id, entry_kind, amount_minor, source_type,
        source_id, reward_grant_id, idempotency_key
      ) values ($1::uuid, $2::uuid, 'reward_grant', $3::bigint, $4,
        $5::uuid, $6::uuid, $7)`,
      [
        rewardLedgerId,
        inviter.expertId,
        ledgerAmountMinor.toString(),
        input.ledgerSourceType ?? "reward_grant",
        input.ledgerSourceId ?? grantId,
        grantId,
        `ledger-${randomUUID()}`,
      ],
    );
    await client.query(
      `insert into expert_referral_ledger_allocations (
        ledger_entry_id, reward_grant_id, amount_minor
      ) values ($1::uuid, $2::uuid, $3::bigint)`,
      [rewardLedgerId, grantId, ledgerAmountMinor.toString()],
    );
    await client.query("set constraints all immediate");
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  return {
    grantId,
    inviterExpertId: inviter.expertId,
    rewardLedgerId,
  };
}

async function insertLedgerFact(input: {
  accountExpertId: string;
  allocationGrantId: string;
  amountMinor: bigint;
  entryKind: string;
  originalEntryId?: string;
  rewardGrantId?: string;
  sourceId?: string;
  sourceType: string;
}): Promise<string> {
  const client = await (
    testDb.db.$client as unknown as { connect(): Promise<LedgerClient> }
  ).connect();
  const ledgerId = randomUUID();
  try {
    await client.query("begin");
    await client.query(
      `insert into expert_referral_ledger_entries (
        id, account_expert_id, entry_kind, amount_minor, source_type,
        source_id, reward_grant_id, original_entry_id, idempotency_key
      ) values ($1::uuid, $2::uuid, $3, $4::bigint, $5, $6::uuid,
        $7::uuid, $8::uuid, $9)`,
      [
        ledgerId,
        input.accountExpertId,
        input.entryKind,
        input.amountMinor.toString(),
        input.sourceType,
        input.sourceId ?? randomUUID(),
        input.rewardGrantId ?? null,
        input.originalEntryId ?? null,
        `ledger-${randomUUID()}`,
      ],
    );
    await client.query(
      `insert into expert_referral_ledger_allocations (
        ledger_entry_id, reward_grant_id, amount_minor
      ) values ($1::uuid, $2::uuid, $3::bigint)`,
      [
        ledgerId,
        input.allocationGrantId,
        input.amountMinor < 0n
          ? (-input.amountMinor).toString()
          : input.amountMinor.toString(),
      ],
    );
    await client.query("set constraints all immediate");
    await client.query("commit");
    return ledgerId;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function columns(relation: string): Promise<string[]> {
  const result = await testDb.db.execute<{ columnName: string }>(sql`
    select column_name as "columnName"
    from information_schema.columns
    where table_schema = 'public' and table_name = ${relation}
    order by ordinal_position
  `);
  return result.rows.map(({ columnName }) => columnName);
}

async function effectiveControl(featureKey: string): Promise<{
  newCommandsEnabled: boolean;
  rewardGrantsEnabled: boolean;
  persisted: boolean;
}> {
  const result = await testDb.db.execute<{
    newCommandsEnabled: boolean;
    rewardGrantsEnabled: boolean;
  }>(sql`
    select
      new_commands_enabled as "newCommandsEnabled",
      reward_grants_enabled as "rewardGrantsEnabled"
    from expert_referral_feature_controls
    where feature_key = ${featureKey}
  `);
  return result.rows[0] === undefined
    ? {
        newCommandsEnabled: false,
        rewardGrantsEnabled: false,
        persisted: false,
      }
    : { ...result.rows[0], persisted: true };
}

beforeAll(async () => {
  testDb = await startTestPostgres();
  await migrate(testDb.db, { migrationsFolder: "packages/db/migrations" });
}, 120_000);

afterAll(async () => testDb?.stop(), 60_000);

describe("expert referral and residency schema", () => {
  it("reports a zero-duplicate read-only preflight on the test snapshot", async () => {
    const pool = testDb.db.$client as unknown as {
      options: { connectionString?: string };
    };
    const databaseUrl = pool.options.connectionString;
    expect(databaseUrl).toBeTruthy();
    const result = await execFileAsync(
      process.execPath,
      ["scripts/preflight-expert-referral-migration.mjs"],
      {
        env: { ...process.env, DATABASE_URL: databaseUrl },
        encoding: "utf8",
      },
    );
    expect(result).toMatchObject({
      stdout: "duplicate_groups=0\n",
      stderr: "",
    });
    console.info(`EXPERT-IDENTITY-PREFLIGHT: ${result.stdout.trim()}`);
  });

  it("creates every reviewed relation empty without a mutable balance column", async () => {
    const relations = await testDb.db.execute<{
      relationName: string;
      relationKind: string;
    }>(sql`
      select c.relname as "relationName", c.relkind as "relationKind"
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname like 'expert_%'
      order by c.relname
    `);
    const names = new Set(
      relations.rows.map(({ relationName }) => relationName),
    );
    expect(requiredRelations.filter((name) => names.has(name))).toEqual(
      requiredRelations,
    );

    for (const relation of requiredRelations.filter(
      (name) => name !== "expert_referral_balances",
    )) {
      const count = await testDb.db.execute<{ count: string }>(
        sql.raw(`select count(*)::text as count from ${relation}`),
      );
      expect(count.rows[0]?.count, relation).toBe("0");
    }

    const mutableBalanceColumns = await testDb.db.execute(sql`
      select c.table_name, c.column_name
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = 'public'
        and t.table_type = 'BASE TABLE'
        and c.table_name like 'expert_%'
        and c.column_name in (
          'balance_minor', 'available_balance_minor', 'debt_minor',
          'remaining_minor'
        )
    `);
    expect(mutableBalanceColumns.rows).toEqual([]);
  });

  it("exposes the immutable order and audited abuse-hold columns", async () => {
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
    expect(await columns("expert_referral_balances")).toEqual(
      expect.arrayContaining([
        "expert_id",
        "spendable_balance_minor",
        "reserved_balance_minor",
        "debt_minor",
        "nearest_expiry_at",
      ]),
    );
  });

  it("rejects the mutation that permits two expert profiles for one user", async () => {
    const { userId } = await insertExpert();
    await expectDatabaseError(
      () =>
        testDb.db.execute(sql`
          insert into experts (user_id, active, verified)
          values (${userId}::uuid, true, true)
        `),
      { code: "23505", constraint: "experts_user_id_unique" },
    );
  });

  it("rejects over-cap credit, an inexact cash remainder, and invalid duration", async () => {
    const { expertId } = await insertExpert();
    const tariffVersionId = await insertTariff();
    await expectDatabaseError(
      () =>
        insertOrder({
          expertId,
          tariffVersionId,
          priceMinor: 999n,
          creditMinor: 500n,
          cashMinor: 499n,
        }),
      { code: "23514", constraint: "expert_order_credit_cap" },
    );
    await expectDatabaseError(
      () =>
        insertOrder({
          expertId,
          tariffVersionId,
          priceMinor: 1_000n,
          creditMinor: 400n,
          cashMinor: 599n,
        }),
      { code: "23514", constraint: "expert_order_cash_remainder" },
    );
    await expectDatabaseError(
      () =>
        insertOrder({
          expertId,
          tariffVersionId,
          durationSeconds: 86_399,
        }),
      { code: "23514", constraint: "expert_order_duration_bounds" },
    );
  });

  it("rejects the mutation that permits overlapping versions of one tariff", async () => {
    const tariffKey = `tariff-${randomUUID()}`;
    await insertTariff({
      tariffKey,
      version: 1,
      activeFrom: "2026-01-01T00:00:00Z",
      activeTo: "2026-07-01T00:00:00Z",
    });
    await expectDatabaseError(
      () =>
        insertTariff({
          tariffKey,
          version: 2,
          activeFrom: "2026-06-30T23:59:59Z",
          activeTo: "2027-01-01T00:00:00Z",
        }),
      {
        code: "23P01",
        constraint: "expert_tariff_active_interval_exclusion",
      },
    );
  });

  it("treats an absent feature-control singleton as disabled", async () => {
    await expect(effectiveControl("expert_referrals")).resolves.toEqual({
      newCommandsEnabled: false,
      rewardGrantsEnabled: false,
      persisted: false,
    });
  });

  it("rejects duplicate provider events and a second open abuse hold", async () => {
    const provider = `provider-${randomUUID()}`;
    const externalEventId = randomUUID();
    await testDb.db.execute(sql`
      insert into expert_residency_provider_event_inbox (
        provider, external_event_id, payload_digest, authenticated,
        event_kind, processing_status
      ) values (
        ${provider}, ${externalEventId}, 'sha256:event', true,
        'settlement', 'pending'
      )
    `);
    await expectDatabaseError(
      () =>
        testDb.db.execute(sql`
          insert into expert_residency_provider_event_inbox (
            provider, external_event_id, payload_digest, authenticated,
            event_kind, processing_status
          ) values (
            ${provider}, ${externalEventId}, 'sha256:other', true,
            'settlement', 'pending'
          )
        `),
      { code: "23505", constraint: "expert_provider_event_unique" },
    );

    const { expertId } = await insertExpert();
    const first = await insertAdminEvidence();
    const second = await insertAdminEvidence();
    await testDb.db.execute(sql`
      insert into expert_referral_abuse_holds (
        expert_id, status, reason_code, opened_approval_id,
        opened_by_admin_id, opened_admin_session_id_hash
      ) values (
        ${expertId}::uuid, 'open', 'manual_review',
        ${first.approvalId}::uuid, ${first.adminId}::uuid,
        ${first.sessionIdHash}
      )
    `);
    await expectDatabaseError(
      () =>
        testDb.db.execute(sql`
          insert into expert_referral_abuse_holds (
            expert_id, status, reason_code, opened_approval_id,
            opened_by_admin_id, opened_admin_session_id_hash
          ) values (
            ${expertId}::uuid, 'open', 'duplicate_signal',
            ${second.approvalId}::uuid, ${second.adminId}::uuid,
            ${second.sessionIdHash}
          )
        `),
      { code: "23505", constraint: "expert_abuse_hold_one_open" },
    );
  });

  it("rejects reused referral identities and an inviter bound to themselves", async () => {
    const inviter = await insertExpert();
    const invitee = await insertExpert();
    const evidence = await insertAdminEvidence();
    const batchId = randomUUID();
    const codeId = randomUUID();
    await testDb.db.execute(sql`
      insert into expert_referral_code_batches (
        id, inviter_expert_id, requested_count, issued_by_admin_id,
        approval_id, admin_session_id_hash, status
      ) values (
        ${batchId}::uuid, ${inviter.expertId}::uuid, 1,
        ${evidence.adminId}::uuid, ${evidence.approvalId}::uuid,
        ${evidence.sessionIdHash}, 'issued'
      )
    `);
    await testDb.db.execute(sql`
      insert into expert_referral_codes (
        id, batch_id, inviter_expert_id, code_hash, masked_suffix,
        hmac_key_version, status
      ) values (
        ${codeId}::uuid, ${batchId}::uuid, ${inviter.expertId}::uuid,
        ${`sha256:${randomUUID()}`}, '…ABCD', 1, 'issued'
      )
    `);
    await testDb.db.execute(sql`
      insert into expert_referrals (
        code_id, inviter_expert_id, invitee_expert_id
      ) values (
        ${codeId}::uuid, ${inviter.expertId}::uuid,
        ${invitee.expertId}::uuid
      )
    `);
    await expectDatabaseError(
      () =>
        testDb.db.execute(sql`
          insert into expert_referrals (
            code_id, inviter_expert_id, invitee_expert_id
          ) values (
            ${codeId}::uuid, ${inviter.expertId}::uuid,
            ${inviter.expertId}::uuid
          )
        `),
      { code: "23514", constraint: "expert_referral_distinct_experts" },
    );
  });

  it("binds a first-settlement fact to its expert's settled order", async () => {
    const owner = await insertExpert();
    const otherExpert = await insertExpert();
    const tariffVersionId = await insertTariff();
    const orderId = await insertOrder({
      expertId: owner.expertId,
      tariffVersionId,
      quotedAt: "2026-08-01T00:00:00Z",
      paymentDeadline: "2026-09-01T00:00:00Z",
    });

    const insertSettlement = (expertId: string, settledAt: string) =>
      testDb.db.execute(sql`
        insert into expert_first_residency_settlements (
          expert_id, qualifying_order_id, eligibility_status,
          eligibility_reason_code, expert_active, expert_verified,
          unique_identity, abuse_cleared, settled_at
        ) values (
          ${expertId}::uuid, ${orderId}::uuid, 'eligible', 'eligible',
          true, true, true, true, ${settledAt}
        )
      `);

    await expectDatabaseError(
      () => insertSettlement(owner.expertId, "2026-08-15T00:00:00Z"),
      { code: "23514", constraint: "expert_first_settlement_order_eligible" },
    );
    await settleOrder(orderId);
    await expectDatabaseError(
      () => insertSettlement(otherExpert.expertId, "2026-08-15T00:00:00Z"),
      { code: "23514", constraint: "expert_first_settlement_order_eligible" },
    );
    await expectDatabaseError(
      () => insertSettlement(owner.expertId, "2026-08-16T00:00:00Z"),
      { code: "23514", constraint: "expert_first_settlement_order_eligible" },
    );
    await expect(
      insertSettlement(owner.expertId, "2026-08-15T00:00:00Z"),
    ).resolves.toBeDefined();
  });

  it("binds one exact reward-ledger fact to its grant", async () => {
    await expectDatabaseError(
      () =>
        insertRewardFixture({
          ledgerAmountMinor: 1n,
        }),
      { code: "23514", constraint: "expert_reward_ledger_exact" },
    );
    await expectDatabaseError(
      () =>
        insertRewardFixture({
          ledgerSourceId: randomUUID(),
          ledgerSourceType: "arbitrary_reward",
        }),
      { code: "23514", constraint: "expert_ledger_entry_contract" },
    );

    const fixture = await insertRewardFixture();
    await expectDatabaseError(
      () =>
        insertLedgerFact({
          accountExpertId: fixture.inviterExpertId,
          allocationGrantId: fixture.grantId,
          amountMinor: 100_000n,
          entryKind: "reward_grant",
          rewardGrantId: fixture.grantId,
          sourceId: fixture.grantId,
          sourceType: "reward_grant",
        }),
      { code: "23505", constraint: "expert_ledger_source_fact_unique" },
    );
  });

  it("enforces one exact reservation terminal and avoids double debiting spend", async () => {
    const fixture = await insertRewardFixture();
    const reservationId = await insertLedgerFact({
      accountExpertId: fixture.inviterExpertId,
      allocationGrantId: fixture.grantId,
      amountMinor: -30_000n,
      entryKind: "reservation",
      sourceType: "residency_order",
    });

    await expectDatabaseError(
      () =>
        insertLedgerFact({
          accountExpertId: fixture.inviterExpertId,
          allocationGrantId: fixture.grantId,
          amountMinor: 30_001n,
          entryKind: "release",
          originalEntryId: reservationId,
          sourceType: "residency_order",
        }),
      { code: "23514", constraint: "expert_ledger_terminal_match" },
    );
    await expectDatabaseError(
      () =>
        insertLedgerFact({
          accountExpertId: fixture.inviterExpertId,
          allocationGrantId: fixture.grantId,
          amountMinor: 1n,
          entryKind: "debt_repayment",
          sourceType: "reward_grant",
        }),
      { code: "23514", constraint: "expert_ledger_compensation_original" },
    );
    await expectDatabaseError(
      () =>
        insertLedgerFact({
          accountExpertId: fixture.inviterExpertId,
          allocationGrantId: fixture.grantId,
          amountMinor: 1n,
          entryKind: "debt_repayment",
          originalEntryId: reservationId,
          sourceId: fixture.grantId,
          sourceType: "reward_grant",
        }),
      { code: "23514", constraint: "expert_ledger_debt_repayment_bound" },
    );

    const releases = await Promise.allSettled([
      insertLedgerFact({
        accountExpertId: fixture.inviterExpertId,
        allocationGrantId: fixture.grantId,
        amountMinor: 30_000n,
        entryKind: "release",
        originalEntryId: reservationId,
        sourceType: "residency_order",
      }),
      insertLedgerFact({
        accountExpertId: fixture.inviterExpertId,
        allocationGrantId: fixture.grantId,
        amountMinor: 30_000n,
        entryKind: "release",
        originalEntryId: reservationId,
        sourceType: "residency_order",
      }),
    ]);
    expect(
      releases.filter(({ status }) => status === "fulfilled"),
    ).toHaveLength(1);
    const rejectedRelease = releases.find(
      ({ status }) => status === "rejected",
    );
    expect(rejectedRelease?.status).toBe("rejected");
    if (rejectedRelease?.status === "rejected") {
      const evidence = rejectedRelease.reason as {
        code?: string;
        constraint?: string;
      };
      expect(evidence).toMatchObject({
        code: "23505",
        constraint: "expert_ledger_reservation_terminal_unique",
      });
    }

    const secondReservationId = await insertLedgerFact({
      accountExpertId: fixture.inviterExpertId,
      allocationGrantId: fixture.grantId,
      amountMinor: -40_000n,
      entryKind: "reservation",
      sourceType: "residency_order",
    });
    await insertLedgerFact({
      accountExpertId: fixture.inviterExpertId,
      allocationGrantId: fixture.grantId,
      amountMinor: -40_000n,
      entryKind: "spend",
      originalEntryId: secondReservationId,
      sourceType: "residency_order",
    });

    const balance = await testDb.db.execute<{
      reservedMinor: string;
      spendableMinor: string;
    }>(sql`
      select
        reserved_balance_minor::text as "reservedMinor",
        spendable_balance_minor::text as "spendableMinor"
      from expert_referral_balances
      where expert_id = ${fixture.inviterExpertId}::uuid
    `);
    expect(balance.rows[0]).toEqual({
      reservedMinor: "0",
      spendableMinor: "60000",
    });

    const alternateGrant = await insertRewardFixture({
      inviterExpertId: fixture.inviterExpertId,
    });
    const perGrantReservationId = await insertLedgerFact({
      accountExpertId: fixture.inviterExpertId,
      allocationGrantId: fixture.grantId,
      amountMinor: -10_000n,
      entryKind: "reservation",
      sourceType: "residency_order",
    });
    await expectDatabaseError(
      () =>
        insertLedgerFact({
          accountExpertId: fixture.inviterExpertId,
          allocationGrantId: alternateGrant.grantId,
          amountMinor: -10_000n,
          entryKind: "spend",
          originalEntryId: perGrantReservationId,
          sourceType: "residency_order",
        }),
      { code: "23514", constraint: "expert_ledger_terminal_match" },
    );

    await insertLedgerFact({
      accountExpertId: fixture.inviterExpertId,
      allocationGrantId: fixture.grantId,
      amountMinor: -60_000n,
      entryKind: "expiry",
      originalEntryId: fixture.rewardLedgerId,
      sourceId: fixture.grantId,
      sourceType: "reward_grant",
    });
    await expectDatabaseError(
      () =>
        insertLedgerFact({
          accountExpertId: fixture.inviterExpertId,
          allocationGrantId: fixture.grantId,
          amountMinor: -50_000n,
          entryKind: "reversal",
          originalEntryId: fixture.rewardLedgerId,
          sourceId: fixture.grantId,
          sourceType: "reward_grant",
        }),
      { code: "23514", constraint: "expert_ledger_compensation_original" },
    );
  });

  it("serializes debt repayments and bounds them to the reversal", async () => {
    const debtFixture = await insertRewardFixture();
    const reversalId = await insertLedgerFact({
      accountExpertId: debtFixture.inviterExpertId,
      allocationGrantId: debtFixture.grantId,
      amountMinor: -100_000n,
      entryKind: "reversal",
      originalEntryId: debtFixture.rewardLedgerId,
      sourceId: debtFixture.grantId,
      sourceType: "reward_grant",
    });
    const firstRepaymentGrant = await insertRewardFixture({
      inviterExpertId: debtFixture.inviterExpertId,
    });
    const secondRepaymentGrant = await insertRewardFixture({
      inviterExpertId: debtFixture.inviterExpertId,
    });

    const repayments = await Promise.allSettled([
      insertLedgerFact({
        accountExpertId: debtFixture.inviterExpertId,
        allocationGrantId: firstRepaymentGrant.grantId,
        amountMinor: 60_000n,
        entryKind: "debt_repayment",
        originalEntryId: reversalId,
        sourceId: firstRepaymentGrant.grantId,
        sourceType: "reward_grant",
      }),
      insertLedgerFact({
        accountExpertId: debtFixture.inviterExpertId,
        allocationGrantId: secondRepaymentGrant.grantId,
        amountMinor: 60_000n,
        entryKind: "debt_repayment",
        originalEntryId: reversalId,
        sourceId: secondRepaymentGrant.grantId,
        sourceType: "reward_grant",
      }),
    ]);
    expect(
      repayments.filter(({ status }) => status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = repayments.find(({ status }) => status === "rejected");
    expect(rejected?.status).toBe("rejected");
    if (rejected?.status === "rejected") {
      expect(rejected.reason).toMatchObject({
        code: "23514",
        constraint: "expert_ledger_debt_repayment_bound",
      });
    }
  });

  it("enforces one first settlement, the exact reward, exact expiry, and allocations", async () => {
    const inviter = await insertExpert();
    const invitee = await insertExpert();
    const evidence = await insertAdminEvidence();
    const tariffVersionId = await insertTariff();
    const orderId = await insertOrder({
      expertId: invitee.expertId,
      tariffVersionId,
      quotedAt: "2025-07-01T00:00:00Z",
      paymentDeadline: "2025-08-02T00:00:00Z",
    });
    await settleOrder(orderId, "2025-08-01T00:00:00Z");
    const batchId = randomUUID();
    const codeId = randomUUID();
    const referralId = randomUUID();
    const settlementId = randomUUID();
    await testDb.db.execute(sql`
      insert into expert_referral_code_batches (
        id, inviter_expert_id, requested_count, issued_by_admin_id,
        approval_id, admin_session_id_hash, status
      ) values (
        ${batchId}::uuid, ${inviter.expertId}::uuid, 1,
        ${evidence.adminId}::uuid, ${evidence.approvalId}::uuid,
        ${evidence.sessionIdHash}, 'issued'
      )
    `);
    await testDb.db.execute(sql`
      insert into expert_referral_codes (
        id, batch_id, inviter_expert_id, code_hash, masked_suffix,
        hmac_key_version, status
      ) values (
        ${codeId}::uuid, ${batchId}::uuid, ${inviter.expertId}::uuid,
        ${`sha256:${randomUUID()}`}, '…EFGH', 1, 'issued'
      )
    `);
    await testDb.db.execute(sql`
      insert into expert_referrals (
        id, code_id, inviter_expert_id, invitee_expert_id
      ) values (
        ${referralId}::uuid, ${codeId}::uuid, ${inviter.expertId}::uuid,
        ${invitee.expertId}::uuid
      )
    `);
    await testDb.db.execute(sql`
      insert into expert_first_residency_settlements (
        id, expert_id, qualifying_order_id, eligibility_status,
        eligibility_reason_code, expert_active, expert_verified,
        unique_identity, abuse_cleared, settled_at
      ) values (
        ${settlementId}::uuid, ${invitee.expertId}::uuid, ${orderId}::uuid,
        'eligible', 'eligible', true, true, true, true,
        '2025-08-01T00:00:00Z'
      )
    `);

    await expectDatabaseError(
      () =>
        testDb.db.execute(sql`
          insert into expert_first_residency_settlements (
            expert_id, qualifying_order_id, eligibility_status,
            eligibility_reason_code, expert_active, expert_verified,
            unique_identity, abuse_cleared, settled_at
          ) values (
            ${invitee.expertId}::uuid, ${orderId}::uuid, 'ineligible',
            'duplicate', true, true, false, true,
            '2025-08-01T00:00:00Z'
          )
        `),
      { code: "23505", constraint: "expert_first_settlement_expert_unique" },
    );

    await expectDatabaseError(
      () =>
        testDb.db.execute(sql`
          insert into expert_referral_reward_grants (
            inviter_expert_id, referral_id, qualifying_order_id,
            first_settlement_id, amount_minor, granted_at, expires_at
          ) values (
            ${inviter.expertId}::uuid, ${referralId}::uuid, ${orderId}::uuid,
            ${settlementId}::uuid, 99999,
            '2026-08-01T00:00:00Z', '2027-08-01T00:00:00Z'
          )
        `),
      { code: "23514", constraint: "expert_reward_exact_amount" },
    );

    await expectDatabaseError(
      () =>
        testDb.db.execute(sql`
          insert into expert_referral_reward_grants (
            inviter_expert_id, referral_id, qualifying_order_id,
            first_settlement_id, amount_minor, granted_at, expires_at
          ) values (
            ${inviter.expertId}::uuid, ${referralId}::uuid, ${orderId}::uuid,
            ${settlementId}::uuid, 100000,
            '2026-08-01T00:00:00Z', '2027-08-02T00:00:00Z'
          )
        `),
      { code: "23514", constraint: "expert_reward_exact_expiry" },
    );

    const grantId = randomUUID();
    await expectDatabaseError(
      () =>
        testDb.db.execute(sql`
          insert into expert_referral_reward_grants (
            id, inviter_expert_id, referral_id, qualifying_order_id,
            first_settlement_id, amount_minor, granted_at, expires_at
          ) values (
            ${grantId}::uuid, ${inviter.expertId}::uuid, ${referralId}::uuid,
            ${orderId}::uuid, ${settlementId}::uuid, 100000,
            '2025-08-01T00:00:00Z', '2026-08-01T00:00:00Z'
          )
        `),
      { code: "23514", constraint: "expert_reward_ledger_exact" },
    );

    await expectDatabaseError(
      () =>
        testDb.db.execute(sql`
          insert into expert_referral_ledger_entries (
            account_expert_id, entry_kind, amount_minor,
            source_type, source_id, idempotency_key
          ) values (
            ${inviter.expertId}::uuid, 'reservation', -1,
            'residency_order', ${randomUUID()}::uuid,
            ${`ledger-${randomUUID()}`}
          )
        `),
      { code: "23514", constraint: "expert_ledger_allocation_required" },
    );

    const ledgerId = randomUUID();
    await testDb.db.$client.query(`
      begin;
      insert into expert_referral_reward_grants (
        id, inviter_expert_id, referral_id, qualifying_order_id,
        first_settlement_id, amount_minor, granted_at, expires_at
      ) values (
        '${grantId}'::uuid, '${inviter.expertId}'::uuid,
        '${referralId}'::uuid, '${orderId}'::uuid, '${settlementId}'::uuid,
        100000, '2025-08-01T00:00:00Z', '2026-08-01T00:00:00Z'
      );
      insert into expert_referral_ledger_entries (
        id, account_expert_id, entry_kind, amount_minor,
        source_type, source_id, reward_grant_id, idempotency_key
      ) values (
        '${ledgerId}'::uuid, '${inviter.expertId}'::uuid,
        'reward_grant', 100000, 'reward_grant', '${grantId}'::uuid,
        '${grantId}'::uuid, 'ledger-${randomUUID()}'
      );
      insert into expert_referral_ledger_allocations (
        ledger_entry_id, reward_grant_id, amount_minor
      ) values ('${ledgerId}'::uuid, '${grantId}'::uuid, 100000);
      commit;
    `);

    const balance = await testDb.db.execute<{
      spendableBalanceMinor: string;
      lifetimeGrantedMinor: string;
      nearestExpiryAt: Date | null;
    }>(sql`
      select
        spendable_balance_minor::text as "spendableBalanceMinor",
        lifetime_granted_minor::text as "lifetimeGrantedMinor",
        nearest_expiry_at as "nearestExpiryAt"
      from expert_referral_balances
      where expert_id = ${inviter.expertId}::uuid
    `);
    expect(balance.rows[0]).toEqual({
      spendableBalanceMinor: "0",
      lifetimeGrantedMinor: "100000",
      nearestExpiryAt: null,
    });

    for (const [relation, mutation] of [
      [
        "expert_referrals",
        `delete from expert_referrals where id = '${referralId}'::uuid`,
      ],
      [
        "expert_first_residency_settlements",
        `update expert_first_residency_settlements set eligibility_reason_code = 'changed' where id = '${settlementId}'::uuid`,
      ],
      [
        "expert_referral_reward_grants",
        `delete from expert_referral_reward_grants where id = '${grantId}'::uuid`,
      ],
      [
        "expert_referral_ledger_entries",
        `update expert_referral_ledger_entries set amount_minor = 99999 where id = '${ledgerId}'::uuid`,
      ],
      [
        "expert_referral_ledger_allocations",
        `delete from expert_referral_ledger_allocations where ledger_entry_id = '${ledgerId}'::uuid`,
      ],
    ] as const) {
      await expectDatabaseError(() => testDb.db.execute(sql.raw(mutation)), {
        code: "55000",
        constraint: `${relation}_append_only`,
      });
    }
  });
});
