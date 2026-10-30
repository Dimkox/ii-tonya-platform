import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { sql } from "drizzle-orm";
import { beforeAll, afterAll, it, expect } from "vitest";
import { YooKassaEarlyBirdCandidateVerifier } from "@ii-tonya/integrations";
import { createEarlyBirdOwnerJourney } from "../testkit/early-bird-owner-journey.js";
import {
  publicFinancialCall,
  publicFinancialOwner,
  publicFinancialPrepared,
  publicFinancialTerminal,
  approvePublicWaveFinancialCard,
} from "../testkit/public-expert-payment-financial.js";
import { correctionEvent } from "../../../../tests/support/residency-correction-fixture.js";
import { verifiedEventFixture } from "../../../integrations/src/expert-residency/verified-event.js";
import { PostgresExpertResidencyProviderInboxRepository } from "./expert-residency-provider-inbox-repository.js";
import { PostgresYooKassaOperationRepository } from "./yookassa-operation-repository.js";

let wave: Awaited<ReturnType<typeof createEarlyBirdOwnerJourney>>;
let card: Awaited<ReturnType<typeof approvePublicWaveFinancialCard>>;
let pending: Awaited<ReturnType<typeof publicFinancialPrepared>>;
let legacy: Awaited<ReturnType<typeof publicFinancialOwner>>;
let legacyOrder: { orderId: string };
let legacyReview: string, expert: string;
type Principal = { pool: Pool; name: string };
let native: Principal,
  schemaOnly: Principal,
  authorized: Principal,
  minimal: Principal;
const pools: Pool[] = [];
const q = (text: string, args: unknown[] = []) =>
  wave.db.db.$client.query(text, args);
const call = (name: string, args: unknown[]) =>
  publicFinancialCall(wave.db, name, args);
// Original native reader permissions, plus the named legacy dependencies needed
// to exercise a real approved legacy card and price insertion directly.
const nativeTables =
  "experts,users,experts_published,resident_card_versions,expert_card_drafts,expert_onboarding_applications,expert_residency_lifecycle,expert_referral_abuse_holds,consent_states,consents,consent_document_versions,consent_presentations,channel_identities,resident_safety_active,resident_safety_policies,resident_safety_publications,forbidden_patterns,expert_card_consent_epoch,expert_card_reviews,expert_card_main_orders,expert_main_activation_admissions,expert_onboarding_invoices,expert_onboarding_payment_facts,expert_card_material_jobs,expert_card_material_templates,expert_application_material_jobs,expert_application_promo_confirmations,expert_application_promo_proofs,expert_residency_orders";
