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
  adminId: string;
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
  return { adminId, approvalId, sessionIdHash };
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

async function createOrderForExpert(expertId: string): Promise<{
  orderId: string;
  paymentAttemptId: string;
}> {
  const tariffId = await createTariff();
  const orderId = randomUUID();
  const paymentAttemptId = randomUUID();
  await testDb!.db.execute(sql`
    insert into expert_residency_orders (
      id, expert_id, tariff_version_id, snapshot_display_name,
      price_minor, currency, duration_seconds, credit_minor, cash_minor,
      payment_deadline, idempotency_key, created_at
    ) values (
      ${orderId}::uuid, ${expertId}::uuid, ${tariffId}::uuid,
      'Test residency', 1000, 'RUB', 2592000, 0, 1000,
      '2026-08-04T00:00:00.000Z', ${`order:${randomUUID()}`},
      '2026-08-03T00:00:00.000Z'
    );
    insert into expert_residency_payment_attempts (
      id, order_id, provider, provider_request_id, expected_amount_minor,
      currency, status, idempotency_key, resolved_at
    ) values (
      ${paymentAttemptId}::uuid, ${orderId}::uuid, 'test-provider',
      ${`request:${randomUUID()}`}, 1000, 'RUB', 'settled',
      ${`payment:${randomUUID()}`}, '2026-08-03T01:00:00.000Z'
    )
  `);
  return { orderId, paymentAttemptId };
}

async function createReferralGraph(input?: {
  inviterId?: string;
  inviteeId?: string;
}): Promise<{
  inviterId: string;
  inviteeId: string;
  batchId: string;
  codeId: string;
  referralId: string;
}> {
  const inviterId = input?.inviterId ?? (await createExpert());
  const inviteeId = input?.inviteeId ?? (await createExpert());
  const { adminId, approvalId, sessionIdHash } = await createAdminApproval();
  const batchId = randomUUID();
  const codeId = randomUUID();
  const referralId = randomUUID();
  const codeHash = randomUUID().replaceAll("-", "").repeat(2);
  await testDb!.db.execute(sql`
    insert into expert_referral_code_batches (
      id, inviter_expert_id, requested_count, issued_by_admin_id,
      approval_id, admin_session_id_hash
    ) values (
      ${batchId}::uuid, ${inviterId}::uuid, 1, ${adminId}::uuid,
      ${approvalId}::uuid, ${sessionIdHash}
    );
    insert into expert_referral_codes (
      id, batch_id, inviter_expert_id, code_hash, key_version,
      masked_suffix, status, redeemed_at
    ) values (
      ${codeId}::uuid, ${batchId}::uuid, ${inviterId}::uuid,
      ${codeHash}, 1, 'abcdef', 'redeemed', '2026-08-03T00:30:00.000Z'
    );
    insert into expert_referrals (
      id, code_id, inviter_expert_id, invitee_expert_id
    ) values (
      ${referralId}::uuid, ${codeId}::uuid, ${inviterId}::uuid,
      ${inviteeId}::uuid
    )
  `);
  return { inviterId, inviteeId, batchId, codeId, referralId };
}

async function createSettlementFixture(
  eligibility: "eligible" | "pending_feature_hold" = "eligible",
): Promise<{
  inviterId: string;
  inviteeId: string;
  batchId: string;
  codeId: string;
  referralId: string;
  orderId: string;
  paymentAttemptId: string;
  firstSettlementId: string;
}> {
  const graph = await createReferralGraph();
  const payment = await createOrderForExpert(graph.inviteeId);
  const firstSettlementId = randomUUID();
  await testDb!.db.execute(sql`
    insert into expert_first_residency_settlements (
      id, expert_id, qualifying_order_id, qualifying_payment_attempt_id,
      referral_id, eligibility, reason_code, settlement_expert_active,
      settlement_expert_verified, settlement_abuse_cleared, settled_at
    ) values (
      ${firstSettlementId}::uuid, ${graph.inviteeId}::uuid,
      ${payment.orderId}::uuid, ${payment.paymentAttemptId}::uuid,
      ${graph.referralId}::uuid, ${eligibility}, 'eligible_referral',
      true, true, true, '2026-08-03T01:00:00.000Z'
    )
  `);
  return { ...graph, ...payment, firstSettlementId };
}

