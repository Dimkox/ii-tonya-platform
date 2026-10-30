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
it("retries legacy settlement after an overlapping wave payment commits", async () => {
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
  // Legacy establishes its SERIALIZABLE snapshot before awaiting the subject
  // lock. The wave writer commits an epoch and paid interval while it waits.
  let release!: () => void, held!: () => void;
  const ready = new Promise<void>((resolve) => {
    held = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const wave = fixture.db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${expert.userId}::uuid::text,0))`,
    );
    held();
    await gate;
    await tx.execute(
      sql`insert into early_bird_payment_successes values(${expert.userId}::uuid,'eligible','2027-02-09T21:00:00Z')`,
    );
    await tx.execute(
      sql`select early_bird_touch_coverage_epoch(${expert.userId}::uuid)`,
    );
  });
  await ready;
  const pending = new PostgresExpertResidencyProviderInboxRepository(
    fixture.db,
    { waveCoverage: true },
  ).settle(event as never);
  const outcome = pending.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  let waited = false;
  try {
    for (let n = 0; n < 20; n++) {
      const seen = await fixture.db.execute<{ waiting: boolean }>(
        sql`select exists(select 1 from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and wait_event_type='Lock' and wait_event='advisory') as waiting`,
      );
      if (seen.rows[0]?.waiting) {
        waited = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  } finally {
    release();
    await wave;
  }
  const result = await outcome;
  expect(waited).toBe(true);
  expect(result).toHaveProperty(
    "value.residencyStartsAt",
    "2027-02-09T21:00:00.000Z",
  );
}, 120_000);
