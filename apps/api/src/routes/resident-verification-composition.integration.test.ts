import Fastify from "fastify";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../../../../packages/db/src/testkit/expert-referral.js";
import { seedClientConsent } from "../../../../packages/db/src/testkit/client-consent.js";
import {
  createExpertApplicantComposition,
  assertExpertApplicantCapability,
} from "../expert-applicant-composition.js";
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
it("remediation: real Fastify composition enrolls original consent, persists returned role callback and keeps flag-off pricing fenced", async () => {
  const config = loadEnv({
    DATABASE_URL: "postgresql://synthetic:synthetic@localhost/fixture",
    ALLOW_INSECURE_LOCAL_DATABASE: "true",
    EXPERT_APPLICANT_ENABLED: "true",
    EXPERT_VERIFICATION_FORM_ENABLED: "true",
    EXPERT_PROMO_TELEGRAM_BOT_ID: "717171",
    EXPERT_PROMO_TELEGRAM_BOT_KEY: "resident-promo",
    EXPERT_PROMO_TELEGRAM_WEBHOOK_SECRET:
      "synthetic_resident_secret_1234567890",
    EXPERT_PROMO_MESSAGING_CONSENT_POLICY_VERSION: "client-messaging-v1",
  });
  const capability = createExpertApplicantComposition(database.db, config)!;
  assertExpertApplicantCapability(config, capability);
  const app = Fastify({ logger: false });
  await app.register(expertApplicantTelegramRoutes, {
    enabled: true,
    capability,
  });
  let updateId = 1;
  const telegramUserId = 777333;
  const post = (text: string) =>
    app.inject({
      method: "POST",
      url: "/v1/webhooks/telegram/expert-promo/resident-promo",
      headers: {
        "x-telegram-bot-api-secret-token":
          config.expertApplicant!.webhookSecret,
      },
      payload: {
        update_id: updateId++,
        message: {
          from: { id: telegramUserId },
          chat: { id: telegramUserId, type: "private" },
          text,
        },
      },
    });
  const presented = await post("/start");
  expect(presented.statusCode).toBe(200);
  const token = /\/consent ([A-Za-z0-9_-]{43}) granted/u.exec(
    presented.json().text,
  )?.[1];
  expect(token).toBeDefined();
  expect((await post(`/consent ${token} granted`)).statusCode).toBe(200);
  const start = await post("/start");
  expect(start.statusCode).toBe(200);
  const button = start
    .json()
    .reply_markup.inline_keyboard.flat()
    .find((b: { callback_data: string }) =>
      b.callback_data.endsWith(":r:EXPERT"),
    );
  expect(button).toBeDefined();
  expect(button.text).toBe("Эксперт");
  const callback = {
    update_id: updateId++,
    callback_query: {
      id: "synthetic-query",
      from: { id: telegramUserId },
      message: {
        from: { id: 717171, is_bot: true },
        chat: { id: telegramUserId, type: "private" },
      },
      data: button.callback_data,
    },
  };
  const invoke = () =>
    app.inject({
      method: "POST",
      url: "/v1/webhooks/telegram/expert-promo/resident-promo",
      headers: {
        "x-telegram-bot-api-secret-token":
          config.expertApplicant!.webhookSecret,
      },
      payload: callback,
    });
  expect((await invoke()).statusCode).toBe(200);
  expect((await invoke()).statusCode).toBe(200);
  const state = (
    await database.db.execute(
      sql`select a.user_id,a.draft,en.status as enrollment,ci.external_id,(select count(*)::int from expert_campaign_anchors where user_id=a.user_id) anchors,(select count(*)::int from expert_campaign_quotes where user_id=a.user_id) quotes,(select count(*)::int from expert_onboarding_invoices where user_id=a.user_id) invoices from residents_applications a join channel_identities ci on ci.id=a.channel_identity_id and ci.user_id=a.user_id join expert_promo_enrollments en on en.user_id=a.user_id where ci.external_id=${String(telegramUserId)}`,
    )
  ).rows[0]!;
  expect(state).toMatchObject({
    draft: { roles: ["EXPERT"] },
    enrollment: "granted",
    external_id: String(telegramUserId),
    anchors: 0,
    quotes: 0,
    invoices: 0,
  });
  await app.close();
  const offConfig = {
    ...config,
    features: {
      ...config.features,
      expertApplicant: true,
      expertVerificationForm: false,
    },
  };
  const off = createExpertApplicantComposition(database.db, offConfig)!;
  assertExpertApplicantCapability(offConfig, off);
  const second = Fastify({ logger: false });
  await second.register(expertApplicantTelegramRoutes, {
    enabled: true,
    capability: off,
  });
  for (const text of ["/tariffs", "/my_tariff", "/start"]) {
    const response = await second.inject({
      method: "POST",
      url: "/v1/webhooks/telegram/expert-promo/resident-promo",
      headers: {
        "x-telegram-bot-api-secret-token":
          config.expertApplicant!.webhookSecret,
      },
      payload: {
        update_id: updateId++,
        message: {
          from: { id: telegramUserId },
          chat: { id: telegramUserId, type: "private" },
          text,
        },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().text).toContain("провер");
    expect(response.json().text).not.toContain("Тарифы: /tariffs");
    expect(response.json().reply_markup).toEqual({ remove_keyboard: true });
  }
  await second.close();
});
