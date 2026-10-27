import Fastify from "fastify";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
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
beforeAll(async () => {
  database = await startExpertReferralTestDatabase();
  await seedClientConsent(
    database.db,
    await database.createUser(),
    "client_messaging",
  );
}, 120000);
afterAll(async () => {
  await database?.stop();
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
    EXPERT_PROMO_TELEGRAM_WEBHOOK_SECRET: "synthetic_sales_secret_1234567890",
    EXPERT_PROMO_MESSAGING_CONSENT_POLICY_VERSION: "client-messaging-v1",
  });
  const { createPayerReceiptVault } = await import("@ii-tonya/integrations");
  const vault = createPayerReceiptVault({
    activeKeyId: "fixture",
    keys: new Map([["fixture", new Uint8Array(32).fill(7)]]),
  });
  let activeCheckout:
    import("@ii-tonya/db").PostgresHeldOnboardingCheckout | undefined;
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
    expect(beforeApproval.text).not.toContain("https://yookassa");
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
    const { PostgresHeldOnboardingCheckout } =
      await import("../../../../packages/db/src/repositories/expert-held-onboarding-repository.js");
    const { startHeldOnboardingLocal } =
      await import("../../../../tests/support/held-onboarding-local.js");
    const local = await startHeldOnboardingLocal();
    try {
      const source = (
        await database.db.execute<{
          userId: string;
          quoteId: string;
          operationId: string;
        }>(
          sql`select i.user_id as "userId",b.quote_id as "quoteId",o.id as "operationId" from expert_onboarding_invoices i join expert_sales_form_bridges b on b.application_id=i.application_id join expert_onboarding_payment_operations o on o.invoice_id=i.id where i.id=${decision.invoiceId}::uuid`,
        )
      ).rows[0]!;
      const checkout = new PostgresHeldOnboardingCheckout(database.db, {
        enabled: true,
        client: local.client,
        vault,
        protector: local.protector,
        decryptor: local.decryptor,
        repository: repo,
        returnUrl: "https://example.com/return",
        vatCode: 1,
        mode: "test",
      });
      activeCheckout = checkout;
      const currentTariff = await send("", "st:current");
      expect(currentTariff.text).toContain("15284,70 ₽");
      expect(currentTariff.text).toContain("Срок:");
      expect(currentTariff.text).toContain("осталось");
      expect(currentTariff.text).toContain("3000 ₽: https://yookassa.ru/");
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
        local.requests.filter(
          (r) => r.method === "POST" && r.path === "/v3/payments",
        ),
      ).toHaveLength(1);
      expect(local.requests[0]?.body).toMatchObject({
        capture: false,
        payment_method_data: { type: "bank_card" },
      });
      const persisted = (
        await database.db.execute<{ encrypted: string; body: string | null }>(
          sql`select encrypted_body encrypted,request_body body from expert_sales_provider_requests where invoice_id=${decision.invoiceId}::uuid and kind='create'`,
        )
      ).rows[0]!;
      expect(persisted.body).toBeNull();
      expect(persisted.encrypted).not.toContain("synthetic@example.com");
      local.waiting();
      await checkout.reconcile(decision.invoiceId!);
      expect(
        local.requests.filter(
          (r) => r.method === "POST" && r.path.endsWith("/capture"),
        ),
      ).toHaveLength(1);
      expect(
        (
          await database.db.execute(
            sql`select count(*)::int n from expert_sales_provider_observations where status='waiting_for_capture'`,
          )
        ).rows[0]?.n,
      ).toBe(1);
    } finally {
      await local.stop();
    }
  } finally {
    await app.close();
  }
}, 120000);

