import { applyEarlyBirdDraftIfNeeded } from "../testkit/early-bird-draft-helper.js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { expertResidencyPaymentEventSchema } from "@ii-tonya/contracts";
import { verifiedEventFixture } from "../../../integrations/src/expert-residency/verified-event.js";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../testkit/expert-referral.js";
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
it("reflows a future wave period after the preceding legacy payment is refunded", async () => {
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
    durationSeconds: 31536000,
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
  const intent = randomUUID();
  await fixture.db.execute(
    sql`create table early_bird_composite_intents(id uuid primary key, invoice_id uuid not null, user_id uuid not null, provider_mode text not null, pricing_policy text not null, price_kind text not null, onboarding_minor bigint not null, subscription_minor bigint not null, total_minor bigint not null, base_offer_shown_at timestamptz not null, expires_at timestamptz not null, launch_at timestamptz not null, status text not null, unique(id,user_id))`,
  );
  await fixture.db.execute(
    sql`create table early_bird_verified_bindings(intent_id uuid primary key, user_id uuid not null, provider_object_id text not null)`,
  );
  await applyEarlyBirdDraftIfNeeded(
    fixture.db,
    "docs/superpowers/implementation-artifacts/drafts/0082_early_bird_settlement.sql",
  );
  await fixture.db.execute(
    sql`insert into early_bird_composite_intents values(${intent}::uuid,${randomUUID()}::uuid,${expert.userId}::uuid,'live','owner_test_10_20_v1','fixed_test',1000,2000,3000,'2026-01-01Z','2026-01-11Z','2027-01-11T00:00:00+03:00','unknown')`,
  );
  await fixture.db.execute(
    sql`insert into early_bird_verified_bindings values(${intent}::uuid,${expert.userId}::uuid,'reverse-pay')`,
  );
  await new PostgresExpertResidencyProviderInboxRepository(fixture.db, {
    waveCoverage: true,
  }).settle(event as never);
  await fixture.db.execute(
    sql`select early_bird_record_success(${intent}::uuid,${expert.userId}::uuid,'reverse-pay',${`sha256:${"a".repeat(64)}`},'2026-01-02T00:00:00Z'::timestamptz)`,
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
  await new PostgresExpertResidencyProviderInboxRepository(fixture.db).reverse(
    refund as never,
  );
  const wave = await fixture.db.execute<{ starts: Date | string }>(
    sql`select starts_at as starts from early_bird_effective_coverages where intent_id=${intent}::uuid`,
  );
  expect(new Date(wave.rows[0]!.starts).toISOString()).toBe(
    "2027-01-10T21:00:00.000Z",
  );
}, 120_000);
