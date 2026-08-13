import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ExpertCodeCrypto } from "../../packages/application/src/expert-code-crypto.js";
import {
  PostgresAdminApprovalRepository,
  PostgresExpertReferralControlRepository,
  PostgresExpertReferralRepository,
  PostgresExpertResidencyProviderInboxRepository,
  PostgresExpertResidencyRepository,
} from "../../packages/db/src/index.js";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../../packages/db/src/testkit/expert-referral.js";
import { createCanonicalExpertResidencyPaymentEventVerifier } from "../../packages/integrations/src/index.js";
import {
  createSandboxEventVerifier,
  deliverSandboxPaymentEvent,
  migrateSandboxDatabase,
  PostgresSandboxPaymentRepository,
  sandboxApprovalObjectId,
  SandboxExpertResidencyPaymentAdapter,
  SandboxTransitionWorkflow,
} from "../../packages/sandbox-payments/src/index.js";

let testDb: ExpertReferralTestDatabase | undefined;
const crypto = new ExpertCodeCrypto({
  currentVersion: "v1",
  activeVersions: ["v1"],
  key: () => new Uint8Array(32).fill(41),
});

beforeAll(async () => {
  testDb = await startExpertReferralTestDatabase();
  await migrateSandboxDatabase(testDb.db);
}, 120_000);
afterAll(async () => testDb?.stop(), 60_000);

async function admin() {
  const id = await testDb!.createUser();
  const sessionIdHash = `session-${randomUUID()}`;
  await testDb!.db.execute(
    sql`insert into admin_role_assignments (admin_id,role) values (${id}::uuid,'entitlement_admin')`,
  );
  await testDb!.db.execute(
    sql`insert into admin_sessions (session_id_hash,admin_id,mfa_verified_at,expires_at) values (${sessionIdHash},${id}::uuid,transaction_timestamp(),transaction_timestamp()+interval '1 hour')`,
  );
  return { id, sessionIdHash };
}