async function principal(label: string, onlyLegacy = false) {
  const name = `dispatch_${label}_${randomUUID().replaceAll("-", "")}`;
  await q(
    `create role ${name} login password 'synthetic-dispatch-only' noinherit nosuperuser nocreatedb nocreaterole nobypassrls`,
  );
  if (onlyLegacy) {
    await q(
      `grant select on expert_residency_orders,resident_card_versions,expert_card_reviews,expert_sales_bases,resident_verification_cohorts,expert_campaign_anchors to ${name}`,
    );
  } else {
    await q(`grant select on ${nativeTables} to ${name}`);
    await q(
      `grant update on expert_card_consent_epoch,resident_safety_active to ${name}`,
    );
    await q(
      `grant select on expert_card_entries,expert_card_promo_proofs,expert_card_promo_confirmations,expert_card_draft_tags,hashtags_db,resident_card_corrections,expert_sales_bases,resident_verification_cohorts,expert_offer_profiles,expert_offer_profile_verifications,expert_campaign_anchors to ${name}`,
    );
    // The unchanged legacy safety function takes FOR SHARE on catalogue rows.
    await q(`grant update(id) on hashtags_db to ${name}`);
  }
  await q(`grant insert on expert_campaign_anchors to ${name}`);
  const url = new URL(wave.db.db.$client.options.connectionString!);
  url.username = name;
  url.password = "synthetic-dispatch-only";
  const pool = new Pool({ connectionString: url.toString() });
  pools.push(pool);
  expect(
    (
      await pool.query(
        "select current_user=session_user same,rolsuper,rolinherit from pg_roles where rolname=current_user",
      )
    ).rows[0],
  ).toEqual({ same: true, rolsuper: false, rolinherit: false });
  return { pool, name };
}
async function anchor(p: Principal, user: string) {
  return p.pool.query(
    "insert into expert_campaign_anchors(user_id,rule_version,calculation_timestamp) values($1,'expert_energy_start_v2',clock_timestamp()) on conflict(user_id,rule_version) do nothing",
    [user],
  );
}
beforeAll(async () => {
  wave = await createEarlyBirdOwnerJourney();
  expect((await q("show server_version_num")).rows[0]!.server_version_num).toBe(
    "170005",
  );
  await wave.db.enableExpertReferralCommands();
  // Real legacy fee/card and canonical settlement supply active legacy coverage.
  legacy = await publicFinancialOwner(wave.db);
  const quote = await legacy.financial.quoteMain({
    ...correctionEvent(legacy.workScope),
    tariffVersionId: legacy.tariffId,
    termMonths: 3,
    revision: legacy.revision,
  });
  await legacy.financial.acceptMain({
    ...correctionEvent(legacy.workScope),
    quoteId: quote.id,
    revision: legacy.revision,
  });
  legacyOrder = await legacy.financial.createMainInvoice({
    ...correctionEvent(legacy.workScope),
    revision: legacy.revision,
  });
  const occurredAt = new Date().toISOString();
  const paymentId = `legacy_${randomUUID()}`;
  const operations = new PostgresYooKassaOperationRepository(wave.db.db);
  const operation = await operations.claim({
    commandId: randomUUID(),
    orderId: legacyOrder.orderId,
    kind: "create_payment",
    mode: "test",
    amountMinor: quote.priceMinor,
    currency: "RUB",
    requestDigest: `sha256:${"d".repeat(64)}`,
  });
  await operations.bindProviderObject(operation.id, paymentId);
  await new PostgresExpertResidencyProviderInboxRepository(wave.db.db).settle(
    verifiedEventFixture(
      {
        kind: "settled",
        provider: "yookassa",
        eventId: `dispatch_${randomUUID()}`,
        paymentId,
        orderId: legacyOrder.orderId,
        amountMinor: quote.priceMinor,
        currency: "RUB",
        occurredAt,
        payloadDigest: `sha256:${"d".repeat(64)}`,
      },
      {
        verificationId: `verified_${randomUUID()}`,
        verifierKeyVersion: "synthetic-dispatch",
        verifiedAt: occurredAt,
      },
    ),
  );
  legacyReview = (
    await q(
      "select approved_review_id from expert_card_drafts where user_id=$1",
      [legacy.userId],
    )
  ).rows[0]!.approved_review_id;
  // Real combined payment evidence, current manager-reviewed wave card and a
  // pending public order. No paid locks/admissions/coverages are fabricated.
  await q(
    "update early_bird_composite_intents set status='unknown' where id=$1",
    [wave.identity.operationId],
  );
  const candidate = await call("find_candidate_intent", [
      wave.identity.operationId,
    ]),
    provider = `dispatch_wave_${randomUUID()}`;
  const verifier = new YooKassaEarlyBirdCandidateVerifier(
    {
      getPayment: async () => ({
        id: provider,
        status: "succeeded",
        paid: true,
        test: false,
        refundable: true,
        amount: { value: "30.00", currency: "RUB" },
        createdAt: new Date().toISOString(),
        capturedAt: new Date().toISOString(),
        metadata: {
          order_id: candidate.invoiceId,
          user_id: wave.user,
          operation_id: candidate.operationId,
          purpose: "combined_early_bird",
          pricing_policy: "owner_test_10_20_v1",
          price_kind: "fixed_test",
          pricing_grant_id: wave.grant,
        },
      }),
    },
    { findIntent: async () => candidate },
  );
  const proof = await verifier.verify(wave.identity.operationId, provider);
  await call("bind_verified", [
    wave.identity.operationId,
    wave.user,
    provider,
    proof.evidenceDigest,
    JSON.stringify({
      ...candidate,
      baseMonthlyMinor: null,
      ruleVersion: null,
      participantKind: null,
      promotionEligible: null,
      quotedAt: null,
    }),
  ]);
  await call("public.early_bird_record_success", [
    wave.identity.operationId,
    wave.user,
    provider,
    proof.evidenceDigest,
    proof.providerCapturedAt,
  ]);
  card = await approvePublicWaveFinancialCard(wave.db, wave.user);
  pending = await publicFinancialPrepared(
    wave.db,
    card as Awaited<ReturnType<typeof publicFinancialOwner>>,
  );
  await q(
    "create or replace function pg_catalog.clock_timestamp() returns timestamptz language sql volatile as $$select '2027-01-11T21:00:01Z'::timestamptz$$",
  );
  await wave.db.db.transaction(
    async (tx) => {
      await tx.execute(
        sql`select public.early_bird_activate_projection(${wave.user}::uuid,${wave.identity.operationId}::uuid)`,
      );
    },
    { isolationLevel: "serializable" },
  );
  expert = (await q("select id from experts where user_id=$1", [wave.user]))
    .rows[0]!.id;
  native = await principal("native");
  schemaOnly = await principal("schema_only");
  authorized = await principal("authorized");
  minimal = await principal("minimal", true);
  await q(
    `grant usage on schema early_bird_private to ${schemaOnly.name},${authorized.name}`,
  );
  await q(
    `grant execute on function early_bird_private.public_wave_application(uuid),early_bird_private.public_current_wave_end(uuid) to ${authorized.name}`,
  );
}, 120000);
afterAll(async () => {
  if (wave)
    await q(
      "create or replace function pg_catalog.clock_timestamp() returns timestamptz language internal volatile strict as 'clock_timestamp'",
    );
  await Promise.all(pools.map((p) => p.end()));
  await wave?.db.stop();
}, 120000);

