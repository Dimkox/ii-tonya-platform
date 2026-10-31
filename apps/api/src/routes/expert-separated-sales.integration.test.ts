import Fastify from "fastify";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  createPayerReceiptVault,
  ExperimentalGatewayIpc,
} from "@ii-tonya/integrations";
import { createPublicExpertPaymentRuntime } from "../../../../packages/db/src/public-expert-payment-runtime.js";
import { PostgresPublicExpertPaymentObservations } from "../../../../packages/db/src/repositories/public-expert-payment-gateway.js";
import { createPublicExpertRuntimePrincipals } from "../../../../packages/db/src/testkit/public-expert-runtime-principals.js";
import { PostgresPayerReceiptContactRepository } from "../../../../packages/db/src/repositories/payer-receipt-contact-repository.js";
import { buildEarlyBirdRoleProvisioningSql } from "../../../../scripts/provision-early-bird-runtime-roles.mjs";
import {
  startPublicExpertFuturePostgres,
  startPublicExpertGatewayProvider,
} from "../../../../tests/support/public-expert-gateway-provider.mjs";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../../../../packages/db/src/testkit/expert-referral.js";
import { seedClientConsent } from "../../../../packages/db/src/testkit/client-consent.js";
import { PostgresExpertVerificationRepository } from "../../../../packages/db/src/repositories/expert-verification-repository.js";
import { createExpertApplicantComposition } from "../expert-applicant-composition.js";
import { expertApplicantTelegramRoutes } from "./expert-applicant-telegram.js";
import { loadEnv } from "@ii-tonya/config";
let database: ExpertReferralTestDatabase;
let clock: Awaited<ReturnType<typeof startPublicExpertFuturePostgres>>;
let provider: Awaited<ReturnType<typeof startPublicExpertGatewayProvider>>;
let principals: Awaited<ReturnType<typeof createPublicExpertRuntimePrincipals>>;
let runtime: ReturnType<typeof createPublicExpertPaymentRuntime>;
const vault = createPayerReceiptVault({
  activeKeyId: "fixture",
  keys: new Map([["fixture", new Uint8Array(32).fill(7)]]),
});
type ProviderPayment = {
  id: string;
  status: string;
  amount: { value: string; currency: string };
  metadata: Record<string, string>;
  captured_at?: string;
};
async function providerStats() {
  return provider.command({ op: "stats" }) as Promise<{
    posts: {
      path: string;
      key: string;
      metadata: Record<string, string> | null;
      hasReceipt: boolean;
      capture: boolean | null;
      paymentMethodType: string | null;
    }[];
    reads: string[];
    payments: ProviderPayment[];
  }>;
}
beforeAll(async () => {
  clock = await startPublicExpertFuturePostgres();
  const NativeDate = Date;
  vi.stubGlobal(
    "Date",
    new Proxy(NativeDate, {
      construct(target, args) {
        return Reflect.construct(
          target,
          args.length ? args : [NativeDate.now() + clock.offsetSeconds * 1000],
        );
      },
      get(target, property) {
        return property === "now"
          ? () => NativeDate.now() + clock.offsetSeconds * 1000
          : Reflect.get(target, property);
      },
    }),
  );
  const previous = process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL;
  process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL = clock.connectionString;
  try {
    database = await startExpertReferralTestDatabase();
  } finally {
    if (previous === undefined)
      delete process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL;
    else process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL = previous;
  }
  expect(
    (await database.db.$client.query("show server_version_num")).rows[0]!
      .server_version_num,
  ).toBe("170005");
  principals = await createPublicExpertRuntimePrincipals(database.db);
  const gatewayLogin = "sales_gateway_" + randomUUID().replaceAll("-", "");
  const password = randomBytes(24).toString("hex");
  await database.db.$client.query(
    `create role ${gatewayLogin} login inherit password '${password}'`,
  );
  await database.db.$client.query(
    await buildEarlyBirdRoleProvisioningSql({
      ii_tonya_wave_gateway: gatewayLogin,
    }),
  );
  provider = await startPublicExpertGatewayProvider(
    database.db.$client.options.connectionString!,
    gatewayLogin,
    password,
    clock.offsetSeconds,
  );
  const requestKey = randomBytes(32);
  runtime = createPublicExpertPaymentRuntime(database.db, {
    connections: principals.connections,
    gateway: new ExperimentalGatewayIpc({
      address: provider.address,
      key: Buffer.alloc(32, "k"),
      authKey: Buffer.alloc(32, "a"),
      timeoutMs: 10000,
    }),
    mode: "test",
    messagingConsentPolicyVersion: "client-messaging-v1",
    vault,
    requestKey,
    requestKeyReference: "sales:v1",
    retainedRequestKeys: new Map([["sales:v1", requestKey]]),
    returnUrl: "https://example.com/return",
    vatCode: 1,
  });
  await runtime.assertReady();
  await seedClientConsent(
    database.db,
    await database.createUser(),
    "client_messaging",
  );
}, 180000);
afterAll(async () => {
  const failures: unknown[] = [];
  for (const cleanup of [
    () => runtime?.stop(),
    () => provider?.close(),
    () => principals?.close(),
    () => database?.stop(),
    () => clock?.stop(),
  ]) {
    try {
      await cleanup();
    } catch (error) {
      failures.push(error);
    }
  }
  vi.unstubAllGlobals();
  if (failures.length)
    throw new AggregateError(failures, "sales public fixture cleanup failed");
}, 120000);
it("normal private ingress shows base, separate positive/promo/period, real form and manager-approved fixed fee", async () => {
  const tariff = await database.createResidencyTariff({
    tariffKey: "PRO",
    displayName: "PRO",
    priceMinor: 1000000,
    durationSeconds: 2592000,
  });
  const config = loadEnv({
    DATABASE_URL: "postgresql://synthetic:synthetic@localhost/fixture",
    ALLOW_INSECURE_LOCAL_DATABASE: "true",
    EXPERT_APPLICANT_ENABLED: "true",
    EXPERT_VERIFICATION_FORM_ENABLED: "true",
    EXPERT_SEPARATED_SALES_ENABLED: "true",
    EXPERT_PROMO_TELEGRAM_BOT_ID: "717171",
    EXPERT_PROMO_TELEGRAM_BOT_KEY: "sales-fixture",
    EXPERT_PROMO_TELEGRAM_WEBHOOK_SECRET: [
      "synthetic",
      "sales",
      "secret",
      "1234567890",
    ].join("_"),
    EXPERT_PROMO_MESSAGING_CONSENT_POLICY_VERSION: "client-messaging-v1",
  });
  let activeCheckout: Pick<typeof runtime.held, "recoverCheckout"> | undefined;
  const app = Fastify({ logger: false });
  await app.register(expertApplicantTelegramRoutes, {
    enabled: true,
    capability: createExpertApplicantComposition(database.db, config, {
      receipt: { vault, retentionDays: 30 },
      checkout: {
        recoverCheckout: (input) =>
          activeCheckout
            ? activeCheckout.recoverCheckout(input)
            : Promise.resolve({ kind: "unavailable" }),
      },
    })!,
  });
  let update = 1;
  const send = async (text: string, callback?: string) => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/webhooks/telegram/expert-promo/sales-fixture",
      headers: {
        "x-telegram-bot-api-secret-token":
          config.expertApplicant!.webhookSecret,
      },
      payload: {
        update_id: update++,
        ...(callback
          ? {
              callback_query: {
                id: "synthetic",
                from: { id: 777001 },
                message: {
                  from: { id: 717171, is_bot: true },
                  chat: { id: 777001, type: "private" },
                },
                data: callback,
              },
            }
          : {
              message: {
                from: { id: 777001 },
                chat: { id: 777001, type: "private" },
                text,
              },
            }),
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    return res.json();
  };
  const click = async (
    view: { reply_markup: { inline_keyboard: { callback_data: string }[][] } },
    suffix: string,
  ) => {
    const b = view.reply_markup.inline_keyboard
      .flat()
      .find((v) => v.callback_data.endsWith(suffix));
    expect(b).toBeDefined();
    return send("", b!.callback_data);
  };
  try {
    const consent = await send("/start");
    const token = /\/consent ([A-Za-z0-9_-]+) granted/u.exec(consent.text)![1];
    await send(`/consent ${token} granted`);
    const start = await send("/start");
    expect(start.text).toContain("базовой");
    await send("/profile kazan 0 offline 300000 expert");
    const base = await send("", `sb:${tariff}`);
    expect(base.text).toContain("9990 ₽");
    expect(base.text).not.toMatch(/5994|40%|акци/u);
    const clock = (
      await database.db.execute(
        sql`select base_offer_shown_at from expert_sales_bases`,
      )
    ).rows[0];
    const silent = await send("Мой актуальный тариф");
    expect(silent.text).not.toMatch(/5994|акци/u);
    await send("/profile changed 1 online_only 100000 expert");
    expect((await send("Мой актуальный тариф")).text).toContain("9990 ₽");
    expect(
      (
        await database.db.execute(
          sql`select base_offer_shown_at from expert_sales_bases`,
        )
      ).rows[0],
    ).toEqual(clock);
    const promo = await click(base, ":positive");
    expect(promo.text).toContain("5994 ₽");
    expect(
      (
        await database.db.execute(
          sql`select count(*)::int n from expert_sales_selections`,
        )
      ).rows[0]?.n,
    ).toBe(0);
    const period = await click(promo, ":promo");
    const form = await click(period, ":quarter");
    expect(form.text).toContain("рол");
    await send("/set roles EXPERT");
    await send("/set primaryRole EXPERT");
    await send("/set category BASIC");
    await send("/set tax SELF_EMPLOYED");
    await send("/set city Казань");
    await send("/set socialLinks https://example.com/expert");
    await send("/set motivation Работа с клиентами");
    await send("/set specialization Психология");
    await send("/set methods Практика");
    await send("/set experienceYears 5");
    await send("/set cases Пример");
    const ready = await send("/set averageCheckMinor 300000");
    const submitted = await click(ready, ":submit");
    expect(submitted.text).toContain("Анкета получена");
    expect(submitted.text).not.toContain("цены ещё не доступны");
    const beforeApproval = await send("", "st:current");
    expect(beforeApproval.text).toContain("осталось");
    expect(beforeApproval.text).not.toMatch(
      /https:\/\/(?:yookassa|yoomoney)\.ru\//u,
    );
    expect((await providerStats()).posts).toHaveLength(0);
    const captured = await send("/receipt synthetic@example.com");
    expect(captured.text).toContain("Адрес для чека сохранён");
    expect(JSON.stringify(captured)).not.toContain("synthetic@example.com");
    expect(
      (
        await database.db.execute(
          sql`select ciphertext from payer_receipt_contacts`,
        )
      ).rows[0]?.ciphertext,
    ).toBeTruthy();
    const bridge = (
      await database.db.execute<{ id: string }>(
        sql`select application_id id from expert_sales_form_bridges`,
      )
    ).rows[0]!;
    expect(bridge).toBeDefined();
    const manager = await database.createUser();
    const managerToken = randomUUID();
    const session = `sha256:${createHash("sha256").update(managerToken).digest("hex")}`;
    await database.db.execute(
      sql`insert into admin_sessions(session_id_hash,admin_id,mfa_verified_at,expires_at) values(${session},${manager}::uuid,clock_timestamp(),clock_timestamp()+interval '1 hour')`,
    );
    await database.db.execute(
      sql`insert into admin_role_assignments(admin_id,role) values(${manager}::uuid,'support')`,
    );
    const repo = new PostgresExpertVerificationRepository(database.db, {
      providerMode: "test",
      messagingConsentPolicyVersion: "client-messaging-v1",
    });
    const detail = await repo.applicationDetail(session, bridge.id);
    expect(detail?.questionnaire).toMatchObject({ status: "submitted" });
    const reviewForm = (
      await database.db.execute<{ revision: number; generation: number }>(
        sql`select f.revision,f.check_generation generation from residents_applications f join expert_sales_form_bridges b on b.form_id=f.id where b.application_id=${bridge.id}::uuid`,
      )
    ).rows[0]!;
    const { expertVerificationRoutes } =
      await import("./expert-verification.js");
    const { createExpertVerificationComposition } =
      await import("../expert-verification-composition.js");
    const managerApp = Fastify({ logger: false });
    const managerConfig = loadEnv({
      DATABASE_URL: "postgresql://synthetic:synthetic@localhost/fixture",
      ALLOW_INSECURE_LOCAL_DATABASE: "true",
      EXPERT_VERIFICATION_ENABLED: "true",
      EXPERT_VERIFICATION_PAYMENT_MODE: "test",
      EXPERT_VERIFICATION_MESSAGING_CONSENT_POLICY_VERSION:
        "client-messaging-v1",
    });
    const capability = createExpertVerificationComposition(
      database.db,
      managerConfig,
    )!;
    await managerApp.register(expertVerificationRoutes, {
      enabled: true,
      service: capability.service,
    });
    try {
      const headers = { authorization: `Bearer ${managerToken}` };
      const denied = await managerApp.inject({
        method: "POST",
        url: `/v1/admin/expert-verification/${bridge.id}/decision`,
        headers,
        payload: {
          decision: "approved",
          reasonCode: "verified",
          idempotencyKey: randomUUID(),
        },
      });
      expect(denied.statusCode).toBe(503);
      const previewResponse = await managerApp.inject({
        method: "POST",
        url: `/v1/admin/expert-verification/${bridge.id}/review-preview`,
        headers,
        payload: {
          key: "APPROVED_BASIC",
          expectedRevision: reviewForm.revision,
          expectedGeneration: reviewForm.generation,
        },
      });
      expect(previewResponse.statusCode, previewResponse.body).toBe(200);
      const preview = previewResponse.json().item;
      const confirmed = await managerApp.inject({
        method: "POST",
        url: `/v1/admin/expert-verification/${bridge.id}/review-confirm`,
        headers,
        payload: { previewId: preview.previewId, finalHash: preview.hash },
      });
      expect(confirmed.statusCode, confirmed.body).toBe(200);
      const result = await managerApp.inject({
        method: "GET",
        url: `/v1/admin/expert-verification/${bridge.id}`,
        headers,
      });
      expect(result.statusCode).toBe(200);
      expect(result.json().item.questionnaire.lifecycle).toBe("APPROVED_BASIC");
    } finally {
      await managerApp.close();
    }
    const decision = (
      await database.db.execute<{ invoiceId: string }>(
        sql`select id as "invoiceId" from expert_onboarding_invoices where application_id=${bridge.id}::uuid`,
      )
    ).rows[0]!;
    expect(
      (
        await database.db.execute(
          sql`select amount_minor::text amount from expert_onboarding_invoices where id=${decision.invoiceId}::uuid`,
        )
      ).rows[0]?.amount,
    ).toBe("300000");
    expect(
      (
        await database.db.execute(
          sql`select count(*)::int n from expert_sales_fee_attempts`,
        )
      ).rows[0]?.n,
    ).toBe(1);
    expect(
      (
        await database.db.execute(
          sql`select count(*)::int n from expert_sales_paid_locks`,
        )
      ).rows[0]?.n,
    ).toBe(0);
    {
      const source = (
        await database.db.execute<{
          userId: string;
          quoteId: string;
          operationId: string;
        }>(
          sql`select i.user_id as "userId",b.quote_id as "quoteId",o.id as "operationId" from expert_onboarding_invoices i join expert_sales_form_bridges b on b.application_id=i.application_id join expert_onboarding_payment_operations o on o.invoice_id=i.id where i.id=${decision.invoiceId}::uuid`,
        )
      ).rows[0]!;
      // The authenticated ingress continues its own approved invoice. Public
      // delivery obtains the receipt and operation from that canonical source.
      const checkout = runtime.held;
      activeCheckout = checkout;
      const currentTariff = await send("", "st:current");
      expect(currentTariff.text).toContain("15284,70 ₽");
      expect(currentTariff.text).toContain("Срок:");
      expect(currentTariff.text).toContain("осталось");
      expect(currentTariff.text).toContain("3000 ₽: https://yoomoney.ru/");
      const ready = await checkout.recoverCheckout({
        invoiceId: decision.invoiceId!,
        operationId: source.operationId,
      });
      expect(ready.kind).toBe("ready");
      await checkout.recoverCheckout({
        invoiceId: decision.invoiceId!,
        operationId: source.operationId,
      });
      expect(
        (await providerStats()).posts.filter((r) => r.path === "/v3/payments"),
      ).toHaveLength(1);
      expect((await providerStats()).posts[0]).toMatchObject({
        capture: false,
        paymentMethodType: "bank_card",
        hasReceipt: true,
        metadata: {
          purpose: "onboarding",
          order_id: decision.invoiceId,
          operation_id: source.operationId,
          user_id: source.userId,
        },
      });
      const persisted = (
        await database.db.execute<{ encrypted: string; body: string | null }>(
          sql`select encrypted_body encrypted,request_body body from expert_sales_provider_requests where invoice_id=${decision.invoiceId}::uuid and kind='create'`,
        )
      ).rows[0]!;
      expect(persisted.body).toBeNull();
      expect(persisted.encrypted).not.toContain("synthetic@example.com");
      const pending = (await providerStats()).payments.find(
        (payment) => payment.metadata.order_id === decision.invoiceId,
      )!;
      expect(pending).toMatchObject({
        id: ready.kind === "ready" ? ready.paymentId : "missing",
        status: "pending",
        amount: { value: "3000.00", currency: "RUB" },
      });
    }
  } finally {
    await app.close();
  }
}, 120000);