it("authoritative fee success locks only selected quarter; later quote sources preserve terms and wrong periods are denied", async () => {
  const { createYooKassaClient, YooKassaOnboardingPaymentVerifier } =
    await import("@ii-tonya/integrations");
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
  await repo.bindPayment(row.invoice, {
    id: row.operation,
    providerObjectId: "sales_payment_1",
    userId: row.userId,
    purpose: "onboarding",
    amountMinor: "300000",
    currency: "RUB",
    mode: "test",
  });
  const binding = await repo.findOnboardingPaymentBinding(row.invoice);
  expect(binding).not.toBeNull();
  const capturedAt = new Date().toISOString();
  const createdAt = new Date(Date.now() - 100).toISOString();
  const client = createYooKassaClient(
    { mode: "test", shopId: "test-shop", secretKey: "synthetic-only" },
    async () =>
      new Response(
        JSON.stringify({
          id: "sales_payment_1",
          status: "succeeded",
          paid: true,
          amount: { value: "3000.00", currency: "RUB" },
          test: true,
          created_at: createdAt,
          captured_at: capturedAt,
          metadata: {
            order_id: row.invoice,
            user_id: row.userId,
            operation_id: row.operation,
            purpose: "onboarding",
          },
          refundable: true,
        }),
        { status: 200 },
      ),
  );
  const proof = await new YooKassaOnboardingPaymentVerifier(
    client,
    repo,
  ).verify(row.invoice);
  expect(proof).not.toBeNull();
  const settlements = await Promise.all([
    repo.settleVerified(proof!),
    repo.settleVerified(proof!),
  ]);
  expect(settlements.map((s) => s.replay).sort()).toEqual([false, true]);
  const { createExpertVerificationComposition } =
    await import("../expert-verification-composition.js");
  const { yookassaWebhookRoutes } = await import("./yookassa-webhook.js");
  const { PostgresWebhookInboxRepository } =
    await import("../../../../packages/db/src/repositories/webhook-inbox-repository.js");
  const config = loadEnv({
    DATABASE_URL: "postgresql://synthetic:synthetic@localhost/fixture",
    ALLOW_INSECURE_LOCAL_DATABASE: "true",
    EXPERT_VERIFICATION_ENABLED: "true",
    EXPERT_VERIFICATION_PAYMENT_VERIFICATION_ENABLED: "true",
    EXPERT_VERIFICATION_PAYMENT_MODE: "test",
    EXPERT_VERIFICATION_MESSAGING_CONSENT_POLICY_VERSION: "client-messaging-v1",
  });
  const composition = createExpertVerificationComposition(database.db, config, {
    providerMode: "test",
    paymentVerification: { authoritativeGet: true, client },
  })!;
  const app = Fastify({ logger: false });
  await app.register(yookassaWebhookRoutes, {
    effectivePeerAddress: () => "185.71.76.1",
    inbox: new PostgresWebhookInboxRepository(database.db),
    resolvePurpose: async (id) =>
      (await repo.findOnboardingInvoiceByProviderObjectId(id))
        ? "ONBOARDING_FEE"
        : null,
    onboarding: composition.onboardingWebhook!,
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
              object: { id: "sales_payment_1" },
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
}, 120000);

it("automatic bill and explicit renewal preserve the locked quarter after the original tariff closes", async () => {
  const { PostgresYooKassaOperationRepository } =
    await import("../../../../packages/db/src/repositories/yookassa-operation-repository.js");
  const { PostgresExpertResidencyProviderInboxRepository } =
    await import("../../../../packages/db/src/repositories/expert-residency-provider-inbox-repository.js");
  const { PostgresExpertResidencyLifecycleRepository } =
    await import("../../../../packages/db/src/repositories/expert-residency-lifecycle-repository.js");
  const { PostgresExpertOnboardingMainPaymentRepository } =
    await import("../../../../packages/db/src/repositories/expert-onboarding-main-payment-repository.js");
  const { createYooKassaClient, YooKassaPaymentVerifier } =
    await import("@ii-tonya/integrations");
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
  const operations = new PostgresYooKassaOperationRepository(database.db);
  const claim = await operations.claim({
    commandId: randomUUID(),
    orderId: row.id,
    kind: "create_payment",
    mode: "test",
    amountMinor: row.cash,
    currency: "RUB",
    requestDigest: `sha256:${createHash("sha256").update(row.id).digest("hex")}`,
  });
  const paymentId = `main_${randomUUID()}`;
  const operation = await operations.bindProviderObject(claim.id, paymentId);
  const amount = BigInt(row.cash);
  const client = createYooKassaClient(
    { mode: "test", shopId: "test-shop", secretKey: "synthetic-fixture-only" },
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
          metadata: { order_id: row.id },
          refundable: true,
        }),
        { status: 200 },
      ),
  );
  const proof = await new YooKassaPaymentVerifier(
    client,
    operations,
  ).verifyPayment(operation);
  expect(proof).not.toBeNull();
  await new PostgresExpertResidencyProviderInboxRepository(database.db).settle(
    proof!,
  );
  // Calendar fixture advances this paid cycle to its final six days. The full
  // 90-day duration and all production source/settlement triggers stay enabled.
  await database.db.execute(
    sql`update expert_residency_orders set settled_at=settled_at-interval '84 days',residency_starts_at=residency_starts_at-interval '84 days',residency_ends_at=residency_ends_at-interval '84 days' where id=${row.id}::uuid`,
  );
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
