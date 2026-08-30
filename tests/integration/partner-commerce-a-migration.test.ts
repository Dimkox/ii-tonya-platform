import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestPostgres, type TestDatabase } from "../../packages/db/src/testkit/postgres.js";

describe("partner commerce foundation migration", () => {
  let database: TestDatabase;
  beforeAll(async () => { database = await startTestPostgres(); await database.migrate(); });
  afterAll(async () => { await database.stop(); });

  it("enforces participant ownership, onboarding, and organization kind", async () => {
    const user = await database.createUser();
    const id = "00000000-0000-4000-8000-000000000071";
    await database.db.execute(sql`insert into commercial_participants (id,user_id,participant_kind,onboarding_state) values (${id}::uuid,${user}::uuid,'CENTER','started')`);
    await expect(database.db.execute(sql`insert into commercial_participants (id,user_id,participant_kind,onboarding_state) values ('00000000-0000-4000-8000-000000000072'::uuid,${user}::uuid,'CENTER','started')`)).rejects.toSatisfy((error: { cause?: { code?: string } }) => error.cause?.code === "23505");
    await expect(database.db.execute(sql`insert into commercial_participants (id,user_id,participant_kind,onboarding_state) values ('00000000-0000-4000-8000-000000000073'::uuid,${user}::uuid,'CENTER','PENDING')`)).rejects.toSatisfy((error: { cause?: { code?: string } }) => error.cause?.code === "23514");
    await expect(database.db.execute(sql`insert into organization_profiles (participant_id,participant_kind,legal_name) values (${id}::uuid,'EXPERT','bad')`)).rejects.toSatisfy((error: { cause?: { code?: string } }) => error.cause?.code === "23514");
  });

  it("rejects invalid policy arithmetic and immutable mutations", async () => {
    await expect(database.db.execute(sql`insert into partner_tariff_policy_versions (id,policy_version_id,policy_version,partner_kind,standard_price_minor,referred_six_price_minor,referred_ten_price_minor,online_only_surcharge_minor,city_million_plus_surcharge_minor,currency,duration_seconds,event_entitlements,resident_commission_bps,nonresident_commission_bps,nonresident_card_fee_minor,effective_from) values ('00000000-0000-4000-8000-000000000074'::uuid,'p',1,'CENTER',0,1200000,800000,300000,500000,'RUB',2592000,'{"bands":[{"capacity":30,"count":10}]}'::jsonb,1000,1500,450000,now())`)).rejects.toSatisfy((error: { cause?: { code?: string } }) => error.cause?.code === "23514");
    await expect(database.db.execute(sql`insert into partner_tariff_policy_versions (id,policy_version_id,policy_version,partner_kind,standard_price_minor,referred_six_price_minor,referred_ten_price_minor,online_only_surcharge_minor,city_million_plus_surcharge_minor,currency,duration_seconds,event_entitlements,resident_commission_bps,nonresident_commission_bps,nonresident_card_fee_minor,effective_from) values ('00000000-0000-4000-8000-000000000075'::uuid,'p',1,'CENTER',1500000,1200000,800000,300000,500000,'RUB',2592000,'{"bands":[{"capacity":30,"count":10}]}'::jsonb,1000,1500,450000,now())`)).resolves.toBeDefined();
    await expect(database.db.execute(sql`update partner_tariff_policy_versions set standard_price_minor=2 where id='00000000-0000-4000-8000-000000000075'::uuid`)).rejects.toSatisfy((error: { cause?: { code?: string } }) => error.cause?.code === "23514");
    await expect(database.db.execute(sql`delete from partner_tariff_policy_versions where id='00000000-0000-4000-8000-000000000075'::uuid`)).rejects.toSatisfy((error: { cause?: { code?: string } }) => error.cause?.code === "23514");
  });
});
