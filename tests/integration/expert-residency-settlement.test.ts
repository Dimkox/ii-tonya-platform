import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  ExpertCodeCrypto,
  type ExpertCodeKeyring,
} from "../../packages/application/src/expert-code-crypto.js";
import type { ExpertResidencyPaymentEvent } from "../../packages/contracts/src/index.js";
import { PostgresExpertReferralRepository } from "../../packages/db/src/repositories/expert-referral-repository.js";
import { PostgresExpertResidencyProviderInboxRepository } from "../../packages/db/src/repositories/expert-residency-provider-inbox-repository.js";
import { PostgresExpertResidencyRepository } from "../../packages/db/src/repositories/expert-residency-repository.js";
import { ExpertReferralTestkit } from "../../packages/db/src/testkit/expert-referral.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";
import { verifiedEventFixture } from "../../packages/integrations/src/expert-residency/verified-event.js";

const keyring: ExpertCodeKeyring = {
  currentVersion: "v1",
  versions: ["v1"],
  key(version) {
    if (version !== "v1") throw new Error("unknown_key_version");
    return new Uint8Array(32).fill(6);
  },
};

let testDb: TestDatabase;
let fixtures: ExpertReferralTestkit;

beforeAll(async () => {
  testDb = await startTestPostgres();
  await testDb.migrate();
  fixtures = new ExpertReferralTestkit(testDb.db);
}, 120_000);
beforeEach(async () => testDb.reset());
afterAll(async () => testDb?.stop(), 120_000);