it("preserves the native LOGIN sequence with no private schema usage and only the existing public wave predicate grant", async () => {
  expect(
    (
      await native.pool.query(
        "select has_schema_privilege(current_user,'early_bird_private','USAGE') allowed",
      )
    ).rows[0]!.allowed,
  ).toBe(false);
  const unpaid = await wave.db.createExpertIdentity();
  expect(
    (
      await native.pool.query("select resident_native_admission($1) admitted", [
        unpaid.expertId,
      ])
    ).rows[0]!.admitted,
  ).toBe(false);
  await expect(
    native.pool.query("select * from early_bird_payment_successes"),
  ).rejects.toMatchObject({ code: "42501" });
  expect(
    (
      await native.pool.query("select resident_native_admission($1) admitted", [
        expert,
      ])
    ).rows[0]!.admitted,
  ).toBe(false);
  await q(
    `grant execute on function public.early_bird_current_publication_valid(uuid) to ${native.name}`,
  );
  expect(
    (
      await native.pool.query("select resident_native_admission($1) admitted", [
        expert,
      ])
    ).rows[0]!.admitted,
  ).toBe(true);
  expect(
    (
      await native.pool.query(
        "select has_schema_privilege(current_user,'early_bird_private','USAGE') allowed",
      )
    ).rows[0]!.allowed,
  ).toBe(false);
});

it("minimal legacy LOGIN needs no optional card/profile or private privileges for its actual fallback paths", async () => {
  expect(
    (
      await minimal.pool.query(
        "select has_schema_privilege(current_user,'early_bird_private','USAGE') allowed,has_table_privilege(current_user,'expert_card_drafts','SELECT') cards",
      )
    ).rows[0],
  ).toEqual({ allowed: false, cards: false });
  const legacyExpert = (
    await q("select id from experts where user_id=$1", [legacy.userId])
  ).rows[0]!.id;
  expect(
    (
      await minimal.pool.query(
        "select * from public.expert_residency_current_coverage($1)",
        [legacyExpert],
      )
    ).rows,
  ).toMatchObject([{ source_order_id: legacyOrder.orderId }]);
  expect(
    (
      await minimal.pool.query(
        "select public.expert_card_activation_gate_valid($1,$2) valid",
        [wave.user, randomUUID()],
      )
    ).rows[0]!.valid,
  ).toBe(false);
  await expect(
    anchor(minimal, await wave.db.createUser()),
  ).resolves.toBeTruthy();
  await expect(anchor(minimal, wave.user)).rejects.toMatchObject({
    message: "resident_verification_required",
  });
});