it("authoritative fee success locks only selected quarter; later quote sources preserve terms and wrong periods are denied", async () => {
  const { PostgresExpertCampaignQuoteRepository } =
    await import("../../../../packages/db/src/repositories/expert-campaign-quote-repository.js");
  const repo = new PostgresExpertVerificationRepository(database.db, {
    providerMode: "test",
    messagingConsentPolicyVersion: "client-messaging-v1",
  });
  const row = (
    await database.db.execute<{
      invoice: string;
      operation: string;
      userId: string;
      tariff: string;
    }>(
      sql`select i.id invoice,o.id operation,i.user_id as "userId",b.tariff_version_id tariff from expert_onboarding_invoices i join expert_onboarding_payment_operations o on o.invoice_id=i.id join expert_sales_bases b on b.user_id=i.user_id order by i.created_at limit 1`,
    )
  ).rows[0]!;
  const binding = await repo.findOnboardingPaymentBinding(row.invoice);
  expect(binding).not.toBeNull();
  const pending = (await providerStats()).payments.find(
    (item) => item.metadata.order_id === row.invoice,
  )!;
  expect(pending.status).toBe("pending");
  expect(
    (
      await database.db.execute(
        sql`select i.status,(select count(*)::int from expert_onboarding_payment_facts f where f.invoice_id=i.id) facts,(select count(*)::int from public_expert_payment_resolutions resolution join public_expert_payment_requests request on request.id=resolution.request_id where request.invoice_id=i.id and resolution.kind='applied') applied from expert_onboarding_invoices i where i.id=${row.invoice}::uuid`,
      )
    ).rows[0],
  ).toEqual({ status: "pending", facts: 0, applied: 0 });
  // Confirm only at the local bank boundary. Both real reconciliation paths
  // start before the first financial application, racing capture and settlement.
  await provider.command({
    op: "payment",
    id: pending.id,
    status: "waiting_for_capture",
  });
  const firstReconciliations = await Promise.all([
    runtime.held.reconcile(row.invoice),
    runtime.held.reconcile(row.invoice),
  ]);
  // An admitted CAPTURE can legitimately make its contender pending. The held
  // port returns the pre-capture observation, not a financial replay boolean.
  expect(firstReconciliations.map((result) => result.kind)).not.toContain(
    "unavailable",
  );
  expect(
    firstReconciliations.some((result) => result.kind === "observed"),
  ).toBe(true);
  const stats = await providerStats();
  expect(
    stats.posts.filter((post) => post.path.endsWith("/capture")),
  ).toHaveLength(1);
  expect(
    (
      await database.db.execute(
        sql`select count(*)::int n from public_expert_payment_observations observation join public_expert_payment_requests request on request.id=observation.request_id where request.invoice_id=${row.invoice}::uuid and observation.status='waiting_for_capture'`,
      )
    ).rows[0]?.n,
  ).toBeGreaterThanOrEqual(1);
  expect(
    (
      await database.db.execute(
        sql`select exists(select 1 from public_expert_payment_requests capture join public_expert_payment_requests original on original.invoice_id=capture.invoice_id and original.kind='onboarding_create' join public_expert_payment_observations held on held.request_id=original.id and held.provider_object_id=capture.parent_payment_id where capture.invoice_id=${row.invoice}::uuid and capture.kind='onboarding_capture' and held.status='waiting_for_capture' and held.payment_method_type='bank_card' and held.observed_at<=capture.dispatched_at) proven`,
      )
    ).rows[0]?.proven,
  ).toBe(true);
  const payment = stats.payments.find((item) => item.id === pending.id)!;
  expect(payment.status).toBe("succeeded");
  expect(payment.captured_at).toEqual(expect.any(String));
  expect(
    (
      await database.db.execute(
        sql`select i.status,f.provider_object_id payment,early_bird_private.public_time(f.captured_at) captured from expert_onboarding_invoices i join expert_onboarding_payment_facts f on f.invoice_id=i.id where i.id=${row.invoice}::uuid`,
      )
    ).rows[0],
  ).toEqual({
    status: "settled",
    payment: pending.id,
    captured: payment.captured_at,
  });
  const request = (
    await database.db.execute<{ id: string }>(
      sql`select id from public_expert_payment_requests where invoice_id=${row.invoice}::uuid and kind='onboarding_capture'`,
    )
  ).rows[0]!;
  const postsBeforeReplay = stats.posts.length;
  const recovered = await Promise.all([
    runtime.recovery.recover(request.id),
    runtime.recovery.recover(request.id),
  ]);
  const observations = new PostgresPublicExpertPaymentObservations(
    principals.connections.observations.db,
  );
  const replayed = await Promise.all(
    recovered.map(async (result) => {
      if (result.kind !== "observed") throw Error("fee_replay_not_observed");
      expect(result.observation.status).toBe("succeeded");
      return observations.resolve(request.id, result.observationId);
    }),
  );
  expect(replayed.map((result) => result?.kind)).toEqual([
    "already_applied",
    "already_applied",
  ]);
  expect((await providerStats()).posts).toHaveLength(postsBeforeReplay);
  expect(
    (
      await database.db.execute(
        sql`select count(*)::int n from expert_onboarding_payment_facts where invoice_id=${row.invoice}::uuid`,
      )
    ).rows[0]?.n,
  ).toBe(1);
  expect(
    (
      await database.db.execute(
        sql`select count(*)::int n from expert_onboarding_payment_facts fact join public_expert_payment_requests request on request.invoice_id=fact.invoice_id and request.legacy_operation_id=fact.operation_id join public_expert_payment_observations observation on observation.request_id=request.id and observation.id=request.apply_observation_id where fact.invoice_id=${row.invoice}::uuid and fact.event_id='public:'||request.id::text||':'||observation.id::text and fact.evidence_digest=observation.evidence_digest and fact.provider_object_id=observation.provider_object_id and fact.captured_at=observation.provider_captured_at`,
      )
    ).rows[0]?.n,
  ).toBe(1);
  expect(
    (
      await database.db.execute(
        sql`select count(*)::int n from public_expert_payment_resolutions where request_id=${request.id}::uuid and kind='applied'`,
      )
    ).rows[0]?.n,
  ).toBe(1);
  const { yookassaWebhookRoutes } = await import("./yookassa-webhook.js");
  const { PostgresWebhookInboxRepository } =
    await import("../../../../packages/db/src/repositories/webhook-inbox-repository.js");
  const app = Fastify({ logger: false });
  await app.register(yookassaWebhookRoutes, {
    effectivePeerAddress: () => "185.71.76.1",
    inbox: new PostgresWebhookInboxRepository(database.db),
    publicPayment: runtime,
    resolvePurpose: async (id) =>
      (await repo.findOnboardingInvoiceByProviderObjectId(id))
        ? "ONBOARDING_FEE"
        : null,
    onboarding: {
      async handle() {
        throw Error("must_not_fall_back_to_legacy_onboarding");
      },
    },
    verify: async () => {
      throw Error("must_not_route_to_main");
    },
    deliver: async () => {
      throw Error("must_not_grant_main");
    },
    resolveSucceeded: async () => {},
  });
  try {
    for (let delivery = 0; delivery < 2; delivery++)
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/v1/webhooks/yookassa",
            payload: {
              type: "notification",
              event: "payment.succeeded",
              object: { id: payment.id },
            },
          })
        ).statusCode,
      ).toBe(200);
  } finally {
    await app.close();
  }
  const lock = (
    await database.db.execute(
      sql`select final_locked_price::text price,term_months term from expert_sales_paid_locks where user_id=${row.userId}::uuid`,
    )
  ).rows[0];
  expect(lock).toEqual({ price: "1528470", term: 3 });
  expect(
    (
      await database.db.execute(
        sql`select count(*)::int n from expert_sales_paid_locks where user_id=${row.userId}::uuid`,
      )
    ).rows[0]?.n,
  ).toBe(1);
  expect(
    (
      await database.db.execute(
        sql`select count(*)::int n from expert_residency_orders`,
      )
    ).rows[0]?.n,
  ).toBe(0);
  const quotes = new PostgresExpertCampaignQuoteRepository(database.db);
  await expect(
    quotes.createCurrentQuote({
      userId: row.userId,
      tariffVersionId: row.tariff,
      termMonths: 1,
      idempotencyKey: "wrong-period",
    }),
  ).rejects.toThrow();
  const initial = await quotes.createCurrentQuote({
    userId: row.userId,
    tariffVersionId: row.tariff,
    termMonths: 3,
    idempotencyKey: "initial-main-locked",
  });
  const automatic = await quotes.createQuote({
    userId: row.userId,
    tariffVersionId: row.tariff,
    termMonths: 3,
    idempotencyKey: "automatic-renewal-locked",
  });
  expect(initial).toMatchObject({
    ruleVersion: "expert_separated_sales_v3",
    priceMinor: "1528470",
    termMonths: 3,
  });
  expect(automatic.priceMinor).toBe(initial.priceMinor);
  await expect(
    database.db.execute(
      sql`update expert_sales_paid_locks set final_locked_price=1 where user_id=${row.userId}::uuid`,
    ),
  ).rejects.toThrow();
}, 120000);

