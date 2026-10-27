import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../../packages/db/src/testkit/expert-referral.js";
import { PostgresExpertOnboardingMainPaymentRepository } from "../../packages/db/src/repositories/expert-onboarding-main-payment-repository.js";
import { PostgresExpertCampaignQuoteRepository } from "../../packages/db/src/repositories/expert-campaign-quote-repository.js";
import { PostgresYooKassaOperationRepository } from "../../packages/db/src/repositories/yookassa-operation-repository.js";
import { PostgresExpertResidencyProviderInboxRepository } from "../../packages/db/src/repositories/expert-residency-provider-inbox-repository.js";
import { restoreSettledMainCardProjection } from "../../packages/db/src/repositories/expert-residency-main-projection.js";
import {
  createYooKassaClient,
  YooKassaPaymentVerifier,
} from "@ii-tonya/integrations";
import {
  createCorrectionOnboardingFixture,
  correctionEvent,
} from "../support/residency-correction-fixture.js";
let database: ExpertReferralTestDatabase;
const policy = {
  providerMode: "test" as const,
  messagingConsentPolicyVersion: "client-messaging-v1",
};
type Actor = Awaited<ReturnType<typeof ready>>;
let admitted: Actor, stale: Actor;
async function ready() {
  const f = await createCorrectionOnboardingFixture(database);
  await f.cards.submitPromoProof({
    ...correctionEvent(f.scope),
    expectedRevision: 0,
    proof: { kind: "link", reference: "https://example.com/promo" },
  });
  await f.cards.confirmPromo({
    sessionHash: f.sessionHash,
    applicationId: f.applicationId,
    expectedRevision: 0,
    idempotencyKey: randomUUID(),
  });
  const revision = (await f.approveCard()).revision;
  const financial = new PostgresExpertOnboardingMainPaymentRepository(
    database.db,
    policy,
  );
  const q = await financial.quoteMain({
    ...correctionEvent(f.workScope),
    tariffVersionId: f.tariffId,
    termMonths: 1,
    revision,
  });
  await financial.acceptMain({
    ...correctionEvent(f.workScope),
    quoteId: q.id,
    revision,
  });
  const order = await financial.createMainInvoice({
    ...correctionEvent(f.workScope),
    revision,
  });
  const expertId = (
    await database.db.execute<{ id: string }>(
      sql`select id from experts where user_id=${f.userId}::uuid`,
    )
  ).rows[0]!.id;
  await database.db.execute(
    sql`insert into expert_residency_lifecycle(user_id,expert_id,status) values(${f.userId}::uuid,${expertId}::uuid,'payment_required') on conflict do nothing`,
  );
  return { f, order, expertId };
}
async function changeProfile(a: Actor, verify = true) {
  const quotes = new PostgresExpertCampaignQuoteRepository(database.db);
  await quotes.saveProfile({
    userId: a.f.userId,
    cityCode: "new-city",
    millionCity: true,
    serviceFormat: "offline",
    ticketMinor: "300000",
    participantKind: "expert",
    idempotencyKey: randomUUID(),
  });
  if (verify)
    await quotes.verifyProfile({
      sessionHash: a.f.sessionHash,
      userId: a.f.userId,
      revision: 2,
    });
}
async function pay(a: Actor) {
  const operations = new PostgresYooKassaOperationRepository(database.db);
  const claimed = await operations.claim({
    commandId: randomUUID(),
    orderId: a.order.orderId,
    kind: "create_payment",
    mode: "test",
    amountMinor: a.order.cashMinor,
    currency: "RUB",
    requestDigest:
      "sha256:" + createHash("sha256").update(a.order.orderId).digest("hex"),
  });
  const paymentId = `synthetic_${randomUUID()}`;
  const operation = await operations.bindProviderObject(claimed.id, paymentId);
  const amount = BigInt(a.order.cashMinor);
  const client = createYooKassaClient(
    { mode: "test", shopId: "test-shop", secretKey: "synthetic-only" },
    async () =>
      new Response(
        JSON.stringify({
          id: paymentId,
          status: "succeeded",
          paid: true,
          test: true,
          amount: {
            value: `${amount / 100n}.${String(amount % 100n).padStart(2, "0")}`,
            currency: "RUB",
          },
          created_at: new Date(Date.now() - 1000).toISOString(),
          captured_at: new Date().toISOString(),
          metadata: { order_id: a.order.orderId },
          refundable: true,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  );
  const proof = await new YooKassaPaymentVerifier(
    client,
    operations,
  ).verifyPayment(operation);
  if (!proof) throw new Error("fixture_payment_proof_missing");
  const core = new PostgresExpertResidencyProviderInboxRepository(database.db);
  const settled = await core.settle(proof);
  expect(await core.settle(proof)).toMatchObject({
    kind: "settled",
    orderId: a.order.orderId,
    paymentId,
    residencyStartsAt: settled.residencyStartsAt,
    residencyEndsAt: settled.residencyEndsAt,
  });
}
beforeAll(async () => {
  database = await startExpertReferralTestDatabase();
  await database.enableExpertReferralCommands();
}, 120000);
afterAll(async () => {
  await database?.stop();
}, 120000);
describe("activation admission versus money", () => {
  beforeAll(async () => {
    admitted = await ready();
    stale = await ready();
  }, 120000);
  it("an admitted paid period survives later verified qualification changes", async () => {
    await pay(admitted);
    expect(
      (
        await database.db.execute(
          sql`select order_id from expert_main_activation_admissions where order_id=${admitted.order.orderId}::uuid`,
        )
      ).rows,
    ).toHaveLength(1);
    await changeProfile(admitted, false);
    expect(
      await database.db.transaction((tx) =>
        restoreSettledMainCardProjection(tx, {
          userId: admitted.f.userId,
          expertId: admitted.expertId,
        }),
      ),
    ).toBe(true);
    expect(
      (
        await database.db.execute(
          sql`select active from experts_published where expert_id=${admitted.expertId}::uuid`,
        )
      ).rows[0],
    ).toEqual({ active: true });
  });
  it("money paid against stale facts is recorded without minting recoverable activation admission", async () => {
    await changeProfile(stale);
    await pay(stale);
    expect(
      (
        await database.db.execute(
          sql`select status from expert_residency_orders where id=${stale.order.orderId}::uuid`,
        )
      ).rows[0],
    ).toEqual({ status: "settled" });
    expect(
      (
        await database.db.execute(
          sql`select * from expert_residency_current_coverage(${stale.expertId}::uuid)`,
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await database.db.execute(
          sql`select order_id from expert_main_activation_admissions where order_id=${stale.order.orderId}::uuid`,
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      await database.db.transaction((tx) =>
        restoreSettledMainCardProjection(tx, {
          userId: stale.f.userId,
          expertId: stale.expertId,
        }),
      ),
    ).toBe(false);
    expect(
      (
        await database.db.execute(
          sql`select expert_id from experts_published where expert_id=${stale.expertId}::uuid and active`,
        )
      ).rows,
    ).toHaveLength(0);
    await expect(
      database.db.execute(
        sql`insert into expert_main_activation_admissions(order_id,user_id,expert_id,quote_id,profile_revision,application_audit_id,review_audit_id,public_digest,provider_event_id) select m.order_id,m.user_id,m.expert_id,m.quote_id,q.profile_revision,m.application_audit_id,m.review_audit_id,m.public_digest,p.id from expert_card_main_orders m join expert_campaign_quotes q on q.id=m.quote_id join expert_residency_provider_event_inbox p on p.order_id=m.order_id where m.order_id=${stale.order.orderId}::uuid`,
      ),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
  });
});
describe("legacy canonical provenance", () => {
  let legacy: Actor;
  beforeAll(async () => {
    legacy = await ready();
  }, 120000);
  it("legacy v1 canonical main-payment provenance remains eligible without a current publication row", async () => {
    const actor = legacy;
    const originalPendingV2OrderId = actor.order.orderId;
    const quotes = new PostgresExpertCampaignQuoteRepository(database.db);
    const q = await quotes.createQuote({
      userId: actor.f.userId,
      tariffVersionId: actor.f.tariffId,
      termMonths: 1,
      idempotencyKey: randomUUID(),
    });
    const financial = new PostgresExpertOnboardingMainPaymentRepository(
      database.db,
      policy,
    );
    const state = await actor.f.cards.getWorkflow(actor.f.workScope);
    if (!state) throw new Error("fixture_card_missing");
    await financial.acceptMain({
      ...correctionEvent(actor.f.workScope),
      quoteId: q.id,
      revision: state.revision,
    });
    actor.order = await financial.createMainInvoice({
      ...correctionEvent(actor.f.workScope),
      revision: state.revision,
    });
    await pay(actor);
    expect(
      (
        await database.db.execute(
          sql`select profile_revision from expert_main_activation_admissions where order_id=${actor.order.orderId}::uuid`,
        )
      ).rows,
    ).toEqual([{ profile_revision: null }]);
    await database.db.execute(
      sql`delete from experts_published where expert_id=${actor.expertId}::uuid`,
    );
    const migration = readFileSync(
      "packages/db/migrations/0056_residency_offer_corrections.sql",
      "utf8",
    );
    const chunk = migration
      .split("--> statement-breakpoint")
      .find(
        (part) =>
          part.includes("INSERT INTO expert_main_activation_admissions") &&
          part.includes("SELECT"),
      );
    if (!chunk) throw new Error("fixture_backfill_predicate_missing");
    const conflict = chunk.lastIndexOf("ON CONFLICT");
    const selection = chunk.slice(
      chunk.indexOf("SELECT"),
      conflict < 0 ? undefined : conflict,
    );
    const eligible = (
      await database.db.execute(
        sql.raw(
          `with candidates(order_id,user_id,expert_id,quote_id,profile_revision,application_audit_id,review_audit_id,public_digest,provider_event_id,admitted_at) as (${selection.replace(/;\s*$/u, "")}) select order_id from candidates`,
        ),
      )
    ).rows;
    expect(eligible.some((row) => row.order_id === actor.order.orderId)).toBe(
      true,
    );
    expect(
      eligible.some((row) => row.order_id === originalPendingV2OrderId),
    ).toBe(false);
    expect(
      await database.db.transaction((tx) =>
        restoreSettledMainCardProjection(tx, {
          userId: actor.f.userId,
          expertId: actor.expertId,
        }),
      ),
    ).toBe(true);
  });
});
