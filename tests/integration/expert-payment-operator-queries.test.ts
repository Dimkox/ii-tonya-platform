import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { PostgresAdminRepository } from "../../packages/db/src/repositories/admin-repository.js";
import { PostgresAdminApprovalRepository } from "../../packages/db/src/repositories/admin-approval-repository.js";
import { PostgresExpertResidencyRepository } from "../../packages/db/src/repositories/expert-residency-repository.js";
import { PostgresExpertResidencyProviderInboxRepository } from "../../packages/db/src/repositories/expert-residency-provider-inbox-repository.js";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../../packages/db/src/testkit/expert-referral.js";
import { verifiedEventFixture } from "../../packages/integrations/src/expert-residency/verified-event.js";

let database: ExpertReferralTestDatabase;
// The missing port is deliberately asserted at runtime in RED, not a collection failure.
interface Reads {
  listLatePayments(input: {
    sessionIdHash: string;
    limit: number;
    status?: string;
    beforeCreatedAt?: string;
    beforeId?: string;
  }): Promise<{ allowed: boolean; items?: Record<string, unknown>[] }>;
  getLatePayment(input: {
    sessionIdHash: string;
    errorId: string;
  }): Promise<{ allowed: boolean; item?: Record<string, unknown> | null }>;
}
const reads = () =>
  new PostgresAdminRepository(database.db) as unknown as Reads;
