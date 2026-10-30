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
let fixture: ExpertReferralTestDatabase;
beforeAll(async () => {
  fixture = await startExpertReferralTestDatabase();
  await fixture.enableExpertReferralCommands();
}, 120_000);
afterAll(async () => {
  await fixture?.stop();
}, 120_000);
it("rejects a forged wave publication without an admission", async () => {
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
  void event;
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
  await fixture.db.execute(
    sql`select early_bird_record_success(${intent}::uuid,${expert.userId}::uuid,'reverse-pay',${`sha256:${"a".repeat(64)}`},'2026-01-02T00:00:00Z'::timestamptz)`,
  );
  await fixture.db.execute(
    sql`alter table early_bird_composite_intents add column choice_id uuid`,
  );
  await applyEarlyBirdDraftIfNeeded(
    fixture.db,
    "docs/superpowers/implementation-artifacts/drafts/wave_admission_projection.sql",
  );
  let rejection: unknown;
  try {
    await fixture.db.execute(
      sql`insert into experts_published(expert_id,user_id,application_audit_id,draft_id,review_id,revision,public_payload,public_digest,paid_order_id,wave_intent_id,next_billing_date,active) values(${expert.expertId}::uuid,${expert.userId}::uuid,${randomUUID()}::uuid,${randomUUID()}::uuid,${randomUUID()}::uuid,1,'{}'::jsonb,${`sha256:${"c".repeat(64)}`},null,${intent}::uuid,clock_timestamp()+interval '1 day',true)`,
    );
  } catch (error) {
    rejection = (error as { cause?: { message?: string } }).cause?.message;
  }
  expect(rejection).toContain("expert_published_wave_source");
}, 120_000);