it("paid selected terms feed the real gated main invoice and never bypass card/promo admission", async () => {
  const { PostgresExpertCardRepository } =
    await import("../../../../packages/db/src/repositories/expert-card-repository.js");
  const { PostgresExpertOnboardingMainPaymentRepository } =
    await import("../../../../packages/db/src/repositories/expert-onboarding-main-payment-repository.js");
  await database.enableExpertReferralCommands();
  const row = (
    await database.db.execute<{
      userId: string;
      applicationId: string;
      tariff: string;
    }>(
      sql`select b.user_id as "userId",a.id as "applicationId",b.tariff_version_id tariff from expert_sales_bases b join expert_onboarding_applications a on a.user_id=b.user_id join expert_sales_paid_locks l on l.user_id=b.user_id`,
    )
  ).rows[0]!;
  const session = (
    await database.db.execute<{ hash: string }>(
      sql`select s.session_id_hash hash from admin_sessions s join admin_role_assignments r on r.admin_id=s.admin_id and r.role='support' order by s.mfa_verified_at desc limit 1`,
    )
  ).rows[0]!.hash;
  let update = 8000;
  const event = (scope: {
    botId: string;
    botKey: string;
    telegramUserId: string;
    chatId: string;
  }) => {
    const requestKey = `${scope.botId}:${++update}`;
    return {
      ...scope,
      requestKey,
      requestDigest: createHash("sha256").update(requestKey).digest("hex"),
    };
  };
  const promo = {
    botId: "717171",
    botKey: "sales-fixture",
    telegramUserId: "777001",
    chatId: "777001",
  };
  const work = { ...promo, botId: "818181", botKey: "sales-work" };
  const cards = new PostgresExpertCardRepository(database.db, {
    messagingConsentPolicyVersion: "client-messaging-v1",
    workBotId: work.botId,
    workBotKey: work.botKey,
    materialTransport: {
      async send(input) {
        return {
          messageIds: ["100"],
          botId: input.botId,
          chatId: input.chatId,
          contentVersion: input.contentVersion,
          payloadDigest: input.payloadDigest,
        };
      },
    },
  });
  const financial = new PostgresExpertOnboardingMainPaymentRepository(
    database.db,
    {
      providerMode: "test",
      messagingConsentPolicyVersion: "client-messaging-v1",
    },
  );
  const handoff = await cards.issueWorkHandoff(event(promo));
  expect(handoff.kind).toBe("issued");
  if (handoff.kind !== "issued") throw Error("fixture_handoff");
  await cards.redeemWorkHandoff({ ...event(work), token: handoff.token });
  let state = (await cards.getWorkflow(work))!;
  await expect(
    financial.quoteMain({
      ...event(work),
      tariffVersionId: row.tariff,
      termMonths: 3,
      revision: state.revision,
    }),
  ).rejects.toThrow();
  await cards.addEntry({
    ...event(work),
    expectedRevision: state.revision,
    entry: { kind: "text", text: "Частные ответы для карточки" },
  });
  state = (await cards.getWorkflow(work))!;
  await cards.submitDraft({ ...event(work), expectedRevision: state.revision });
  await cards.editPublicCard({
    sessionHash: session,
    applicationId: row.applicationId,
    expectedRevision: state.revision,
    idempotencyKey: randomUUID(),
    publicCard: {
      displayName: "Мария",
      profession: "Психолог",
      city: "Казань",
      summary: "Индивидуальные консультации",
    },
  });
  state = (await cards.getWorkflow(work))!;
  await cards.reviewCard({
    sessionHash: session,
    applicationId: row.applicationId,
    expectedRevision: state.revision,
    idempotencyKey: randomUUID(),
    action: "approve",
  });
  await expect(
    financial.quoteMain({
      ...event(work),
      tariffVersionId: row.tariff,
      termMonths: 3,
      revision: state.revision,
    }),
  ).rejects.toThrow();
  await database.db.execute(
    sql`insert into expert_card_material_templates(content_version,status,text_body,assets) values('sales-fixture-v1','approved','Материалы','[]'::jsonb)`,
  );
  for (const job of await cards.listDueMaterialJobs())
    await cards.deliverMaterials(job.jobId, {
      signal: new AbortController().signal,
    });
  await cards.submitPromoProof({
    ...event(work),
    expectedRevision: state.revision,
    proof: { kind: "photo", reference: "telegram:file:synthetic_promo" },
  });
  await cards.confirmPromo({
    sessionHash: session,
    applicationId: row.applicationId,
    expectedRevision: state.revision,
    idempotencyKey: randomUUID(),
  });
  const quote = await financial.quoteMain({
    ...event(work),
    tariffVersionId: row.tariff,
    termMonths: 3,
    revision: state.revision,
  });
  expect(quote.priceMinor).toBe("1528470");
  await financial.acceptMain({
    ...event(work),
    quoteId: quote.id,
    revision: state.revision,
  });
  // Main requires its own genuinely captured receipt for this accepted quote;
  // the onboarding contact cannot authorize another invoice's disclosure.
  const contact = await new PostgresPayerReceiptContactRepository(
    database.db,
    vault,
    30,
  ).capture({
    userId: row.userId,
    quoteId: quote.id,
    email: "synthetic@example.com",
    idempotencyKey: randomUUID(),
  });
  const invoice = await financial.createMainInvoice({
    ...event(work),
    revision: state.revision,
  });
  expect(
    (
      await database.db.execute(
        sql`select price_minor::text price,campaign_term_months term,duration_seconds seconds from expert_residency_orders where id=${invoice.orderId}::uuid`,
      )
    ).rows[0],
  ).toEqual({ price: "1528470", term: 3, seconds: 7776000 });
  await database.db.execute(
    sql`insert into payer_receipt_order_bindings(order_id,contact_id,quote_id,user_id) values(${invoice.orderId}::uuid,${contact.receiptContactId}::uuid,${quote.id}::uuid,${row.userId}::uuid)`,
  );
  const binding = await financial.checkoutBindingForOwner(
    { ...event(work), revision: state.revision },
    invoice.orderId,
  );
  const ready = await runtime.main.createOrRecover(binding);
  expect(ready).toMatchObject({ kind: "ready", orderId: invoice.orderId });
  await runtime.main.createOrRecover(binding);
  const stats = await providerStats();
  const mainPosts = stats.posts.filter(
    (post) => post.metadata?.order_id === invoice.orderId,
  );
  expect(mainPosts).toHaveLength(1);
  expect(mainPosts[0]).toMatchObject({
    path: "/v3/payments",
    capture: true,
    hasReceipt: true,
    metadata: { purpose: "main_residency", user_id: row.userId },
  });
  expect(
    stats.payments.find((item) => item.metadata.order_id === invoice.orderId),
  ).toMatchObject({
    id: ready.kind === "ready" ? ready.paymentId : "missing",
    status: "pending",
    amount: { value: "15284.70", currency: "RUB" },
  });
  expect(
    (
      await database.db.execute(
        sql`select count(*)::int n from experts_published where user_id=${row.userId}::uuid and active`,
      )
    ).rows[0]?.n,
  ).toBe(0);
}, 120000);

