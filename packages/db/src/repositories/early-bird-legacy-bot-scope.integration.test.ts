import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../testkit/expert-referral.js";
import { seedClientConsent } from "../testkit/client-consent.js";
import { PostgresExpertSeparatedSalesRepository } from "./expert-separated-sales-repository.js";
import { PostgresEarlyBirdLegacyRouting } from "./early-bird-legacy-routing.js";
let db: ExpertReferralTestDatabase;
beforeAll(async () => {
  db = await startExpertReferralTestDatabase();
  await db.db.execute(
    sql`update early_bird_launch_configs set active=false where active`,
  );
  await db.db.execute(
    sql`insert into early_bird_launch_configs(phase,enrollment_start_at,client_start_at,promo_deadline_days,final_call_trigger_at) values ('WAVE_1_EARLY_BIRD','2026-11-01T00:00:00+03:00','2027-01-11T00:00:00+03:00',10,'2026-12-28T10:00:00+03:00')`,
  );
  await db.db.execute(
    sql`create or replace function early_bird_current_time() returns timestamptz language sql volatile as $$ select '2026-11-02T00:00:00+03:00'::timestamptz $$`,
  );
}, 120000);
afterAll(async () => {
  await db?.stop();
}, 120000);
it("does not treat a selection from another bot scope as legacy authority", async () => {
  const user = await db.createUser();
  await seedClientConsent(db.db, user, "client_messaging");
  await db.db.execute(
    sql`insert into channel_identities(user_id,provider,external_id,bot_key,external_chat_id) values(${user}::uuid,'telegram','123456','bot-one','123456'),(${user}::uuid,'telegram','123456','bot-two','123456')`,
  );
  await db.db.execute(
    sql`insert into expert_offer_profiles(user_id,revision,city_code,million_city,service_format,ticket_minor,participant_kind,idempotency_key) values(${user}::uuid,1,'fixture',false,'offline',300000,'expert','legacy-profile')`,
  );
  const tariff = await db.createResidencyTariff({
    tariffKey: "PRO",
    displayName: "PRO",
    priceMinor: 1000000,
    durationSeconds: 2592000,
  });
  const policy = {
    botId: "1",
    botKey: "bot-one",
    messagingConsentPolicyVersion: "client-messaging-v1",
  };
  const sales = new PostgresExpertSeparatedSalesRepository(db.db, policy);
  const scope = {
    botId: "1",
    botKey: "bot-one",
    telegramUserId: "123456",
    chatId: "123456",
  };
  const base = await sales.transition({
    ...scope,
    requestKey: "base",
    requestDigest: "a".repeat(64),
    tariffVersionId: tariff,
  });
  expect(base?.state).toBe("base");
  await sales.transition({
    ...scope,
    requestKey: "positive",
    requestDigest: "b".repeat(64),
    baseId: base!.id,
    revision: 0,
    action: "positive",
  });
  await sales.transition({
    ...scope,
    requestKey: "promo",
    requestDigest: "c".repeat(64),
    baseId: base!.id,
    revision: 1,
    action: "promo",
  });
  await sales.transition({
    ...scope,
    requestKey: "month",
    requestDigest: "d".repeat(64),
    baseId: base!.id,
    revision: 2,
    action: "month",
  });
  const own = new PostgresEarlyBirdLegacyRouting(db.db, policy);
  const other = new PostgresEarlyBirdLegacyRouting(db.db, {
    ...policy,
    botId: "2",
    botKey: "bot-two",
  });
  expect(await own.eligible(scope)).toBe(true);
  expect(
    await other.eligible({ ...scope, botId: "2", botKey: "bot-two" }),
  ).toBe(false);
}, 120000);