it.each(["native", "schemaOnly"] as const)(
  "%s caller uses genuine active legacy coverage and legacy activation fallback",
  async (key) => {
    const p = key === "native" ? native : schemaOnly;
    const legacyExpert = (
      await q("select id from experts where user_id=$1", [legacy.userId])
    ).rows[0]!.id;
    expect(
      (
        await p.pool.query(
          "select * from public.expert_residency_current_coverage($1)",
          [legacyExpert],
        )
      ).rows,
    ).toMatchObject([{ source_order_id: legacyOrder.orderId }]);
    expect(
      (
        await p.pool.query(
          "select public.expert_card_activation_gate_valid($1,$2) valid",
          [legacy.userId, legacyReview],
        )
      ).rows[0]!.valid,
    ).toBe(true);
    expect(
      (
        await p.pool.query(
          "select public.expert_card_activation_gate_valid($1,$2) valid",
          [wave.user, randomUUID()],
        )
      ).rows[0]!.valid,
    ).toBe(false);
  },
);

it.each(["native", "schemaOnly"] as const)(
  "%s caller retains legacy v2 price eligibility and denial without private execution",
  async (key) => {
    const p = key === "native" ? native : schemaOnly,
      user = await wave.db.createUser();
    expect(
      (
        await q("select resident_verification_price_allowed($1) allowed", [
          wave.user,
        ])
      ).rows[0]!.allowed,
    ).toBe(false);
    await expect(anchor(p, user)).resolves.toBeTruthy();
    await expect(anchor(p, wave.user)).rejects.toMatchObject({
      message: "resident_verification_required",
    });
  },
);

it("authorized continuation retains its real wave/card/price and connected public coverage functionality", async () => {
  expect(
    (
      await q(
        "select expert_card_activation_before_public_continuation($1,$2) valid",
        [
          wave.user,
          (
            await q(
              "select approved_review_id from expert_card_drafts where user_id=$1",
              [wave.user],
            )
          ).rows[0]!.approved_review_id,
        ],
      )
    ).rows[0]!.valid,
  ).toBe(false);
  const review = (
    await q(
      "select approved_review_id from expert_card_drafts where user_id=$1",
      [wave.user],
    )
  ).rows[0]!.approved_review_id;
  expect(
    (
      await authorized.pool.query(
        "select public.expert_card_activation_gate_valid($1,$2) valid",
        [wave.user, review],
      )
    ).rows[0]!.valid,
  ).toBe(true);
  await expect(anchor(authorized, wave.user)).resolves.toBeTruthy();
  await expect(
    authorized.pool.query("select * from early_bird_payment_successes"),
  ).rejects.toMatchObject({ code: "42501" });
  const terminal = await publicFinancialTerminal(wave.db, pending);
  await new PostgresExpertResidencyProviderInboxRepository(
    wave.db.db,
  ).applyPublic(
    pending.d.requestId,
    terminal.observationId,
    terminal.action.applyAttemptId,
  );
  expect(
    await call("public_payment_complete", [
      pending.d.requestId,
      terminal.action.applyAttemptId,
    ]),
  ).toMatchObject({ kind: "already_applied" });
  expect(
    (
      await authorized.pool.query(
        "select * from public.expert_residency_current_coverage($1)",
        [expert],
      )
    ).rows,
  ).toMatchObject([{ source_order_id: pending.order.orderId }]);
  expect(
    (
      await native.pool.query(
        "select * from public.expert_residency_current_coverage($1)",
        [expert],
      )
    ).rows,
  ).toEqual([]);
});