beforeAll(async () => {
  database = await startExpertReferralTestDatabase();
  expect(
    (await database.db.execute(sql`show server_version_num`)).rows[0],
  ).toEqual({ server_version_num: "170005" });
}, 120000);
beforeEach(async () => {
  await database.reset();
  await database.enableExpertReferralCommands();
});
afterAll(async () => {
  await database?.stop();
});
async function session(role = "support") {
  const id = randomUUID(),
    sessionIdHash = `session:${randomUUID()}`;
  await database.db.execute(sql`insert into users(id) values(${id}::uuid)`);
  await database.db.execute(
    sql`insert into admin_sessions(session_id_hash,admin_id,mfa_verified_at,expires_at) values(${sessionIdHash},${id}::uuid,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour')`,
  );
  await database.db.execute(
    sql`insert into admin_role_assignments(admin_id,role) values(${id}::uuid,${role})`,
  );
  return sessionIdHash;
}
async function late(workerFirst = false) {
  const expert = await database.createExpertIdentity();
  const tariffVersionId = await database.createResidencyTariff({
    tariffKey: randomUUID(),
    displayName: "Synthetic",
    priceMinor: 50000,
    durationSeconds: 86400,
    commercialPolicyVersion: "legacy_residency_v1",
  });
  const orders = new PostgresExpertResidencyRepository(database.db);
  const order = await orders.createCheckoutOrder({
    expertId: expert.expertId,
    tariffVersionId,
    providerDeadline: new Date(Date.now() + 3600000),
    idempotencyKey: randomUUID(),
  });
  await database.db.execute(
    sql`update expert_residency_orders set payment_deadline=clock_timestamp() where id=${order.id}::uuid`,
  );
  if (workerFirst) await orders.releaseExpiredOrders(20);
  const event = verifiedEventFixture(
    {
      kind: "settled",
      provider: "operator-fixture",
      eventId: `evt_${order.id}`,
      paymentId: `pay_${order.id}`,
      orderId: order.id,
      amountMinor: order.cashMinor,
      currency: "RUB",
      occurredAt: "2026-08-03T00:00:00.000Z",
      payloadDigest: `sha256:${createHash("sha256").update(order.id).digest("hex")}`,
    },
    {
      verificationId: `verify_${order.id}`,
      verifierKeyVersion: "fixture-v1",
      verifiedAt: "2026-08-03T00:00:01.000Z",
    },
  );
  const provider = new PostgresExpertResidencyProviderInboxRepository(
    database.db,
  );
  await expect(provider.settle(event)).rejects.toMatchObject({
    code: "EXPERT_RESIDENCY_PAYMENT_EXPIRED",
  });
  return { order, event, provider };
}
it.each([false, true])(
  "durably exposes paid-after-expiry (worker first=%s), binds safe detail and never reopens on replay",
  async (workerFirst) => {
    const auth = await session();
    const { order, event, provider } = await late(workerFirst);
    const errors = (
      await database.db.execute(sql`select * from integration_errors`)
    ).rows;
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      provider: "expert_residency",
      reason_code: "expert_residency_paid_after_deadline",
      status: "open",
    });
    expect(String(errors[0]!.metadata_hash)).toMatch(/^sha256:[a-f0-9]{64}$/u);
    const page = await reads().listLatePayments({
      sessionIdHash: auth,
      limit: 10,
    });
    expect(page.allowed).toBe(true);
    expect(page.items).toHaveLength(1);
    expect(Object.keys(page.items![0]!).sort()).toEqual([
      "createdAt",
      "id",
      "reasonCode",
      "resolvedAt",
      "status",
      "updatedAt",
    ]);
    const detail = await reads().getLatePayment({
      sessionIdHash: auth,
      errorId: String(errors[0]!.id),
    });
    expect(detail).toMatchObject({
      allowed: true,
      item: {
        orderId: order.id,
        amountMinor: 50000,
        currency: "RUB",
        paymentId: event.paymentId,
        provider: event.provider,
      },
    });
    expect(JSON.stringify(detail)).not.toMatch(
      /payload|verification|session|metadataHash|external_event/u,
    );
    // Exercise the existing dual-support approval workflow, not a fake refund.
    const approvals = new PostgresAdminApprovalRepository(database.db),
      errorId = String(errors[0]!.id),
      nonce = `nonce:${randomUUID()}`;
    const request = await approvals.requestApproval({
      sessionIdHash: auth,
      action: "integration_error.resolve",
      objectType: "integration_error",
      objectId: errorId,
      payload: { errorId },
      nonce,
    });
    expect(request).not.toBeNull();
    expect(
      await approvals.approveApproval({
        sessionIdHash: await session(),
        approvalId: request!.approvalId,
      }),
    ).toBe(true);
    expect(
      await new PostgresAdminRepository(database.db).resolveIntegrationError({
        sessionIdHash: auth,
        approvalId: request!.approvalId,
        nonce,
        correlationId: `corr:${randomUUID()}`,
        errorId,
      }),
    ).toMatchObject({ allowed: true, errorId });
    await expect(provider.settle(event)).rejects.toMatchObject({
      code: "EXPERT_RESIDENCY_PAYMENT_EXPIRED",
    });
    expect(
      (
        await database.db.execute(
          sql`select count(*)::int n from integration_errors`,
        )
      ).rows[0],
    ).toEqual({ n: 1 });
    expect(
      (await reads().listLatePayments({ sessionIdHash: auth, limit: 10 }))
        .items,
    ).toEqual([]);
    expect(
      (
        await reads().listLatePayments({
          sessionIdHash: auth,
          limit: 10,
          status: "resolved",
        })
      ).items,
    ).toHaveLength(1);
    expect(
      (
        await database.db.execute(
          sql`select count(*)::int n from expert_residency_payment_attempts`,
        )
      ).rows[0],
    ).toEqual({ n: 0 });
  },
);
it.each(["missing", "role", "revoked", "expired", "stale", "future"])(
  "fresh DB authorization denies %s for list and detail",
  async (kind) => {
    const auth =
      kind === "missing"
        ? "missing"
        : await session(kind === "role" ? "catalog_admin" : "support");
    if (kind === "revoked")
      await database.db.execute(
        sql`update admin_sessions set revoked_at=clock_timestamp()`,
      );
    if (kind === "expired")
      await database.db.execute(
        sql`update admin_sessions set expires_at=clock_timestamp()-interval '1 second'`,
      );
    if (kind === "stale")
      await database.db.execute(
        sql`update admin_sessions set mfa_verified_at=clock_timestamp()-interval '16 minutes'`,
      );
    if (kind === "future")
      await database.db.execute(
        sql`update admin_sessions set mfa_verified_at=clock_timestamp()+interval '1 minute'`,
      );
    expect(
      await reads().listLatePayments({ sessionIdHash: auth, limit: 10 }),
    ).toEqual({ allowed: false, reasonCode: "forbidden" });
    expect(
      await reads().getLatePayment({
        sessionIdHash: auth,
        errorId: randomUUID(),
      }),
    ).toEqual({ allowed: false, reasonCode: "forbidden" });
  },
);
it("paginates exact microsecond keys, filters unrelated errors, and rejects malformed controls", async () => {
  const auth = await session();
  await database.db.execute(
    sql`insert into integration_errors(provider,reason_code,metadata_hash,created_at) select 'expert_residency','expert_residency_paid_after_deadline','synthetic', '2026-10-12T00:00:00Z'::timestamptz + n*interval '1 microsecond' from generate_series(1,3) n`,
  );
  await database.db.execute(
    sql`insert into integration_errors(provider,reason_code,metadata_hash) values('other','expert_residency_paid_after_deadline','synthetic'),('expert_residency','other','synthetic')`,
  );
  const first = await reads().listLatePayments({
    sessionIdHash: auth,
    limit: 2,
  });
  expect(first.items).toHaveLength(2);
  const last = first.items![1]!;
  const second = await reads().listLatePayments({
    sessionIdHash: auth,
    limit: 2,
    beforeCreatedAt: String(last.createdAt),
    beforeId: String(last.id),
  });
  expect(second.items).toHaveLength(1);
  expect(
    new Set([...first.items!, ...second.items!].map((x) => x.id)).size,
  ).toBe(3);
  for (const input of [
    { limit: 0 },
    { limit: 101 },
    { limit: 1.2 },
    { limit: 10, status: "all" },
    { limit: 10, beforeId: randomUUID() },
    { limit: 10, beforeCreatedAt: "garbage", beforeId: randomUUID() },
  ])
    await expect(
      reads().listLatePayments({ sessionIdHash: auth, ...input }),
    ).rejects.toThrow("invalid_request");
  expect(
    await reads().getLatePayment({
      sessionIdHash: auth,
      errorId: String(last.id),
    }),
  ).toEqual({ allowed: true, item: null });
});
it("does not bind an altered error hash to payment evidence", async () => {
  const auth = await session();
  await late();
  const result = await database.db.execute(
    sql`update integration_errors set metadata_hash='sha256:'||repeat('0',64) returning id`,
  );
  expect(result.rows).toHaveLength(1);
  expect(
    await reads().getLatePayment({
      sessionIdHash: auth,
      errorId: String(result.rows[0]!.id),
    }),
  ).toEqual({ allowed: true, item: null });
});
