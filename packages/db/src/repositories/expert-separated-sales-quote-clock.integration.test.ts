import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, it, expect } from "vitest";
import {
  PublicExpertRecovery,
  type YooKassaPayment,
} from "@ii-tonya/integrations";
import type { DrizzleDb } from "../client.js";
import {
  startPublicExpertTestDatabase,
  createPublicOnboardingFixture,
  publicTestPrincipal,
  publicTestDigest,
} from "../testkit/public-expert-payment.js";
import { publicFinancialClock } from "../testkit/public-expert-payment-financial.js";
import { createSeparatedSalesQuote } from "./expert-separated-sales-repository.js";
import {
  PostgresPublicExpertPaymentSource,
  PostgresPublicExpertPaymentBinder,
  PostgresPublicExpertPaymentObservations,
  PostgresPublicExpertPaymentPosting,
} from "./public-expert-payment-gateway.js";
import { PostgresExpertResidencyProviderInboxRepository } from "./expert-residency-provider-inbox-repository.js";
import { PostgresExpertVerificationRepository } from "./expert-verification-repository.js";

let context: Awaited<ReturnType<typeof startPublicExpertTestDatabase>>;
let unpaid: Awaited<ReturnType<typeof createPublicOnboardingFixture>>,
  paid: typeof unpaid;
let initial: string;
const pools: DrizzleDb[] = [];
const q = (text: string, args: unknown[] = []) =>
  context.db.db.$client.query(text, args);
async function fixedClock(at: string) {
  await q(
    `create or replace function pg_catalog.clock_timestamp() returns timestamptz language sql volatile as $$select '${at}'::timestamptz$$`,
  );
}
async function advancingClock(at: string) {
  await q("alter sequence public.quote_boundary_clock restart with 1");
  await q(
    `create or replace function pg_catalog.clock_timestamp() returns timestamptz language sql volatile as $$select '${at}'::timestamptz+nextval('public.quote_boundary_clock')*interval '1 millisecond'$$`,
  );
}
async function selection(user: string) {
  return (
    await q(
      "select s.offer_expiry_date::text expires,s.id from expert_sales_selections s where s.user_id=$1 order by selected_at desc,id desc limit 1",
      [user],
    )
  ).rows[0]!;
}
async function quote(user: string, key: string, paidOnly = false) {
  return context.db.db.transaction((tx) =>
    createSeparatedSalesQuote(tx, user, key, paidOnly),
  );
}
async function row(id: string | null) {
  return (
    await q(
      "select id,quoted_at::text quoted_at,expires_at::text expires_at,paid_lock_invoice_id,sales_selection_id,price_minor::text,expires_at-quoted_at=interval '24 hours' exact_day,expires_at<=quoted_at+interval '24 hours' bounded from expert_campaign_quotes where id=$1",
      [id],
    )
  ).rows[0]!;
}
beforeAll(async () => {
  context = await startPublicExpertTestDatabase();
  expect((await q("show server_version_num")).rows[0]!.server_version_num).toBe(
    "170005",
  );
  // Freeze setup only, avoiding the very boundary under test before the real
  // canonical selection and paid-lock fixtures exist. No source guards disabled.
  initial = (await q("select (clock_timestamp()+interval '1 second')::text at"))
    .rows[0]!.at;
  await fixedClock(initial);
  await q("create sequence public.quote_boundary_clock");
  unpaid = await createPublicOnboardingFixture(context);
  paid = await createPublicOnboardingFixture(context);
  const sender = await publicTestPrincipal(context, "onboarding"),
    bind = await publicTestPrincipal(context, "binder"),
    writer = await publicTestPrincipal(context, "writer"),
    gateway = await publicTestPrincipal(context, "gateway");
  pools.push(sender, bind, writer, gateway);
  const source = new PostgresPublicExpertPaymentSource({
      onboarding: sender,
      main: sender,
      refund: sender,
    }),
    observations = new PostgresPublicExpertPaymentObservations(writer);
  const binder = new PostgresPublicExpertPaymentBinder(bind);
  async function prepare(kind: "onboarding_create" | "onboarding_capture") {
    const capture = kind === "onboarding_capture",
      d = {
        requestId: randomUUID(),
        idempotencyKey: randomUUID(),
        legacyDeliveryOperationId: null,
        kind,
        requestDigest: publicTestDigest(randomUUID()),
        bodyVersion: 1 as const,
        ciphertext: capture ? null : "quote-clock-unused-replay",
        keyReference: capture ? null : "fixture:key",
        bodyExpiresAt: capture ? null : "2027-01-11T13:00:00Z",
      },
      contact = capture ? null : paid.contactId;
    const s = await source.prepare(
      "onboarding",
      paid.userId,
      paid.invoiceId,
      contact,
      d,
    );
    if (!s) throw Error("clock_paid_source_missing");
    expect(await source.admit(s)).toBeTruthy();
    expect(
      (
        await gateway.$client.query(
          "select public.public_expert_gateway_claim($1,$2,$3,$4,$5,$6) value",
          [
            paid.userId,
            s.requestId,
            contact,
            s.idempotencyKey,
            s.requestDigest,
            kind,
          ],
        )
      ).rows[0]!.value,
    ).toBeTruthy();
    return s;
  }
  const created = await prepare("onboarding_create");
  let at = "2027-01-11T12:00:00Z";
  let payment: YooKassaPayment = {
    id: `clock_${randomUUID()}`,
    status: "waiting_for_capture",
    paid: true,
    test: true,
    amount: { value: "3000.00", currency: "RUB" },
    createdAt: "2027-01-11T11:59:59.999Z",
    paymentMethodType: "bank_card",
    metadata: {
      purpose: "onboarding",
      operation_id: paid.operationId,
      order_id: paid.invoiceId,
      user_id: paid.userId,
    },
    refundable: true,
  };
  const recovery = new PublicExpertRecovery({
    binder,
    observations,
    now: () => at,
    transport: {
      listPayments: async () => ({ complete: true, items: [payment] }),
      getPayment: async () => structuredClone(payment),
      listRefunds: async () => ({ complete: true, items: [] }),
      getRefund: async () => {
        throw Error("unexpected_refund");
      },
    },
  });
  expect((await recovery.recover(created.requestId)).kind).toBe("observed");
  const captured = await prepare("onboarding_capture");
  at = "2027-01-11T12:00:01Z";
  await publicFinancialClock(context.db, at);
  payment = {
    ...payment,
    status: "succeeded",
    capturedAt: "2027-01-11T12:00:00.123456Z",
  };
  const fresh = await recovery.recover(captured.requestId);
  if (fresh.kind !== "observed") throw Error("clock_paid_capture_missing");
  expect(
    await new PostgresPublicExpertPaymentPosting(
      observations,
      new PostgresExpertResidencyProviderInboxRepository(context.db.db),
      new PostgresExpertVerificationRepository(context.db.db, {
        providerMode: "test",
        messagingConsentPolicyVersion: "client-messaging-v1",
      }),
    ).apply(captured.requestId, fresh.observationId),
  ).toMatchObject({ kind: "already_applied" });
}, 120000);
afterAll(async () => {
  if (context)
    await q(
      "create or replace function pg_catalog.clock_timestamp() returns timestamptz language internal volatile strict as 'clock_timestamp'",
    );
  await Promise.all(pools.map((db) => db.$client.end()));
  await context?.db.stop();
}, 120000);

