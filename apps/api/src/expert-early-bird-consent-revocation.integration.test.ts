import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { PostgresPrivacyRepository } from "../../../packages/db/src/repositories/privacy-repository.js";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { loadEnv } from "@ii-tonya/config";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../../../packages/db/src/testkit/expert-referral.js";
import { seedClientConsent } from "../../../packages/db/src/testkit/client-consent.js";
import { createExpertApplicantComposition } from "./expert-applicant-composition.js";
import { expertApplicantTelegramRoutes } from "./routes/expert-applicant-telegram.js";
import { createPostgresEarlyBirdAuthority } from "./expert-early-bird-authority.js";
import { createExpertEarlyBirdService } from "./expert-early-bird-service.js";
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
it("rejects continuation and retry after messaging consent is withdrawn", async () => {
  // Disposable test database only: simulate the enrollment period, which begins after the host date.
  await database.db.execute(
    sql.raw(
      "CREATE OR REPLACE FUNCTION early_bird_current_time() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$ SELECT '2026-11-10 00:00:00+00'::timestamptz $$",
    ),
  );
  // The migration seeds PUBLIC; this disposable fixture explicitly enables wave one.
  await database.db.execute(
    sql`update early_bird_launch_configs set active=false where active`,
  );
  await database.db.execute(
    sql`insert into early_bird_launch_configs(phase,enrollment_start_at,client_start_at,promo_deadline_days,final_call_trigger_at) values ('WAVE_1_EARLY_BIRD','2026-11-01 00:00:00+03','2027-01-11 00:00:00+03',10,'2026-12-28 10:00:00+03')`,
  );
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
  const startMs = Date.parse("2027-01-11T00:00:00+03:00");
  const enrollmentStartMs = Date.parse("2026-11-01T00:00:00+03:00");
  let uiNowMs = Date.parse("2026-11-10T00:00:00Z");
  const wave = createExpertEarlyBirdService(
    createPostgresEarlyBirdAuthority(
      database.db,
      config.expertApplicant!,
      startMs,
      enrollmentStartMs,
    ),
    {
      phase: "WAVE_1_EARLY_BIRD",
      enrollmentStartMs,
      clientStartMs: startMs,
      now: () => uiNowMs,
    },
  );
  const app = Fastify();
  await app.register(expertApplicantTelegramRoutes, {
    enabled: true,
    capability: createExpertApplicantComposition(database.db, config, {
      wave,
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
  try {
    const consent = await send("/start");
    const token = /\/consent ([A-Za-z0-9_-]+) granted/u.exec(consent.text)![1];
    await send(`/consent ${token} granted`);
    await send("/start");
    await send("/profile kazan 0 offline 300000 expert");
    const base = await send("", `sb:${tariff}`);
    const positive = base.reply_markup.inline_keyboard[0][0].callback_data;
    const terms = await send("", positive);
    expect(terms.text).toContain("Первые Птички");
    const now = terms.reply_markup.inline_keyboard[0][0].callback_data;
    const opened = await send("", now);
    expect(opened.text).toContain("рол");
    await send("/set roles EXPERT");
    // An already admitted qualification may continue after launch, without publishing or charging.
    await database.db.execute(
      sql`update early_bird_launch_configs set active=false where active`,
    );
    await database.db.execute(
      sql`insert into early_bird_launch_configs(phase,enrollment_start_at,client_start_at,promo_deadline_days,final_call_trigger_at) values ('PUBLIC_LAUNCH','2026-11-01 00:00:00+03','2027-01-11 00:00:00+03',10,'2026-12-28 10:00:00+03')`,
    );
    await database.db.execute(
      sql.raw(
        "CREATE OR REPLACE FUNCTION early_bird_current_time() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$ SELECT '2027-01-12 00:00:00+00'::timestamptz $$",
      ),
    );
    uiNowMs = Date.parse("2027-01-12T00:00:00Z");
    const user = (
      await database.db.execute<{ id: string }>(
        sql`select user_id as id from channel_identities where bot_key='sales-fixture' and external_id='777001'`,
      )
    ).rows[0]!.id;
    expect(
      (
        await database.db.execute(
          sql`select count(*)::int n from residents_applications where user_id=${user}::uuid and is_current`,
        )
      ).rows[0]?.n,
    ).toBe(1);
    const privacy = new PostgresPrivacyRepository(database.db, {
      privacyMutationCapability: {
        enabled: true,
        captureManifests: async () => [],
        verifyEnvelope: () => true,
      },
    });
    await privacy.withdrawConsentAtomically({
      targetUserId: user,
      purpose: "client_messaging",
      policyVersion: "client-messaging-v1",
      correlationId: randomUUID(),
    });
    // Withdrawal is specified to erase the resident intake form.
    expect(
      (
        await database.db.execute(
          sql`select count(*)::int n from residents_applications where user_id=${user}::uuid`,
        )
      ).rows[0]?.n,
    ).toBe(0);
    const request = {
      method: "POST" as const,
      url: "/v1/webhooks/telegram/expert-promo/sales-fixture",
      headers: {
        "x-telegram-bot-api-secret-token":
          config.expertApplicant!.webhookSecret,
      },
      payload: {
        update_id: update++,
        message: {
          from: { id: 777001 },
          chat: { id: 777001, type: "private" },
          text: "/set primaryRole EXPERT",
        },
      },
    };
    const denied = await app.inject(request);
    expect(denied.statusCode).toBe(503);
    const replay = await app.inject(request);
    expect(replay.statusCode).toBe(503);
    expect(
      (
        await database.db.execute(
          sql`select count(*)::int n from residents_applications where user_id=${user}::uuid`,
        )
      ).rows[0]?.n,
    ).toBe(0);
  } finally {
    await app.close();
  }
}, 120000);