it("automatic bill and explicit renewal preserve the locked quarter after the original tariff closes", async () => {
  const { PostgresExpertResidencyLifecycleRepository } =
    await import("../../../../packages/db/src/repositories/expert-residency-lifecycle-repository.js");
  const { PostgresExpertOnboardingMainPaymentRepository } =
    await import("../../../../packages/db/src/repositories/expert-onboarding-main-payment-repository.js");
  const row = (
    await database.db.execute<{
      id: string;
      cash: string;
      tariff: string;
      userId: string;
    }>(
      sql`select o.id,o.cash_minor::text cash,o.tariff_version_id tariff,l.user_id as "userId" from expert_residency_orders o join experts e on e.id=o.expert_id join expert_sales_paid_locks l on l.user_id=e.user_id where o.status='payment_pending'`,
    )
  ).rows[0]!;
  const pending = (await providerStats()).payments.find(
    (item) => item.metadata.order_id === row.id,
  )!;
  const request = (
    await database.db.execute<{ id: string }>(
      sql`select id from public_expert_payment_requests where order_id=${row.id}::uuid and kind='main_create'`,
    )
  ).rows[0]!;
  // The local provider completes the capture:true bank payment. Financial
  // evidence still arrives only through the real gateway's fresh GET.
  await provider.command({
    op: "payment",
    id: pending.id,
    status: "succeeded",
  });
  await runtime.recovery.recover(request.id);
  const payment = (await providerStats()).payments.find(
    (item) => item.id === pending.id,
  )!;
  expect(payment.captured_at).toEqual(expect.any(String));
  expect(
    (
      await database.db.execute(
        sql`select status,provider_payment_id payment,early_bird_private.public_time(settled_at) settled,early_bird_private.public_time(residency_starts_at) starts,extract(epoch from residency_ends_at-residency_starts_at)::int seconds from expert_residency_orders where id=${row.id}::uuid`,
      )
    ).rows[0],
  ).toEqual({
    status: "settled",
    payment: payment.id,
    settled: payment.captured_at,
    starts: payment.captured_at,
    seconds: 7776000,
  });
  expect(
    (
      await database.db.execute(
        sql`select paid_order_id,active,wave_intent_id from experts_published where user_id=${row.userId}::uuid`,
      )
    ).rows[0],
  ).toEqual({ paid_order_id: row.id, active: true, wave_intent_id: null });
  const postsBeforeReplay = (await providerStats()).posts.length;
  await runtime.recovery.recover(request.id);
  expect((await providerStats()).posts).toHaveLength(postsBeforeReplay);
  // Advance the actual disposable PG/Node/provider clock to the final six days.
  // Captured settlement and the full 90-day coverage remain immutable.
  await clock.advance(84 * 86400);
  await provider.command({ op: "offset", seconds: clock.offsetSeconds });
  await database.db.execute(
    sql`update expert_residency_tariff_versions set active_to=clock_timestamp() where id=${row.tariff}::uuid`,
  );
  const scope = {
    botId: "818181",
    botKey: "sales-work",
    telegramUserId: "777001",
    chatId: "777001",
  };
  const { PostgresExpertPersonalOfferRepository } =
    await import("../../../../packages/db/src/repositories/expert-personal-offer-repository.js");
  const { renderPersonalOffer } = await import("@ii-tonya/application");
  const readout = await new PostgresExpertPersonalOfferRepository(database.db, {
    workBotId: scope.botId,
    workBotKey: scope.botKey,
    messagingConsentPolicyVersion: "client-messaging-v1",
  }).read(scope);
  expect(readout).toMatchObject({
    selected_locked_total: "1528470",
    selected_locked_term: 3,
  });
  expect(renderPersonalOffer(readout!)).toContain("15 284,70 ₽ за 3 мес.");
  const lifecycle = new PostgresExpertResidencyLifecycleRepository(
    database.db,
    {
      workBotId: scope.botId,
      workBotKey: scope.botKey,
      messagingConsentPolicyVersion: "client-messaging-v1",
    },
  );
  await lifecycle.processLifecycleBatch(10);
  const state = await lifecycle.readLifecycle(scope);
  expect(state?.bill).toMatchObject({ termMonths: 3 });
  const bill = state!.bill!;
  expect(
    (
      await database.db.execute(
        sql`select q.price_minor::text price,q.term_months term from expert_residency_renewal_bills b join expert_campaign_quotes q on q.id=b.quote_id where b.id=${bill.id}::uuid`,
      )
    ).rows[0],
  ).toEqual({ price: "1528470", term: 3 });
  const revision = (
    await database.db.execute<{ revision: number }>(
      sql`select revision from expert_card_drafts where user_id=${row.userId}::uuid`,
    )
  ).rows[0]!.revision;
  let sequence = 9000;
  const event = () => {
    const requestKey = `${scope.botId}:${++sequence}`;
    return {
      ...scope,
      requestKey,
      requestDigest: createHash("sha256").update(requestKey).digest("hex"),
      revision,
      renewalBillId: bill.id,
    };
  };
  const financial = new PostgresExpertOnboardingMainPaymentRepository(
    database.db,
    {
      providerMode: "test",
      messagingConsentPolicyVersion: "client-messaging-v1",
    },
  );
  const quote = await financial.quoteMain({
    ...event(),
    tariffVersionId: row.tariff,
    termMonths: 3,
  });
  expect(quote.priceMinor).toBe("1528470");
  await financial.acceptMain({ ...event(), quoteId: quote.id });
  const renewed = await financial.createMainInvoice(event());
  expect(
    (
      await database.db.execute(
        sql`select price_minor::text price,campaign_term_months term from expert_residency_orders where id=${renewed.orderId}::uuid`,
      )
    ).rows[0],
  ).toEqual({ price: "1528470", term: 3 });
}, 120000);
