import Fastify from "fastify";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { loadEnv } from "@ii-tonya/config";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../../../packages/db/src/testkit/expert-referral.js";
import { seedClientConsent } from "../../../packages/db/src/testkit/client-consent.js";
import { ownerPricingApproval } from "../../../packages/db/src/testkit/owner-pricing-approval.js";
import { createExpertApplicantComposition } from "./expert-applicant-composition.js";
import { expertApplicantTelegramRoutes } from "./routes/expert-applicant-telegram.js";
import { createPostgresEarlyBirdAuthority } from "./expert-early-bird-authority.js";
import { createExpertEarlyBirdService } from "./expert-early-bird-service.js";
const SYNTHETIC_FIXTURE_VALUE_1 = "synthetic_sales_secret_1234567890";

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
it("rejects a displayed price if the grant changes before consent", async () => {
  // Disposable test database only: simulate the enrollment period, which begins after the host date.
  await database.db.execute(
    sql.raw(
      "CREATE OR REPLACE FUNCTION early_bird_current_time() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$ SELECT '2026-11-10 00:00:00+00'::timestamptz $$",
    ),
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
    EXPERT_PROMO_TELEGRAM_WEBHOOK_SECRET: SYNTHETIC_FIXTURE_VALUE_1,
    EXPERT_PROMO_MESSAGING_CONSENT_POLICY_VERSION: "client-messaging-v1",
  });
  const startMs = Date.parse("2027-01-11T00:00:00+03:00");
  const enrollmentStartMs = Date.parse("2026-11-01T00:00:00+03:00");
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
      now: () => Date.parse("2026-11-10T00:00:00Z"),
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
                from: { id: 777001, first_name: "Анна" },
                message: {
                  from: { id: 717171, is_bot: true },
                  chat: { id: 777001, type: "private" },
                },
                data: callback,
              },
            }
          : {
              message: {
                from: { id: 777001, first_name: "Анна" },
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
    await database.db.execute(
      sql`update early_bird_launch_configs set active=false where active`,
    );
    await database.db.execute(
      sql`insert into early_bird_launch_configs(phase,enrollment_start_at,client_start_at,promo_deadline_days,final_call_trigger_at) values ('WAVE_1_EARLY_BIRD','2026-11-01 00:00:00+03','2027-01-11 00:00:00+03',10,'2026-12-28 10:00:00+03')`,
    );
    const before = await send("", `sb:${tariff}`);
    expect(before.text).toContain("9990 ₽");
    const oldStandardButton =
      before.reply_markup.inline_keyboard[0][0].callback_data;
    const user = (
      await database.db.execute<{ id: string }>(
        sql`select user_id as id from channel_identities where external_id='777001' and bot_key='sales-fixture'`,
      )
    ).rows[0]!.id;
    const admin = await database.createUser();
    await database.db.execute(
      sql`insert into admin_role_assignments(admin_id,role) values(${admin}::uuid,'security_admin')`,
    );
    await database.db.execute(
      sql`insert into admin_sessions(session_id_hash,admin_id,mfa_verified_at,expires_at) values('wave-owner-test-session',${admin}::uuid,clock_timestamp()-interval '3 minutes',clock_timestamp()+interval '1 hour')`,
    );
    const approval = await ownerPricingApproval(database, {
      action: "grant",
      target: user,
      adminId: admin,
      sessionIdHash: "wave-owner-test-session",
    });
    const grant = (
      await database.db.execute<{ id: string }>(
        sql`insert into owner_test_pricing_grants(user_id,granted_by,grant_session_hash,grant_approval_id) values(${user}::uuid,${admin}::uuid,'wave-owner-test-session',${approval}::uuid) returning id`,
      )
    ).rows[0]!.id;
    const oldStandard = await send("", oldStandardButton);
    expect(oldStandard.text).toContain("измен");
    const owner = await send("", `sb:${tariff}`);
    expect(owner.text).toContain("20 ₽");
    expect(owner.text).toContain("10 ₽");
    expect(owner.text).not.toContain("9990 ₽");
    const oldGrantButton =
      owner.reply_markup.inline_keyboard[0][0].callback_data;
    const revoke = await ownerPricingApproval(database, {
      action: "revoke",
      target: grant,
      adminId: admin,
      sessionIdHash: "wave-owner-test-session",
    });
    await database.db.execute(
      sql`update owner_test_pricing_grants set revoked_at=clock_timestamp(),revoked_by=${admin}::uuid,revoke_session_hash='wave-owner-test-session',revoke_approval_id=${revoke}::uuid where id=${grant}::uuid`,
    );
    const oldGrant = await send("", oldGrantButton);
    expect(oldGrant.text).toContain("измен");
    const secondApproval = await ownerPricingApproval(database, {
      action: "grant",
      target: user,
      adminId: admin,
      sessionIdHash: "wave-owner-test-session",
    });
    const secondGrant = (
      await database.db.execute<{ id: string }>(
        sql`insert into owner_test_pricing_grants(user_id,granted_by,grant_session_hash,grant_approval_id) values(${user}::uuid,${admin}::uuid,'wave-owner-test-session',${secondApproval}::uuid) returning id`,
      )
    ).rows[0]!.id;
    expect(secondGrant).not.toBe(grant);
    const oldAfterRegrant = await send("", oldGrantButton);
    expect(oldAfterRegrant.text).toContain("измен");
    const secondRevoke = await ownerPricingApproval(database, {
      action: "revoke",
      target: secondGrant,
      adminId: admin,
      sessionIdHash: "wave-owner-test-session",
    });
    await database.db.execute(
      sql`update owner_test_pricing_grants set revoked_at=clock_timestamp(),revoked_by=${admin}::uuid,revoke_session_hash='wave-owner-test-session',revoke_approval_id=${secondRevoke}::uuid where id=${secondGrant}::uuid`,
    );
    const after = await send("", `sb:${tariff}`);
    expect(after.text).toContain("9990 ₽");
    const accepted = await send(
      "",
      after.reply_markup.inline_keyboard[0][0].callback_data,
    );
    expect(accepted.text).toContain("Первые Птички");
    expect(
      (
        await database.db.execute(
          sql`select count(*)::int n from expert_sales_choices where action='positive'`,
        )
      ).rows[0]?.n,
    ).toBe(1);
  } finally {
    await app.close();
  }
}, 120000);
