import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { PostgresEarlyBirdChoiceRepository } from "./early-bird-choice-repository.js";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../testkit/expert-referral.js";

let db: ExpertReferralTestDatabase;
beforeAll(async () => {
  db = await startExpertReferralTestDatabase();
  await db.db.transaction(async (tx) => {
    await tx.execute(
      sql`update early_bird_launch_configs set active=false where active`,
    );
    await tx.execute(
      sql`insert into early_bird_launch_configs(phase,enrollment_start_at,client_start_at,promo_deadline_days,final_call_trigger_at) values ('WAVE_1_EARLY_BIRD','2026-11-01T00:00:00+03:00','2027-01-11T00:00:00+03:00',10,'2026-12-28T10:00:00+03:00')`,
    );
  });
  // A disposable DB runs the real phase logic against a deterministic launch-period clock.
  await db.db.execute(
    sql`create or replace function early_bird_current_time() returns timestamptz language sql volatile as $$ select '2026-11-02T00:00:00+03:00'::timestamptz $$`,
  );
}, 120_000);
afterAll(async () => {
  await db?.stop();
}, 120_000);
it("records authenticated choices idempotently and rejects replay conflicts or foreign identity", async () => {
  const { seedClientConsent } = await import("../testkit/client-consent.js");
  const user = await db.createUser();
  await seedClientConsent(db.db, user, "client_messaging");
  await db.db.execute(
    sql`insert into channel_identities(user_id,provider,external_id,bot_key,external_chat_id) values (${user}::uuid,'telegram','123456','fixture-bot','123456')`,
  );
  await db.db.execute(
    sql`insert into expert_offer_profiles(user_id,revision,city_code,million_city,service_format,ticket_minor,participant_kind,idempotency_key) values (${user}::uuid,1,'fixture',false,'offline',300000,'expert','fixture-profile')`,
  );
  const tariff = await db.createResidencyTariff({
    tariffKey: "PRO",
    displayName: "PRO",
    priceMinor: 1000000,
    durationSeconds: 2592000,
  });
  const base = randomUUID();
  await db.db.execute(
    sql`insert into expert_sales_bases(id,user_id,tariff_version_id,profile_revision,base_tariff_amount,participant_kind,bot_id,bot_key,chat_id,consent_version) select ${base}::uuid,${user}::uuid,t.id,1,greatest(500000,t.price_minor),'expert','1','fixture-bot','123456','client-messaging-v1' from expert_residency_tariff_versions t where t.id=${tariff}::uuid`,
  );
  const positive = randomUUID();
  await db.db.execute(
    sql`insert into expert_sales_choices(id,base_id,user_id,revision,action,request_key,request_digest) values (${positive}::uuid,${base}::uuid,${user}::uuid,1,'positive','positive-1',${"a".repeat(64)})`,
  );
  await db.db.execute(
    sql`insert into early_bird_positive_price_snapshots(positive_choice_id,user_id,base_id) values(${positive}::uuid,${user}::uuid,${base}::uuid)`,
  );
  const repo = new PostgresEarlyBirdChoiceRepository(db.db, {
    botId: "1",
    botKey: "fixture-bot",
    messagingConsentPolicyVersion: "client-messaging-v1",
  });
  const command = {
    botId: "1",
    botKey: "fixture-bot",
    telegramUserId: "123456",
    chatId: "123456",
    updateId: 123,
    offerId: base,
    revision: 1,
    choice: "now" as const,
  };
  const first = await repo.record(command);
  expect(first).toMatchObject({ choice: "now", replay: false });
  expect(await repo.record(command)).toEqual({ ...first, replay: true });
  await expect(repo.record({ ...command, choice: "later" })).rejects.toThrow();
  await expect(
    repo.record({
      ...command,
      telegramUserId: "654321",
      chatId: "654321",
      updateId: 124,
    }),
  ).rejects.toThrow();
}, 120_000);