async function createRewardGrant(
  fixture: {
    inviterId: string;
    referralId: string;
    firstSettlementId: string;
    orderId: string;
    paymentAttemptId: string;
  },
  amountMinor = 100000n,
): Promise<string> {
  const grantId = randomUUID();
  await testDb!.db.execute(sql`
    insert into expert_referral_reward_grants (
      id, expert_id, referral_id, first_settlement_id,
      qualifying_order_id, qualifying_payment_attempt_id, amount_minor,
      granted_at, expires_at, idempotency_key
    ) values (
      ${grantId}::uuid, ${fixture.inviterId}::uuid,
      ${fixture.referralId}::uuid, ${fixture.firstSettlementId}::uuid,
      ${fixture.orderId}::uuid, ${fixture.paymentAttemptId}::uuid,
      ${amountMinor}, '2026-08-03T01:00:00.000Z',
      '2026-08-03T01:00:00.000Z'::timestamptz + interval '365 days',
      ${`grant:${randomUUID()}`}
    )
  `);
  return grantId;
}

async function createAllocatedLedgerEntry(input: {
  expertId: string;
  grantId: string;
  amountMinor: bigint;
  entryKind?: "reward_grant" | "spend";
  originalEntryId?: string;
}): Promise<string> {
  const entryId = randomUUID();
  await testDb!.db.transaction(async (tx) => {
    await tx.execute(sql`
      insert into expert_referral_ledger_entries (
        id, expert_id, entry_kind, amount_minor, original_entry_id,
        source_type, source_id, idempotency_key
      ) values (
        ${entryId}::uuid, ${input.expertId}::uuid,
        ${input.entryKind ?? "reward_grant"}, ${input.amountMinor},
        ${input.originalEntryId ?? null}::uuid, 'test', ${randomUUID()}::uuid,
        ${`ledger:${randomUUID()}`}
      )
    `);
    await tx.execute(sql`
      insert into expert_referral_ledger_allocations (
        ledger_entry_id, reward_grant_id, expert_id, amount_minor
      ) values (
        ${entryId}::uuid, ${input.grantId}::uuid, ${input.expertId}::uuid,
        ${input.amountMinor}
      )
    `);
  });
  return entryId;
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

  it("enforces reviewed singleton and duplicate guards with stable evidence", async () => {
    const userId = randomUUID();
    await testDb!.db.execute(sql`
      insert into users (id) values (${userId}::uuid);
      insert into experts (user_id) values (${userId}::uuid)
    `);
    await expectDatabaseError(
      () =>
        testDb!.db.execute(sql`
          insert into experts (user_id) values (${userId}::uuid)
        `),
      { code: "23505", constraint: "experts_user_id_unique" },
    );

    const fixture = await createSettlementFixture();
    await expectDatabaseError(() => createRewardGrant(fixture, 99999n), {
      code: "23514",
      constraint: "expert_reward_grant_exact_amount",
    });

    const secondPayment = await createOrderForExpert(fixture.inviteeId);
    await expectDatabaseError(
      () =>
        testDb!.db.execute(sql`
          insert into expert_first_residency_settlements (
            expert_id, qualifying_order_id, qualifying_payment_attempt_id,
            referral_id, eligibility, reason_code, settlement_expert_active,
            settlement_expert_verified, settlement_abuse_cleared, settled_at
          ) values (
            ${fixture.inviteeId}::uuid, ${secondPayment.orderId}::uuid,
            ${secondPayment.paymentAttemptId}::uuid, ${fixture.referralId}::uuid,
            'eligible', 'duplicate_first', true, true, true,
            '2026-08-03T02:00:00.000Z'
          )
        `),
      { code: "23505", constraint: "expert_first_settlement_expert_unique" },
    );

    const firstHoldApproval = await createAdminApproval();
    const secondHoldApproval = await createAdminApproval();
    await testDb!.db.execute(sql`
      insert into expert_referral_abuse_holds (
        expert_id, reason_code, opened_approval_id,
        opened_admin_session_id_hash
      ) values (
        ${fixture.inviterId}::uuid, 'review',
        ${firstHoldApproval.approvalId}::uuid,
        ${firstHoldApproval.sessionIdHash}
      )
    `);
    await expectDatabaseError(
      () =>
        testDb!.db.execute(sql`
          insert into expert_referral_abuse_holds (
            expert_id, reason_code, opened_approval_id,
            opened_admin_session_id_hash
          ) values (
            ${fixture.inviterId}::uuid, 'second_review',
            ${secondHoldApproval.approvalId}::uuid,
            ${secondHoldApproval.sessionIdHash}
          )
        `),
      { code: "23505", constraint: "expert_abuse_holds_one_open_per_expert" },
    );

    const controlApproval = await createAdminApproval();
    await expectDatabaseError(
      () =>
        testDb!.db.execute(sql`
          insert into expert_referral_feature_controls (
            control_key, version, updated_approval_id,
            updated_admin_session_id_hash
          ) values (
            'unexpected_control', 1, ${controlApproval.approvalId}::uuid,
            ${controlApproval.sessionIdHash}
          )
        `),
      { code: "23514", constraint: "expert_referral_controls_singleton" },
    );

    const eventId = `event:${randomUUID()}`;
    await testDb!.db.execute(sql`
      insert into expert_residency_provider_event_inbox (
        provider, external_event_id, payload_digest, event_kind, authenticated
      ) values ('test-provider', ${eventId}, ${"a".repeat(64)}, 'settled', true)
    `);
    await expectDatabaseError(
      () =>
        testDb!.db.execute(sql`
          insert into expert_residency_provider_event_inbox (
            provider, external_event_id, payload_digest, event_kind, authenticated
          ) values ('test-provider', ${eventId}, ${"b".repeat(64)}, 'settled', true)
        `),
      { code: "23505", constraint: "expert_provider_event_unique" },
    );
  });

  it("rejects cross-owner referral, settlement, reward, and allocation links", async () => {
    const owner = await createExpert();
    const other = await createExpert();
    const { adminId, approvalId, sessionIdHash } = await createAdminApproval();
    const batchId = randomUUID();
    await testDb!.db.execute(sql`
      insert into expert_referral_code_batches (
        id, inviter_expert_id, requested_count, issued_by_admin_id,
        approval_id, admin_session_id_hash
      ) values (
        ${batchId}::uuid, ${owner}::uuid, 1, ${adminId}::uuid,
        ${approvalId}::uuid, ${sessionIdHash}
      )
    `);
    await expectDatabaseError(
      () =>
        testDb!.db.execute(sql`
          insert into expert_referral_codes (
            batch_id, inviter_expert_id, code_hash, key_version, masked_suffix
          ) values (
            ${batchId}::uuid, ${other}::uuid, ${"c".repeat(64)}, 1, 'cccccc'
          )
        `),
      { code: "23503", constraint: "expert_referral_codes_batch_owner_fk" },
    );

    const unusedCodeId = randomUUID();
    await testDb!.db.execute(sql`
      insert into expert_referral_codes (
        id, batch_id, inviter_expert_id, code_hash, key_version, masked_suffix
      ) values (
        ${unusedCodeId}::uuid, ${batchId}::uuid, ${owner}::uuid,
        ${"d".repeat(64)}, 1, 'dddddd'
      )
    `);
    const wrongInvitee = await createExpert();
    await expectDatabaseError(
      () =>
        testDb!.db.execute(sql`
          insert into expert_referrals (
            code_id, inviter_expert_id, invitee_expert_id
          ) values (
            ${unusedCodeId}::uuid, ${other}::uuid, ${wrongInvitee}::uuid
          )
        `),
      { code: "23503", constraint: "expert_referrals_code_owner_fk" },
    );

    const graph = await createReferralGraph();
    const thirdExpert = await createExpert();
    const ownerPayment = await createOrderForExpert(graph.inviterId);
    await expectDatabaseError(
      () =>
        testDb!.db.execute(sql`
          insert into expert_first_residency_settlements (
            expert_id, qualifying_order_id, qualifying_payment_attempt_id,
            referral_id, eligibility, reason_code, settlement_expert_active,
            settlement_expert_verified, settlement_abuse_cleared, settled_at
          ) values (
            ${graph.inviteeId}::uuid, ${ownerPayment.orderId}::uuid,
            ${ownerPayment.paymentAttemptId}::uuid, ${graph.referralId}::uuid,
            'eligible', 'wrong_order_owner', true, true, true,
            '2026-08-03T01:00:00.000Z'
          )
        `),
      { code: "23503", constraint: "expert_first_settlement_order_owner_fk" },
    );

    const firstInviteePayment = await createOrderForExpert(graph.inviteeId);
    const secondInviteePayment = await createOrderForExpert(graph.inviteeId);
    await expectDatabaseError(
      () =>
        testDb!.db.execute(sql`
          insert into expert_first_residency_settlements (
            expert_id, qualifying_order_id, qualifying_payment_attempt_id,
            referral_id, eligibility, reason_code, settlement_expert_active,
            settlement_expert_verified, settlement_abuse_cleared, settled_at
          ) values (
            ${graph.inviteeId}::uuid, ${firstInviteePayment.orderId}::uuid,
            ${secondInviteePayment.paymentAttemptId}::uuid,
            ${graph.referralId}::uuid, 'eligible', 'wrong_payment_order',
            true, true, true, '2026-08-03T01:00:00.000Z'
          )
        `),
      { code: "23503", constraint: "expert_first_settlement_payment_order_fk" },
    );

    const unrelatedGraph = await createReferralGraph();
    const validInviteePayment = await createOrderForExpert(graph.inviteeId);
    await expectDatabaseError(
      () =>
        testDb!.db.execute(sql`
          insert into expert_first_residency_settlements (
            expert_id, qualifying_order_id, qualifying_payment_attempt_id,
            referral_id, eligibility, reason_code, settlement_expert_active,
            settlement_expert_verified, settlement_abuse_cleared, settled_at
          ) values (
            ${graph.inviteeId}::uuid, ${validInviteePayment.orderId}::uuid,
            ${validInviteePayment.paymentAttemptId}::uuid,
            ${unrelatedGraph.referralId}::uuid, 'eligible',
            'wrong_referral_invitee', true, true, true,
            '2026-08-03T01:00:00.000Z'
          )
        `),
      {
        code: "23503",
        constraint: "expert_first_settlement_referral_invitee_fk",
      },
    );

    const fixture = await createSettlementFixture();
    await expectDatabaseError(
      () =>
        testDb!.db.execute(sql`
          insert into expert_referral_reward_grants (
            expert_id, referral_id, first_settlement_id, qualifying_order_id,
            qualifying_payment_attempt_id, granted_at, expires_at,
            idempotency_key
          ) values (
            ${thirdExpert}::uuid, ${fixture.referralId}::uuid,
            ${fixture.firstSettlementId}::uuid, ${fixture.orderId}::uuid,
            ${fixture.paymentAttemptId}::uuid,
            '2026-08-03T01:00:00.000Z',
            '2026-08-03T01:00:00.000Z'::timestamptz + interval '365 days',
            ${`wrong-owner:${randomUUID()}`}
          )
        `),
      { code: "23503", constraint: "expert_reward_grants_referral_inviter_fk" },
    );

    const otherFixture = await createSettlementFixture();
    await expectDatabaseError(
      () =>
        testDb!.db.execute(sql`
          insert into expert_referral_reward_grants (
            expert_id, referral_id, first_settlement_id, qualifying_order_id,
            qualifying_payment_attempt_id, granted_at, expires_at,
            idempotency_key
          ) values (
            ${otherFixture.inviterId}::uuid, ${otherFixture.referralId}::uuid,
            ${fixture.firstSettlementId}::uuid, ${otherFixture.orderId}::uuid,
            ${otherFixture.paymentAttemptId}::uuid,
            '2026-08-03T01:00:00.000Z',
            '2026-08-03T01:00:00.000Z'::timestamptz + interval '365 days',
            ${`wrong-marker:${randomUUID()}`}
          )
        `),
      { code: "23503", constraint: "expert_reward_grants_first_marker_fk" },
    );

    const grantId = await createRewardGrant(fixture);
    const wrongEntryId = randomUUID();
    await expectDatabaseError(
      () =>
        testDb!.db.transaction(async (tx) => {
          await tx.execute(sql`
            insert into expert_referral_ledger_entries (
              id, expert_id, entry_kind, amount_minor, source_type,
              source_id, idempotency_key
            ) values (
              ${wrongEntryId}::uuid, ${thirdExpert}::uuid, 'reward_grant',
              100000, 'test', ${randomUUID()}::uuid,
              ${`wrong-allocation:${randomUUID()}`}
            )
          `);
          await tx.execute(sql`
            insert into expert_referral_ledger_allocations (
              ledger_entry_id, reward_grant_id, expert_id, amount_minor
            ) values (
              ${wrongEntryId}::uuid, ${grantId}::uuid, ${thirdExpert}::uuid,
              100000
            )
          `);
        }),
      { code: "23503", constraint: "expert_ledger_allocations_grant_owner_fk" },
    );
  });

  it("requires every ledger entry to be attributed exactly to owned grants", async () => {
    const fixture = await createSettlementFixture();
    const grantId = await createRewardGrant(fixture);
    const missingEntryId = randomUUID();
    await expectDatabaseError(
      () =>
        testDb!.db.transaction(async (tx) => {
          await tx.execute(sql`
            insert into expert_referral_ledger_entries (
              id, expert_id, entry_kind, amount_minor, source_type,
              source_id, idempotency_key
            ) values (
              ${missingEntryId}::uuid, ${fixture.inviterId}::uuid,
              'reward_grant', 100000, 'test', ${randomUUID()}::uuid,
              ${`missing-allocation:${randomUUID()}`}
            )
          `);
        }),
      { code: "23514", constraint: "expert_ledger_allocations_exact_total" },
    );

    const partialEntryId = randomUUID();
    await expectDatabaseError(
      () =>
        testDb!.db.transaction(async (tx) => {
          await tx.execute(sql`
            insert into expert_referral_ledger_entries (
              id, expert_id, entry_kind, amount_minor, source_type,
              source_id, idempotency_key
            ) values (
              ${partialEntryId}::uuid, ${fixture.inviterId}::uuid,
              'reward_grant', 100000, 'test', ${randomUUID()}::uuid,
              ${`partial-allocation:${randomUUID()}`}
            )
          `);
          await tx.execute(sql`
            insert into expert_referral_ledger_allocations (
              ledger_entry_id, reward_grant_id, expert_id, amount_minor
            ) values (
              ${partialEntryId}::uuid, ${grantId}::uuid,
              ${fixture.inviterId}::uuid, 99999
            )
          `);
        }),
      { code: "23514", constraint: "expert_ledger_allocations_exact_total" },
    );

    const grantEntryId = await createAllocatedLedgerEntry({
      expertId: fixture.inviterId,
      grantId,
      amountMinor: 100000n,
    });
    const beforeSpend = await testDb!.db.execute<{ nearest: Date | null }>(sql`
      select nearest_expiry_at as nearest
      from expert_referral_balances
      where expert_id = ${fixture.inviterId}::uuid
    `);
    expect(beforeSpend.rows[0]?.nearest).not.toBeNull();

    await createAllocatedLedgerEntry({
      expertId: fixture.inviterId,
      grantId,
      amountMinor: -100000n,
      entryKind: "spend",
      originalEntryId: grantEntryId,
    });
    const afterSpend = await testDb!.db.execute<{ nearest: Date | null }>(sql`
      select nearest_expiry_at as nearest
      from expert_referral_balances
      where expert_id = ${fixture.inviterId}::uuid
    `);
    expect(afterSpend.rows[0]?.nearest).toBeNull();
  });

  it("keeps history append-only while allowing only pending marker resolution", async () => {
    const fixture = await createSettlementFixture();
    const grantId = await createRewardGrant(fixture);
    const ledgerEntryId = await createAllocatedLedgerEntry({
      expertId: fixture.inviterId,
      grantId,
      amountMinor: 100000n,
    });

    for (const operation of [
      () =>
        testDb!.db.execute(sql`
          update expert_referrals set bound_at = now()
          where id = ${fixture.referralId}::uuid
        `),
      () =>
        testDb!.db.execute(sql`
          update expert_referral_reward_grants set idempotency_key = 'changed'
          where id = ${grantId}::uuid
        `),
      () =>
        testDb!.db.execute(sql`
          update expert_referral_ledger_entries set source_type = 'changed'
          where id = ${ledgerEntryId}::uuid
        `),
      () =>
        testDb!.db.execute(sql`
          update expert_referral_ledger_allocations set amount_minor = 1
          where ledger_entry_id = ${ledgerEntryId}::uuid
        `),
    ]) {
      await expectDatabaseError(operation, { code: "55000" });
    }

    const pendingFixture = await createSettlementFixture(
      "pending_feature_hold",
    );
    await testDb!.db.execute(sql`
      update expert_first_residency_settlements
      set eligibility = 'eligible', reason_code = 'feature_enabled'
      where id = ${pendingFixture.firstSettlementId}::uuid
    `);
    await expectDatabaseError(
      () =>
        testDb!.db.execute(sql`
          update expert_first_residency_settlements
          set reason_code = 'second_resolution'
          where id = ${pendingFixture.firstSettlementId}::uuid
        `),
      { code: "55000", constraint: "expert_first_settlement_transition" },
    );
    await expectDatabaseError(
      () =>
        testDb!.db.execute(sql`
          delete from expert_first_residency_settlements
          where id = ${pendingFixture.firstSettlementId}::uuid
        `),
      { code: "55000", constraint: "expert_first_settlement_transition" },
    );

    const immutableFixture = await createSettlementFixture(
      "pending_feature_hold",
    );
    await expectDatabaseError(
      () =>
        testDb!.db.execute(sql`
          update expert_first_residency_settlements
          set eligibility = 'permanently_ineligible', settled_at = now()
          where id = ${immutableFixture.firstSettlementId}::uuid
        `),
      { code: "55000", constraint: "expert_first_settlement_transition" },
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
      "expert_referral_ledger_allocations",
      "expert_referral_ledger_entries",
      "expert_referral_reward_grants",
      "expert_referrals",
    ]);

    const guardedMarker = await testDb!.db.execute<{ count: string }>(sql`
      select count(*)::text as count
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      where c.relname = 'expert_first_residency_settlements'
        and t.tgname = 'expert_first_settlement_guard'
        and not t.tgisinternal
    `);
    expect(guardedMarker.rows[0]?.count).toBe("1");
  });
});