describe("sandbox payment provider end to end", () => {
  it("uses approved transitions and the canonical settlement/refund pipelines without sandbox ledger writes", async () => {
    const controlApproval = await testDb!.createFeatureControlApproval({
      expectedVersion: 0,
      newCommandsEnabled: true,
      rewardGrantsEnabled: true,
    });
    await new PostgresExpertReferralControlRepository(
      testDb!.db,
    ).setFeatureControl({
      expectedVersion: 0,
      newCommandsEnabled: true,
      rewardGrantsEnabled: true,
      approvalId: controlApproval.approvalId,
      adminSessionIdHash: controlApproval.sessionIdHash,
    });
    const inviter = await testDb!.createExpertIdentity();
    const invitee = await testDb!.createExpertIdentity();
    const referrals = new PostgresExpertReferralRepository(testDb!.db, crypto);
    const issueApproval = await testDb!.createAdminAudit({
      action: "expert_referral.batch_generate",
      objectId: inviter.expertId,
    });
    const issued = await referrals.issueBatch({
      inviterExpertId: inviter.expertId,
      count: 1,
      issuedByAdminId: issueApproval.adminId,
      approvalId: issueApproval.approvalId,
      adminSessionIdHash: issueApproval.sessionIdHash,
    });
    await referrals.redeemCode({
      plaintext: issued.codes[0]!.plaintext,
      userId: invitee.userId,
      provider: invitee.provider,
      externalId: invitee.externalId,
    });

    const residency = new PostgresExpertResidencyRepository(testDb!.db);
    const tariffApproval = await testDb!.createAdminAudit({
      action: "expert_residency.tariff_create",
      objectId: randomUUID(),
    });
    const tariff = await residency.createTariffVersion({
      tariffKey: `sandbox-${randomUUID()}`,
      displayName: "Sandbox residency",
      priceMinor: 50_000n,
      durationSeconds: 86_400,
      activeFrom: new Date(Date.now() - 1000),
      activeTo: new Date(Date.now() + 86_400_000),
      approvalId: tariffApproval.approvalId,
      adminSessionIdHash: tariffApproval.sessionIdHash,
    });
    const qualifyingOrder = await residency.createCheckoutOrder({
      expertId: invitee.expertId,
      tariffVersionId: tariff.id,
      providerDeadline: new Date(Date.now() + 3_600_000),
      idempotencyKey: `order:${randomUUID()}`,
    });
    const payments = new PostgresSandboxPaymentRepository(
      testDb!.db,
      new URL("https://sandbox.ii-tonya.invalid"),
    );
    const qualifyingCheckout = await payments.createCheckout({
      orderId: qualifyingOrder.id,
      amountMinor: qualifyingOrder.cashMinor,
      currency: "RUB",
      idempotencyKey: `checkout:${randomUUID()}`,
    });
    const approvals = new PostgresAdminApprovalRepository(testDb!.db);
    const workflow = new SandboxTransitionWorkflow(
      testDb!.db,
      approvals as never,
      payments,
    );
    const requester = await admin();
    const approver = await admin();
    const adapter = new SandboxExpertResidencyPaymentAdapter(
      payments,
      createSandboxEventVerifier(
        createCanonicalExpertResidencyPaymentEventVerifier() as never,
      ),
    );
    const inbox = new PostgresExpertResidencyProviderInboxRepository(
      testDb!.db,
    );

    async function approveAndTransition(
      checkout: { paymentId: string },
      transition: "settled" | "refunded",
      expectedVersion: number,
    ) {
      const action =
        transition === "settled"
          ? ("expert_residency.sandbox_settle" as const)
          : ("expert_residency.sandbox_refund" as const);
      const idempotencyKey = `${transition}:${randomUUID()}`;
      const nonce = randomUUID();
      const requested = await approvals.requestApproval({
        sessionIdHash: requester.sessionIdHash,
        action,
        objectType: "sandbox_expert_residency_payment",
        objectId: sandboxApprovalObjectId(checkout.paymentId),
        payload: {
          paymentId: checkout.paymentId,
          transition,
          expectedVersion,
          idempotencyKey,
        },
        nonce,
      });
      expect(requested).not.toBeNull();
      await expect(
        approvals.approveApproval({
          approvalId: requested!.approvalId,
          sessionIdHash: approver.sessionIdHash,
        }),
      ).resolves.toBe(true);
      await expect(
        workflow.execute({
          action,
          paymentId: checkout.paymentId,
          approvalId: requested!.approvalId,
          nonce,
          sessionIdHash: requester.sessionIdHash,
          expectedVersion,
          idempotencyKey,
          correlationId: `e2e:${randomUUID()}`,
        }),
      ).resolves.toMatchObject({ allowed: true, event: { kind: transition } });
    }

    await approveAndTransition(qualifyingCheckout, "settled", 0);
    await expect(
      Promise.all([
        deliverSandboxPaymentEvent({
          paymentId: qualifyingCheckout.paymentId,
          adapter,
          inbox,
          acknowledge: (id) => payments.markEventProcessed(id),
        }),
        deliverSandboxPaymentEvent({
          paymentId: qualifyingCheckout.paymentId,
          adapter,
          inbox,
          acknowledge: (id) => payments.markEventProcessed(id),
        }),
      ]),
    ).resolves.toEqual(["settled", "settled"]);
    await expect(residency.balance(inviter.expertId)).resolves.toMatchObject({
      availableCreditMinor: "100000",
      reservedCreditMinor: "0",
    });

    const order = await residency.createCheckoutOrder({
      expertId: inviter.expertId,
      tariffVersionId: tariff.id,
      providerDeadline: new Date(Date.now() + 3_600_000),
      idempotencyKey: `capped-order:${randomUUID()}`,
    });
    expect(order).toMatchObject({
      priceMinor: "50000",
      creditMinor: "25000",
      cashMinor: "25000",
    });
    await expect(residency.balance(inviter.expertId)).resolves.toMatchObject({
      availableCreditMinor: "75000",
      reservedCreditMinor: "25000",
    });
    const checkout = await payments.createCheckout({
      orderId: order.id,
      amountMinor: order.cashMinor,
      currency: "RUB",
      idempotencyKey: `capped-checkout:${randomUUID()}`,
    });
    await approveAndTransition(checkout, "settled", 0);
    await expect(
      deliverSandboxPaymentEvent({
        paymentId: checkout.paymentId,
        adapter,
        inbox,
        acknowledge: (id) => payments.markEventProcessed(id),
      }),
    ).resolves.toBe("settled");
    await expect(residency.balance(inviter.expertId)).resolves.toMatchObject({
      availableCreditMinor: "75000",
      reservedCreditMinor: "0",
    });
    const settledFacts = await testDb!.db.execute<{
      status: string;
      attempts: number;
      firsts: number;
      grants: number;
    }>(
      sql`select (select status from expert_residency_orders where id=${order.id}::uuid) status,(select count(*)::int from expert_residency_payment_attempts where order_id=${order.id}::uuid) attempts,(select count(*)::int from expert_first_residency_settlements where qualifying_order_id=${qualifyingOrder.id}::uuid) firsts,(select count(*)::int from expert_referral_reward_grants where qualifying_order_id=${qualifyingOrder.id}::uuid) grants`,
    );
    expect(settledFacts.rows[0]).toEqual({
      status: "settled",
      attempts: 1,
      firsts: 1,
      grants: 1,
    });
    const interval = await testDb!.db.execute<{
      seconds: string;
    }>(
      sql`select extract(epoch from (residency_ends_at-residency_starts_at))::bigint::text seconds from expert_residency_orders where id=${order.id}::uuid`,
    );
    expect(interval.rows[0]?.seconds).toBe("86400");

    const emitted = await testDb!.db.execute<{
      audits: number;
      outbox: number;
    }>(
      sql`select (select count(*)::int from audit_events where object_id=${order.id}::uuid and action='expert_residency.settle') audits,(select count(*)::int from integration_outbox where reconciliation_key=${`expert-residency:${order.id}`}) outbox`,
    );
    expect(emitted.rows[0]).toEqual({ audits: 1, outbox: 1 });

    await approveAndTransition(checkout, "refunded", 1);
    await expect(
      Promise.all([
        deliverSandboxPaymentEvent({
          paymentId: checkout.paymentId,
          adapter,
          inbox,
          acknowledge: (id) => payments.markEventProcessed(id),
        }),
        deliverSandboxPaymentEvent({
          paymentId: checkout.paymentId,
          adapter,
          inbox,
          acknowledge: (id) => payments.markEventProcessed(id),
        }),
      ]),
    ).resolves.toEqual(["refunded", "refunded"]);
    await expect(residency.balance(inviter.expertId)).resolves.toMatchObject({
      availableCreditMinor: "75000",
      reservedCreditMinor: "0",
    });
    const finalFacts = await testDb!.db.execute<{
      status: string;
      debt: string;
      sandboxTables: number;
      reversals: number;
      sandboxLedgerSources: number;
    }>(
      sql`select (select status from expert_residency_orders where id=${order.id}::uuid) status,(select debt_minor::text from expert_referral_balances where expert_id=${inviter.expertId}::uuid) debt,(select count(*)::int from information_schema.tables where table_schema='public' and table_name like 'sandbox_expert_residency_%') "sandboxTables",(select count(*)::int from expert_residency_provider_event_inbox where payment_id=${checkout.paymentId} and event_kind='refunded' and status='processed') reversals,(select count(*)::int from expert_referral_ledger_entries where source_type like 'sandbox%') "sandboxLedgerSources"`,
    );
    expect(finalFacts.rows[0]).toMatchObject({
      status: "refunded",
      debt: "0",
      sandboxTables: 4,
      reversals: 1,
      sandboxLedgerSources: 0,
    });
  }, 120_000);
});
