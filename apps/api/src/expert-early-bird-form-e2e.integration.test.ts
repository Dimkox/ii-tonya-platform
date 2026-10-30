import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { PostgresResidentReviewRepository } from "../../../packages/db/src/repositories/resident-review-repository.js";
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
it("opens and submits a wave qualification form without fabricating a legacy sales bridge", async () => {
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
    const button = ready.reply_markup.inline_keyboard
      .flat()
      .find((v: { callback_data: string }) =>
        v.callback_data.endsWith(":submit"),
      );
    expect(button).toBeDefined();
    const submitted = await send("", button.callback_data);
    expect(submitted.text).toContain("Анкета получена");
    const reviewRow = (
      await database.db.execute<{
        applicationId: string;
        revision: number;
        generation: number;
      }>(
        sql`select b.application_id as "applicationId",f.revision,f.check_generation as generation from early_bird_form_bridges b join residents_applications f on f.id=b.form_id`,
      )
    ).rows[0]!;
    const manager = await database.createUser();
    const session = `wave-review-${randomUUID()}`;
    await database.db.execute(
      sql`insert into admin_sessions(session_id_hash,admin_id,mfa_verified_at,expires_at) values(${session},${manager}::uuid,clock_timestamp(),clock_timestamp()+interval '1 hour')`,
    );
    await database.db.execute(
      sql`insert into admin_role_assignments(admin_id,role) values(${manager}::uuid,'support')`,
    );
    const review = new PostgresResidentReviewRepository(database.db, {
      providerMode: "test",
      messagingConsentPolicyVersion: "client-messaging-v1",
      earlyBirdReview: true,
    });
    const preview = await review.preview(session, {
      applicationId: reviewRow.applicationId,
      key: "REJECT_NICHE_MISMATCH",
      expectedRevision: reviewRow.revision,
      expectedGeneration: reviewRow.generation,
    });
    expect(
      (
        await review.confirm(
          session,
          reviewRow.applicationId,
          preview.previewId,
          preview.hash,
        )
      ).action,
    ).toBe("REJECT_SOFT");
    // Isolated test clock makes the reapplication deadline due without waiting a month.
    await database.db.execute(
      sql`create or replace function resident_reapply_eligible(deadline timestamptz,at_time timestamptz) returns boolean language sql immutable strict as $$ select true $$`,
    );
    const reapplied = await send("/reapply");
    expect(reapplied.text).toContain("рол");
    expect(
      (
        await database.db.execute(
          sql`select count(*)::int n from early_bird_form_enrollments`,
        )
      ).rows[0]?.n,
    ).toBe(2);
    expect(
      (
        await database.db.execute(
          sql`select count(*)::int n from early_bird_form_bridges`,
        )
      ).rows[0]?.n,
    ).toBe(1);
    expect(
      (
        await database.db.execute(
          sql`select count(*)::int n from expert_sales_form_bridges`,
        )
      ).rows[0]?.n,
    ).toBe(0);
    expect(
      (
        await database.db.execute(
          sql`select count(*)::int n from expert_onboarding_invoices`,
        )
      ).rows[0]?.n,
    ).toBe(0);
  } finally {
    await app.close();
  }
}, 120000);

it("continues a scoped legacy qualification while the wave is active", async () => {
  await database.db.execute(
    sql`update early_bird_launch_configs set active=false where active`,
  );
  await database.db.execute(
    sql`insert into early_bird_launch_configs(phase,enrollment_start_at,client_start_at,promo_deadline_days,final_call_trigger_at) values ('WAVE_1_EARLY_BIRD','2026-11-01 00:00:00+03','2027-01-11 00:00:00+03',10,'2026-12-28 10:00:00+03')`,
  );
  await database.db.execute(
    sql.raw(
      "CREATE OR REPLACE FUNCTION early_bird_current_time() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$ SELECT '2026-11-10 00:00:00+00'::timestamptz $$",
    ),
  );
  const tariff = (
    await database.db.execute<{ id: string }>(
      sql`select id from expert_residency_tariff_versions where tariff_key='PRO' and commercial_policy_version='expert_residency_v2' and active_from<=clock_timestamp() and active_to>clock_timestamp() order by id limit 1`,
    )
  ).rows[0]!.id;
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
  const legacy = Fastify();
  const waveApp = Fastify();
  const clientStartMs = Date.parse("2027-01-11T00:00:00+03:00"),
    enrollmentStartMs = Date.parse("2026-11-01T00:00:00+03:00");
  const wave = createExpertEarlyBirdService(
    createPostgresEarlyBirdAuthority(
      database.db,
      config.expertApplicant!,
      clientStartMs,
      enrollmentStartMs,
    ),
    {
      phase: "WAVE_1_EARLY_BIRD",
      enrollmentStartMs,
      clientStartMs,
      now: () => Date.parse("2026-11-10T00:00:00Z"),
    },
  );
  await legacy.register(expertApplicantTelegramRoutes, {
    enabled: true,
    capability: createExpertApplicantComposition(database.db, config)!,
  });
  await waveApp.register(expertApplicantTelegramRoutes, {
    enabled: true,
    capability: createExpertApplicantComposition(database.db, config, {
      wave,
    })!,
  });
  let update = 100;
  const send = async (app: typeof legacy, text: string, callback?: string) => {
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
                id: "legacy",
                from: { id: 777002 },
                message: {
                  from: { id: 717171, is_bot: true },
                  chat: { id: 777002, type: "private" },
                },
                data: callback,
              },
            }
          : {
              message: {
                from: { id: 777002 },
                chat: { id: 777002, type: "private" },
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
    const button = view.reply_markup.inline_keyboard
      .flat()
      .find((v) => v.callback_data.endsWith(suffix));
    expect(button).toBeDefined();
    return send(legacy, "", button!.callback_data);
  };
  try {
    const consent = await send(legacy, "/start");
    const token = /\/consent ([A-Za-z0-9_-]+) granted/u.exec(consent.text)![1];
    await send(legacy, `/consent ${token} granted`);
    await send(legacy, "/start");
    await send(legacy, "/profile kazan 0 offline 300000 expert");
    const base = await send(legacy, "", `sb:${tariff}`);
    const promo = await click(base, ":positive");
    const period = await click(promo, ":promo");
    const opened = await click(period, ":month");
    expect(opened.text).toContain("рол");
    const continued = await send(waveApp, "/set roles EXPERT");
    expect(continued.text).not.toContain("недоступ");
    const rows = await database.db.execute<{ count: number }>(
      sql`select count(*)::int as count from residents_applications f join channel_identities c on c.user_id=f.user_id where c.bot_key='sales-fixture' and c.external_id='777002' and f.draft->'roles' ? 'EXPERT'`,
    );
    expect(rows.rows[0]?.count).toBe(1);
  } finally {
    await legacy.close();
    await waveApp.close();
  }
}, 120000);
