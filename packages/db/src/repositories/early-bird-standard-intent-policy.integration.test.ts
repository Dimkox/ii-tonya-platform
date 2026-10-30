import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { seedEarlyBirdDraftRequest } from "../testkit/early-bird-draft-request.js";
import { calculateSeparatedSalesTerms } from "@ii-tonya/domain";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../testkit/expert-referral.js";
let db: ExpertReferralTestDatabase;
beforeAll(async () => {
  db = await startExpertReferralTestDatabase();
  await db.db.execute(
    sql`create or replace function early_bird_current_time() returns timestamptz language sql volatile as $$ select '2026-11-02T00:00:00+03:00'::timestamptz $$`,
  );
  await db.db.execute(
    sql.raw(
      readFileSync(
        "docs/superpowers/implementation-artifacts/drafts/0078_early_bird_intents.sql",
        "utf8",
      ),
    ),
  );
}, 120_000);
afterAll(async () => {
  await db?.stop();
}, 120_000);
it("admits the standard one-payment price only under the active wave configuration", async () => {
  const { seedClientConsent } = await import("../testkit/client-consent.js");
  const user = await db.createUser();
  await seedClientConsent(db.db, user, "client_messaging");
  await db.db.execute(
    sql`insert into channel_identities(user_id,provider,external_id,bot_key,external_chat_id) values(${user}::uuid,'telegram','123456','fixture-bot','123456')`,
  );
  await db.db.execute(
    sql`insert into expert_offer_profiles(user_id,revision,city_code,million_city,service_format,ticket_minor,participant_kind,idempotency_key) values(${user}::uuid,1,'fixture',false,'offline',300000,'expert','fixture-profile')`,
  );
  const tariff = await db.createResidencyTariff({
    tariffKey: "PRO",
    displayName: "PRO",
    priceMinor: 1000000,
    durationSeconds: 2592000,
  });
  const base = randomUUID(),
    positive = randomUUID(),
    choice = randomUUID();
  await db.db.execute(
    sql`insert into expert_sales_bases(id,user_id,tariff_version_id,profile_revision,base_tariff_amount,participant_kind,bot_id,bot_key,chat_id,consent_version) select ${base}::uuid,${user}::uuid,t.id,1,greatest(500000,t.price_minor),'expert','1','fixture-bot','123456','client-messaging-v1' from expert_residency_tariff_versions t where t.id=${tariff}::uuid`,
  );
  await db.db.execute(
    sql`insert into expert_sales_choices(id,base_id,user_id,revision,action,request_key,request_digest) values(${positive}::uuid,${base}::uuid,${user}::uuid,1,'positive','positive-1',${"a".repeat(64)})`,
  );
  const config = await db.db.transaction(async (tx) => {
    await tx.execute(
      sql`update early_bird_launch_configs set active=false where active`,
    );
    return (
      await tx.execute<{ id: string }>(
        sql`insert into early_bird_launch_configs(phase,enrollment_start_at,client_start_at,promo_deadline_days,final_call_trigger_at) values('WAVE_1_EARLY_BIRD','2026-11-01 00:00:00+03','2027-01-11 00:00:00+03',10,'2026-12-28 10:00:00+03') returning id`,
      )
    ).rows[0]!.id;
  });
  await db.db.execute(
    sql`insert into early_bird_choices(id,user_id,base_id,positive_choice_id,revision,choice,request_key,request_digest) values(${choice}::uuid,${user}::uuid,${base}::uuid,${positive}::uuid,1,'now','wave-1',${"b".repeat(64)})`,
  );
  const b = (
    await db.db.execute<{ amount: string; first: string }>(
      sql`select base_tariff_amount::text amount,base_offer_shown_at::text first from expert_sales_bases where id=${base}::uuid`,
    )
  ).rows[0]!;
  const monthly = calculateSeparatedSalesTerms({
    baseMonthlyMinor: BigInt(b.amount),
    participantKind: "expert",
    firstOfferAtMs: Date.parse(b.first),
    quotedAtMs: Date.parse("2026-11-02T00:00:00+03:00"),
    promotion: true,
    termMonths: 1,
  }).monthlyPriceMinor;
  const op = randomUUID(),
    invoice = randomUUID(),
    idem = randomUUID();
  const insert = (amount: bigint) =>
    db.db.execute(
      sql`insert into early_bird_composite_intents(id,invoice_id,user_id,base_id,choice_id,grant_id,config_id,pricing_policy,idempotency_key,onboarding_minor,subscription_minor,total_minor,base_offer_shown_at,expires_at,launch_at,request_digest) select ${op}::uuid,${invoice}::uuid,b.user_id,b.id,${choice}::uuid,null,${config}::uuid,'wave1_standard_v1',${idem}::uuid,300000,${amount.toString()}::bigint,${(amount + 300000n).toString()}::bigint,b.base_offer_shown_at,b.base_offer_shown_at+interval '240 hours','2027-01-10T21:00:00Z',${`sha256:${"c".repeat(64)}`} from expert_sales_bases b where b.id=${base}::uuid`,
    );
  await expect(insert(monthly + 1n)).rejects.toThrow();
  await expect(insert(monthly)).resolves.toBeDefined();
  await seedEarlyBirdDraftRequest(db.db, {
    intentId: op,
    userId: user,
    idempotencyKey: idem,
    digest: `sha256:${"c".repeat(64)}`,
  });
  await expect(
    db.db.execute(
      sql`update early_bird_composite_intents set status='unknown' where id=${op}::uuid`,
    ),
  ).resolves.toBeDefined();
  await expect(
    db.db.execute(
      sql`update early_bird_composite_intents set status='abandoned' where id=${op}::uuid`,
    ),
  ).rejects.toThrow();
  await expect(
    db.db.execute(
      sql`insert into expert_sales_choices(base_id,user_id,revision,action,request_key,request_digest) values(${base}::uuid,${user}::uuid,2,'promo','legacy-after-unknown',${"d".repeat(64)})`,
    ),
  ).rejects.toThrow();
}, 120_000);
