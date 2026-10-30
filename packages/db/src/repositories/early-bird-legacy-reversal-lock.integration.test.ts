import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { expertResidencyPaymentEventSchema } from "@ii-tonya/contracts";
import { verifiedEventFixture } from "../../../integrations/src/expert-residency/verified-event.js";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../testkit/expert-referral.js";
import { lockClientConsentSubject } from "./client-consent-authority.js";
import { PostgresExpertResidencyRepository } from "./expert-residency-repository.js";
import { PostgresExpertResidencyProviderInboxRepository } from "./expert-residency-provider-inbox-repository.js";
let fixture: ExpertReferralTestDatabase;
beforeAll(async () => {
  fixture = await startExpertReferralTestDatabase();
  await fixture.enableExpertReferralCommands();
}, 120_000);
afterAll(async () => {
  await fixture?.stop();
}, 120_000);
it("serializes legacy reversal with the owner's consent lock", async () => {
  const expert = await fixture.createExpertIdentity();
  const repository = new PostgresExpertResidencyRepository(fixture.db);
  const audit = await fixture.createAdminAudit({
    action: "expert_residency.tariff_create",
    objectId: randomUUID(),
  });
  const tariff = await repository.createTariffVersion({
    tariffKey: `test-${randomUUID()}`,
    displayName: "Test",
    priceMinor: 50000n,
    durationSeconds: 86400,
    activeFrom: new Date(Date.now() - 1000),
    activeTo: new Date(Date.now() + 86400000),
    approvalId: audit.approvalId,
    adminSessionIdHash: audit.sessionIdHash,
  });
  const order = await repository.createCheckoutOrder({
    expertId: expert.expertId,
    tariffVersionId: tariff.id,
    providerDeadline: new Date(Date.now() + 3600000),
    idempotencyKey: randomUUID(),
  });
  const event = verifiedEventFixture(
    expertResidencyPaymentEventSchema.parse({
      kind: "settled",
      provider: "sandbox",
      eventId: `evt_${randomUUID()}`,
      paymentId: `pay_${randomUUID()}`,
      orderId: order.id,
      amountMinor: "50000",
      currency: "RUB",
      occurredAt: new Date().toISOString(),
      payloadDigest: `sha256:${"a".repeat(64)}`,
    }),
    {
      verificationId: `verify_${randomUUID()}`,
      verifierKeyVersion: "test-v1",
      verifiedAt: new Date().toISOString(),
    },
  );
  await new PostgresExpertResidencyProviderInboxRepository(fixture.db).settle(
    event as never,
  );
  const refund = verifiedEventFixture(
    expertResidencyPaymentEventSchema.parse({
      kind: "refunded",
      provider: "sandbox",
      eventId: `refund_${randomUUID()}`,
      paymentId: event.paymentId,
      orderId: order.id,
      amountMinor: "50000",
      currency: "RUB",
      occurredAt: new Date().toISOString(),
      payloadDigest: `sha256:${"b".repeat(64)}`,
    }),
    {
      verificationId: `verify_${randomUUID()}`,
      verifierKeyVersion: "test-v1",
      verifiedAt: new Date().toISOString(),
    },
  );
  let release!: () => void, held!: () => void;
  const ready = new Promise<void>((resolve) => {
    held = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const holding = fixture.db.transaction(async (tx) => {
    await lockClientConsentSubject(tx, expert.userId);
    held();
    await gate;
  });
  await ready;
  const settlement = new PostgresExpertResidencyProviderInboxRepository(
    fixture.db,
  ).reverse(refund as never);
  // Install a rejection handler immediately, and observe a real advisory lock
  // wait instead of accepting an arbitrary scheduling delay as proof.
  const outcome = settlement.then(
    () => ({ kind: "settled" as const }),
    (error: unknown) => ({ kind: "failed" as const, error }),
  );
  let observedWait = false;
  try {
    for (let attempt = 0; attempt < 20; attempt++) {
      const rows = await fixture.db.execute<{ waiting: boolean }>(sql`
        select exists(select 1 from pg_stat_activity
          where datname=current_database() and pid<>pg_backend_pid()
            and wait_event_type='Lock' and wait_event='advisory') as waiting
      `);
      if (rows.rows[0]?.waiting) {
        observedWait = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  } finally {
    release();
    await holding;
  }
  const result = await outcome;
  expect(observedWait).toBe(true);
  expect(result).toEqual({ kind: "settled" });
}, 120_000);