async function dbNow(): Promise<Date> {
  const row = (
    await testDb.db.execute<{ now: Date | string }>(
      sql`select transaction_timestamp() as now`,
    )
  ).rows[0];
  if (row === undefined) throw new Error("database clock unavailable");
  return new Date(row.now);
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

async function seedSpendableGrant(expertId: string): Promise<void> {
  const sourceInvitee = await fixtures.createExpert();
  const referralId = randomUUID();
  const tariffId = randomUUID();
  const orderId = randomUUID();
  const settlementId = randomUUID();
  const grantId = randomUUID();
  const ledgerId = randomUUID();
  const evidence = await fixtures.createAdminEvidence(
    "expert_residency.tariff_create",
    tariffId,
    { priceMinor: "1", durationSeconds: 86_400 },
  );
  await testDb.db.transaction(async (tx) => {
    const batchId = randomUUID();
    const codeId = randomUUID();
    await tx.execute(sql`insert into expert_referral_code_batches (
      id, inviter_expert_id, requested_count, issued_by_admin_id, approval_id, admin_session_id_hash
    ) values (${batchId}::uuid, ${expertId}::uuid, 1, ${evidence.adminId}::uuid,
      ${evidence.approvalId}::uuid, ${evidence.sessionIdHash})`);
    await tx.execute(sql`insert into expert_referral_codes (
      id, batch_id, inviter_expert_id, code_hash, masked_suffix, hmac_key_version,
      status, redeemed_at
    ) values (${codeId}::uuid, ${batchId}::uuid, ${expertId}::uuid,
      ${`seed-${codeId}`}, '…seed', 1, 'redeemed', transaction_timestamp())`);
    await tx.execute(sql`insert into expert_referrals (
      id, code_id, inviter_expert_id, invitee_expert_id
    ) values (${referralId}::uuid, ${codeId}::uuid, ${expertId}::uuid,
      ${sourceInvitee.expertId}::uuid)`);
    await tx.execute(sql`insert into expert_residency_tariff_versions (
      id, tariff_key, version, display_name, description, price_minor, currency,
      duration_seconds, active_from, created_by_admin_id, approval_id, admin_session_id_hash
    ) values (${tariffId}::uuid, ${`seed-${tariffId}`}, 1, 'Seed', 'Seed', 1, 'RUB',
      86400, '2020-01-01T00:00:00Z', ${evidence.adminId}::uuid,
      ${evidence.approvalId}::uuid, ${evidence.sessionIdHash})`);
    await tx.execute(sql`insert into expert_residency_orders (
      id, expert_id, tariff_version_id, tariff_name, tariff_description, price_minor,
      currency, duration_seconds, credit_minor, cash_minor, payment_deadline,
      provider_deadline, idempotency_key, status, quoted_at, settled_at,
      residency_starts_at, residency_ends_at
    ) values (${orderId}::uuid, ${sourceInvitee.expertId}::uuid, ${tariffId}::uuid,
      'Seed', 'Seed', 1, 'RUB', 86400, 0, 1, transaction_timestamp() + interval '2 days',
      transaction_timestamp() + interval '2 days', ${`seed-${orderId}`}, 'settled',
      transaction_timestamp() - interval '1 day', transaction_timestamp() - interval '1 day',
      transaction_timestamp() - interval '1 day', transaction_timestamp())`);
    await tx.execute(sql`insert into expert_first_residency_settlements (
      id, expert_id, qualifying_order_id, eligibility_status, eligibility_reason_code,
      expert_active, expert_verified, unique_identity, abuse_cleared, settled_at
    ) values (${settlementId}::uuid, ${sourceInvitee.expertId}::uuid, ${orderId}::uuid,
      'eligible', 'eligible', true, true, true, true, transaction_timestamp() - interval '1 day')`);
    await tx.execute(sql`insert into expert_referral_reward_grants (
      id, inviter_expert_id, referral_id, qualifying_order_id, first_settlement_id,
      amount_minor, granted_at, expires_at
    ) values (${grantId}::uuid, ${expertId}::uuid, ${referralId}::uuid, ${orderId}::uuid,
      ${settlementId}::uuid, 100000, transaction_timestamp(),
      transaction_timestamp() + interval '365 days')`);
    await tx.execute(sql`insert into expert_referral_ledger_entries (
      id, account_expert_id, entry_kind, amount_minor, source_type, source_id,
      reward_grant_id, idempotency_key
    ) values (${ledgerId}::uuid, ${expertId}::uuid, 'reward_grant', 100000,
      'reward_grant', ${grantId}::uuid, ${grantId}::uuid, ${`seed-${grantId}`})`);
    await tx.execute(sql`insert into expert_referral_ledger_allocations (
      ledger_entry_id, reward_grant_id, amount_minor
    ) values (${ledgerId}::uuid, ${grantId}::uuid, 100000)`);
  });
}

interface Scenario {
  inviterId: string;
  inviteeId: string;
  orderId: string;
  paymentId: string;
  event: ExpertResidencyPaymentEvent;
}

async function scenario(
  input: {
    credit?: boolean;
    rewardEnabled?: boolean;
  } = {},
): Promise<Scenario> {
  const featureControlExists = (
    await testDb.db.execute<{ exists: boolean }>(sql`select exists (
      select 1 from expert_referral_feature_controls
      where feature_key = 'expert_referrals'
    ) as exists`)
  ).rows[0]?.exists;
  if (!featureControlExists) await fixtures.enableFeatureControl();
  const inviter = await fixtures.createExpert();
  const invitee = await fixtures.createExpert();
  const referralRepo = new PostgresExpertReferralRepository(
    testDb.db,
    new ExpertCodeCrypto(keyring),
  );
  const issueEvidence = await fixtures.createAdminEvidence(
    "expert_referral.batch_generate",
    inviter.expertId,
    { count: 1, overrideId: null },
  );
  const batch = await referralRepo.issueBatch({
    inviterExpertId: inviter.expertId,
    count: 1,
    ...issueEvidence,
  });
  await referralRepo.redeemCode({
    plaintext: batch.codes[0]!.plaintext,
    inviteeExpertId: invitee.expertId,
    provider: invitee.provider,
    externalId: invitee.externalId,
  });
  if (input.credit) await seedSpendableGrant(invitee.expertId);
  if (input.rewardEnabled === false) {
    await testDb.db.execute(sql`update expert_referral_feature_controls
      set reward_grants_enabled = false, version = version + 1`);
  }

  const now = await dbNow();
  const tariffVersionId = randomUUID();
  const tariffKey = `settlement-${tariffVersionId}`;
  const evidence = await fixtures.createAdminEvidence(
    "expert_residency.tariff_create",
    tariffVersionId,
    {
      tariffKey,
      version: 1,
      displayName: "Settlement tariff",
      description: "Settlement fixture",
      priceMinor: "100000",
      durationSeconds: 2_592_000,
      activeFrom: new Date(now.getTime() - 86_400_000).toISOString(),
      activeTo: null,
    },
  );
  const residencyRepo = new PostgresExpertResidencyRepository(testDb.db);
  await residencyRepo.createTariffVersion({
    tariffVersionId,
    tariffKey,
    version: 1,
    displayName: "Settlement tariff",
    description: "Settlement fixture",
    priceMinor: 100000n,
    durationSeconds: 2_592_000,
    activeFrom: new Date(now.getTime() - 86_400_000),
    activeTo: null,
    ...evidence,
  });
  const order = await residencyRepo.createCheckoutOrder({
    expertId: invitee.expertId,
    tariffKey,
    providerDeadline: new Date(now.getTime() + 86_400_000),
    idempotencyKey: `checkout-${tariffVersionId}`,
  });
  const attemptId = randomUUID();
  const paymentId = `pay_${randomUUID()}`;
  await testDb.db.transaction(async (tx) => {
    await tx.execute(sql`insert into expert_residency_payment_attempts (
      id, order_id, provider, provider_request_id, expected_amount_minor,
      currency, status, idempotency_key
    ) values (${attemptId}::uuid, ${order.orderId}::uuid, 'sandbox', ${paymentId},
      ${BigInt(order.cashMinor)}, 'RUB', 'pending', ${`attempt-${attemptId}`})`);
    await tx.execute(sql`update expert_residency_orders set
      payment_provider = 'sandbox', provider_payment_id = ${paymentId},
      status = 'payment_pending', payment_started_at = transaction_timestamp()
      where id = ${order.orderId}::uuid`);
  });
  const digest = `sha256:${"a".repeat(64)}`;
  return {
    inviterId: inviter.expertId,
    inviteeId: invitee.expertId,
    orderId: order.orderId,
    paymentId,
    event: {
      kind: "settled",
      provider: "sandbox",
      eventId: `evt_${randomUUID()}`,
      paymentId,
      orderId: order.orderId,
      amountMinor: order.cashMinor,
      currency: "RUB",
      occurredAt: "2026-08-03T00:00:00.000Z",
      payloadDigest: digest,
    },
  };
}

function verified(
  event: ExpertResidencyPaymentEvent,
): Parameters<PostgresExpertResidencyProviderInboxRepository["settle"]>[0] {
  return verifiedEventFixture(event, {
    verificationId: `verify_${event.eventId}`,
    verifierKeyVersion: "sandbox-v1",
    verifiedAt: "2026-08-03T00:00:01.000Z",
    payloadDigest: event.payloadDigest,
  }) as unknown as Parameters<
    PostgresExpertResidencyProviderInboxRepository["settle"]
  >[0];
}

describe("expert residency settlement", () => {
  it("rejects an unverified raw event before claiming the inbox", async () => {
    const prepared = await scenario();
    const repo = new PostgresExpertResidencyProviderInboxRepository(testDb.db);

    await expect(repo.settle(prepared.event as never)).rejects.toThrow(
      "verified_event_required",
    );
    const count = (
      await testDb.db.execute<{
        count: number;
      }>(sql`select count(*)::integer as count
        from expert_residency_provider_event_inbox`)
    ).rows[0]?.count;
    expect(count).toBe(0);
  });

  it("settles exact cash, spends immutable reservation allocations, rewards once, and replays stably", async () => {
    const prepared = await scenario({ credit: true });
    const repo = new PostgresExpertResidencyProviderInboxRepository(testDb.db);
    const event = verified(prepared.event);

    const first = await repo.settle(event);
    const replay = await repo.settle(event);

    expect(replay).toEqual(first);
    expect(first).toMatchObject({
      kind: "settled",
      orderId: prepared.orderId,
      eligibilityStatus: "eligible",
      rewardEffect: { kind: "reward_granted", amountMinor: "100000" },
    });
    const order = (
      await testDb.db.execute<{
        status: string;
        settledAt: Date | string;
        residencyStartsAt: Date | string;
        residencyEndsAt: Date | string;
      }>(sql`select status, settled_at as "settledAt",
        residency_starts_at as "residencyStartsAt", residency_ends_at as "residencyEndsAt"
        from expert_residency_orders where id = ${prepared.orderId}::uuid`)
    ).rows[0]!;
    expect(order.status).toBe("settled");
    expect(asDate(order.residencyStartsAt).getTime()).toBe(
      asDate(order.settledAt).getTime(),
    );
    expect(
      asDate(order.residencyEndsAt).getTime() -
        asDate(order.residencyStartsAt).getTime(),
    ).toBe(2_592_000_000);
    const allocations = (
      await testDb.db.execute<{
        entryKind: string;
        rewardGrantId: string;
        amountMinor: string;
      }>(sql`select l.entry_kind as "entryKind", a.reward_grant_id as "rewardGrantId",
        a.amount_minor::text as "amountMinor"
        from expert_referral_ledger_entries l
        join expert_referral_ledger_allocations a on a.ledger_entry_id = l.id
        where l.source_type = 'residency_order' and l.source_id = ${prepared.orderId}::uuid
        order by l.entry_kind, a.reward_grant_id`)
    ).rows;
    expect(allocations.map((row) => row.entryKind)).toEqual([
      "reservation",
      "spend",
    ]);
    expect(allocations[1]).toMatchObject({
      rewardGrantId: allocations[0]!.rewardGrantId,
      amountMinor: allocations[0]!.amountMinor,
    });
    const effects = (
      await testDb.db.execute<{
        markers: number;
        grants: number;
        audits: number;
        outbox: number;
      }>(sql`
        select
          (select count(*)::integer from expert_first_residency_settlements where expert_id = ${prepared.inviteeId}::uuid) as markers,
          (select count(*)::integer from expert_referral_reward_grants where inviter_expert_id = ${prepared.inviterId}::uuid) as grants,
          (select count(*)::integer from audit_events where action = 'expert_residency.settled' and object_id = ${prepared.orderId}::uuid) as audits,
          (select count(*)::integer from integration_outbox where idempotency_key = ${`expert-residency-settled:${prepared.orderId}`}) as outbox
      `)
    ).rows[0]!;
    expect(effects).toEqual({ markers: 1, grants: 1, audits: 1, outbox: 1 });

    const inbox = (
      await testDb.db.execute<{
        verificationId: string;
        verifierKeyVersion: string;
        verifiedAt: Date | string;
        authenticated: boolean;
        payloadDigest: string;
      }>(sql`select verification_id as "verificationId",
        verifier_key_version as "verifierKeyVersion", verified_at as "verifiedAt",
        authenticated, payload_digest as "payloadDigest"
        from expert_residency_provider_event_inbox`)
    ).rows[0]!;
    expect(inbox).toMatchObject({
      verificationId: `verify_${prepared.event.eventId}`,
      verifierKeyVersion: "sandbox-v1",
      authenticated: true,
      payloadDigest: prepared.event.payloadDigest,
    });
    expect(asDate(inbox.verifiedAt).toISOString()).toBe(
      "2026-08-03T00:00:01.000Z",
    );
    const rawColumns = await testDb.db.execute<{ columnName: string }>(sql`
      select column_name as "columnName" from information_schema.columns
      where table_schema = 'public'
        and table_name = 'expert_residency_provider_event_inbox'
        and column_name in ('raw_payload', 'raw_body', 'headers', 'payload')
    `);
    expect(rawColumns.rows).toEqual([]);
  });

  it("records exact amount and currency failures and rejects conflicting replay content", async () => {
    const amountScenario = await scenario();
    const repo = new PostgresExpertResidencyProviderInboxRepository(testDb.db);
    const mismatchedAmount = {
      ...amountScenario.event,
      amountMinor: (BigInt(amountScenario.event.amountMinor) + 1n).toString(),
    };
    await expect(repo.settle(verified(mismatchedAmount))).rejects.toThrow(
      "payment_amount_mismatch",
    );

    const currencyScenario = await scenario();
    await expect(
      repo.settle(verified({ ...currencyScenario.event, currency: "USD" })),
    ).rejects.toThrow("payment_currency_mismatch");

    const replayScenario = await scenario();
    await repo.settle(verified(replayScenario.event));
    await expect(
      repo.settle(
        verified({
          ...replayScenario.event,
          amountMinor: (
            BigInt(replayScenario.event.amountMinor) + 1n
          ).toString(),
        }),
      ),
    ).rejects.toThrow("provider_event_replay_conflict");
    const failed = (
      await testDb.db.execute<{
        count: number;
      }>(sql`select count(*)::integer as count
        from expert_residency_provider_event_inbox where processing_status = 'failed'`)
    ).rows[0]?.count;
    expect(failed).toBe(2);
  });

  it("durably records a verified payment identity mismatch and replays it stably", async () => {
    const prepared = await scenario();
    const repo = new PostgresExpertResidencyProviderInboxRepository(testDb.db);
    const mismatched = verified({
      ...prepared.event,
      paymentId: `pay_wrong_${randomUUID()}`,
    });

    await expect(repo.settle(mismatched)).rejects.toThrow(
      "payment_identity_mismatch",
    );
    const failedBeforeReplay = (
      await testDb.db.execute<{
        status: string;
        resultDigest: string;
        orderId: string;
      }>(sql`select processing_status as status,
        processing_result_digest as "resultDigest", order_id as "orderId"
        from expert_residency_provider_event_inbox
        where provider = ${prepared.event.provider}
          and external_event_id = ${prepared.event.eventId}`)
    ).rows[0];
    expect(failedBeforeReplay).toMatchObject({
      status: "failed",
      orderId: prepared.orderId,
    });
    expect(failedBeforeReplay?.resultDigest).toMatch(/^sha256:[a-f0-9]{64}$/);

    await expect(repo.settle(mismatched)).rejects.toThrow(
      "payment_identity_mismatch",
    );
    const failedAfterReplay = (
      await testDb.db.execute<{
        status: string;
        resultDigest: string;
        orderId: string;
      }>(sql`select processing_status as status,
        processing_result_digest as "resultDigest", order_id as "orderId"
        from expert_residency_provider_event_inbox
        where provider = ${prepared.event.provider}
          and external_event_id = ${prepared.event.eventId}`)
    ).rows[0];
    expect(failedAfterReplay).toEqual(failedBeforeReplay);
  });

  it("expires and releases at database deadline equality without settling", async () => {
    const prepared = await scenario({ credit: true });
    await testDb.db.execute(sql`alter table expert_residency_orders
      disable trigger expert_order_snapshot_immutable`);
    await testDb.db.execute(sql`update expert_residency_orders
      set payment_deadline = transaction_timestamp() where id = ${prepared.orderId}::uuid`);
    await testDb.db.execute(sql`alter table expert_residency_orders
      enable trigger expert_order_snapshot_immutable`);

    const result = await new PostgresExpertResidencyProviderInboxRepository(
      testDb.db,
    ).settle(verified(prepared.event));

    expect(result).toEqual({ kind: "expired", orderId: prepared.orderId });
    const state = (
      await testDb.db.execute<{
        status: string;
        terminal: string;
        markers: number;
      }>(sql`
        select o.status,
          (select entry_kind::text from expert_referral_ledger_entries
            where source_type = 'residency_order' and source_id = o.id and entry_kind = 'release') as terminal,
          (select count(*)::integer from expert_first_residency_settlements
            where expert_id = o.expert_id) as markers
        from expert_residency_orders o where o.id = ${prepared.orderId}::uuid
      `)
    ).rows[0]!;
    expect(state).toEqual({
      status: "expired",
      terminal: "release",
      markers: 0,
    });
  });

  it("settles residency but permanently records ineligible or held reward decisions", async () => {
    const inactive = await scenario();
    await testDb.db.execute(sql`update experts set verified = false
      where id = ${inactive.inviteeId}::uuid`);
    const repo = new PostgresExpertResidencyProviderInboxRepository(testDb.db);
    const ineligible = await repo.settle(verified(inactive.event));
    expect(ineligible).toMatchObject({
      kind: "settled",
      eligibilityStatus: "ineligible",
      rewardEffect: { kind: "none" },
    });

    const held = await scenario({ rewardEnabled: false });
    const heldResult = await repo.settle(verified(held.event));
    expect(heldResult).toMatchObject({
      kind: "settled",
      eligibilityStatus: "pending_feature_hold",
      rewardEffect: { kind: "none" },
    });
    const grants = (
      await testDb.db.execute<{
        count: number;
      }>(sql`select count(*)::integer as count
        from expert_referral_reward_grants
        where qualifying_order_id in (${inactive.orderId}::uuid, ${held.orderId}::uuid)`)
    ).rows[0]?.count;
    expect(grants).toBe(0);
  });
});