it("uses one advancing-clock instant for the unpaid24h bound and freezes its idempotent timestamps", async () => {
  const at = (
    await q("select ($1::timestamptz+interval '1 minute')::text at", [initial])
  ).rows[0]!.at as string;
  expect(
    (
      await q(
        "select $1::timestamptz+interval '24 hours'<$2::timestamptz valid",
        [at, (await selection(unpaid.userId)).expires],
      )
    ).rows[0]!.valid,
  ).toBe(true);
  await advancingClock(at);
  const key = randomUUID(),
    id = await quote(unpaid.userId, key),
    original = await row(id);
  expect(original).toMatchObject({
    exact_day: true,
    bounded: true,
    paid_lock_invoice_id: null,
  });
  const later = (
    await q("select ($1::timestamptz+interval '2 hours')::text at", [at])
  ).rows[0]!.at as string;
  await advancingClock(later);
  expect(await quote(unpaid.userId, key)).toBe(id);
  expect(await row(id)).toEqual(original);
}, 60000);

it("caps an unpaid quote at its earlier immutable selection expiry", async () => {
  const s = await selection(unpaid.userId),
    at = (
      await q("select ($1::timestamptz-interval '2 hours')::text at", [
        s.expires,
      ])
    ).rows[0]!.at as string;
  await advancingClock(at);
  const result = await row(await quote(unpaid.userId, randomUUID()));
  expect(result).toMatchObject({
    expires_at: s.expires,
    exact_day: false,
    bounded: true,
    sales_selection_id: s.id,
  });
}, 60000);

it("uses the same24h bound for a genuine paid lock after its original selection offer has expired", async () => {
  const s = await selection(paid.userId),
    at = (
      await q("select ($1::timestamptz+interval '1 hour')::text at", [
        s.expires,
      ])
    ).rows[0]!.at as string;
  await advancingClock(at);
  const result = await row(await quote(paid.userId, randomUUID(), true));
  const lock = (
    await q(
      "select final_locked_price::text price from expert_sales_paid_locks where user_id=$1 and invoice_id=$2",
      [paid.userId, paid.invoiceId],
    )
  ).rows[0]!;
  expect(result).toMatchObject({
    exact_day: true,
    bounded: true,
    paid_lock_invoice_id: paid.invoiceId,
    sales_selection_id: s.id,
    price_minor: lock.price,
  });
}, 60000);
