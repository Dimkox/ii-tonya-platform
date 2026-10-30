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
it("chains a legacy payment after already prepaid wave coverage", async () => {
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
  await fixture.db.execute(
    sql`create table early_bird_coverage_epochs (user_id uuid primary key, revision bigint not null)`,
  );
  await fixture.db.execute(
    sql`create function early_bird_touch_coverage_epoch(target_user uuid) returns void language sql as $$ insert into early_bird_coverage_epochs(user_id,revision) values(target_user,1) on conflict(user_id) do update set revision=early_bird_coverage_epochs.revision+1 $$`,
  );
  await fixture.db.execute(
    sql`create table early_bird_payment_successes (user_id uuid not null, disposition text not null, ends_at timestamptz)`,
  );
  await fixture.db.execute(
    sql`create function early_bird_active_coverage_end(target_user uuid) returns timestamptz language sql as $$ select max(ends_at) from early_bird_payment_successes where user_id=target_user and disposition='eligible' $$`,
  );
  await fixture.db.execute(
    sql`insert into early_bird_payment_successes values(${expert.userId}::uuid,'eligible','2027-02-09T21:00:00Z')`,
  );
  const result = await new PostgresExpertResidencyProviderInboxRepository(
    fixture.db,
    { waveCoverage: true },
  ).settle(event as never);
  expect(result.residencyStartsAt).toBe("2027-02-09T21:00:00.000Z");
}, 120_000);
