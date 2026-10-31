import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../testkit/expert-referral.js";
import { seedClientConsent } from "../testkit/client-consent.js";
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
it("routes only a scoped active consenting legacy user and excludes wave snapshots", async () => {
  const user = await db.createUser();
  await seedClientConsent(db.db, user, "client_messaging");
  const identity = (
    await db.db.execute<{ id: string }>(
      sql`insert into channel_identities(user_id,provider,external_id,bot_key,external_chat_id) values(${user}::uuid,'telegram','123456','legacy-bot','123456') returning id`,
    )
  ).rows[0]!.id;
  await db.db.execute(
    sql`insert into residents_applications(user_id,bot_id,bot_key,channel_identity_id,telegram_user_id,chat_id) values(${user}::uuid,'1','legacy-bot',${identity}::uuid,'123456','123456')`,
  );
  const repo = new PostgresEarlyBirdLegacyRouting(db.db, {
    botId: "1",
    botKey: "legacy-bot",
    messagingConsentPolicyVersion: "client-messaging-v1",
  });
  const input = {
    botId: "1",
    botKey: "legacy-bot",
    telegramUserId: "123456",
    chatId: "123456",
  };
  expect(await repo.eligible(input)).toBe(true);
  expect(await repo.eligible({ ...input, chatId: "999" })).toBe(false);
  const tariff = await db.createResidencyTariff({
    tariffKey: "PRO",
    displayName: "PRO",
    priceMinor: 1000000,
    durationSeconds: 2592000,
  });
  await db.db.execute(
    sql`insert into expert_offer_profiles(user_id,revision,city_code,million_city,service_format,ticket_minor,participant_kind,idempotency_key) values(${user}::uuid,1,'fixture',false,'offline',300000,'expert','legacy-profile')`,
  );
  const base = randomUUID(),
    positive = randomUUID();
  await db.db.execute(
    sql`insert into expert_sales_bases(id,user_id,tariff_version_id,profile_revision,base_tariff_amount,participant_kind,bot_id,bot_key,chat_id,consent_version) select ${base}::uuid,${user}::uuid,t.id,1,greatest(500000,t.price_minor),'expert','1','legacy-bot','123456','client-messaging-v1' from expert_residency_tariff_versions t where t.id=${tariff}::uuid`,
  );
  await db.db.execute(
    sql`insert into expert_sales_choices(id,base_id,user_id,revision,action,request_key,request_digest) values(${positive}::uuid,${base}::uuid,${user}::uuid,1,'positive','legacy-positive',${"a".repeat(64)})`,
  );
  await db.db.execute(
    sql`insert into early_bird_positive_price_snapshots(positive_choice_id,user_id,base_id,grant_id) values(${positive}::uuid,${user}::uuid,${base}::uuid,null)`,
  );
  expect(await repo.eligible(input)).toBe(false);
}, 120000);
