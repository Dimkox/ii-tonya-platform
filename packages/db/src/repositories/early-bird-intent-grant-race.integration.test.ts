import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { seedEarlyBirdDraftRequest } from "../testkit/early-bird-draft-request.js";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../testkit/expert-referral.js";
import { ownerPricingApproval } from "../testkit/owner-pricing-approval.js";
let db: ExpertReferralTestDatabase;
let configId: string;
beforeAll(async () => {
  db = await startExpertReferralTestDatabase();
  const cfg = await db.db.transaction(async (tx) => {
    await tx.execute(
      sql`update early_bird_launch_configs set active=false where active`,
    );
    return (
      await tx.execute<{ id: string }>(
        sql`insert into early_bird_launch_configs(phase,enrollment_start_at,client_start_at,promo_deadline_days,final_call_trigger_at) values('WAVE_1_EARLY_BIRD','2026-11-01 00:00:00+03','2027-01-11 00:00:00+03',10,'2026-12-28 10:00:00+03') returning id`,
      )
    ).rows[0]!.id;
  });
  configId = cfg;
  await db.db.execute(
    sql`create or replace function early_bird_current_time() returns timestamptz language sql volatile as $$ select '2026-11-02T00:00:00+03:00'::timestamptz $$`,
  );
  const draft = readFileSync(
    "docs/superpowers/implementation-artifacts/drafts/0078_early_bird_intents.sql",
    "utf8",
  );
  await db.db.execute(sql.raw(draft));
}, 120_000);
afterAll(async () => {
  await db?.stop();
}, 120_000);
it("serializes grant revocation against an impending provider dispatch", async () => {
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
  await db.db.execute(
    sql`insert into early_bird_choices(id,user_id,base_id,positive_choice_id,revision,choice,request_key,request_digest) values(${choice}::uuid,${user}::uuid,${base}::uuid,${positive}::uuid,1,'now','wave-1',${"b".repeat(64)})`,
  );
  const admin = await db.createAdminAudit({
    action: "fixture",
    objectId: randomUUID(),
  });
  const approval = await ownerPricingApproval(db, {
    action: "grant",
    target: user,
    adminId: admin.adminId,
    sessionIdHash: admin.sessionIdHash,
  });
  const grant = randomUUID();
  await db.db.execute(
    sql`insert into owner_test_pricing_grants(id,user_id,granted_by,grant_session_hash,grant_approval_id) values(${grant}::uuid,${user}::uuid,${admin.adminId}::uuid,${admin.sessionIdHash},${approval}::uuid)`,
  );
  const operation = randomUUID(),
    invoice = randomUUID(),
    idem = randomUUID();
  const insert = (grantId: string) =>
    db.db.execute(
      sql`insert into early_bird_composite_intents(id,invoice_id,user_id,base_id,choice_id,grant_id,config_id,pricing_policy,idempotency_key,onboarding_minor,subscription_minor,total_minor,base_offer_shown_at,expires_at,launch_at,request_digest) select ${operation}::uuid,${invoice}::uuid,b.user_id,b.id,${choice}::uuid,${grantId}::uuid,${configId}::uuid,'owner_test_10_20_v1',${idem}::uuid,1000,2000,3000,b.base_offer_shown_at,b.base_offer_shown_at+interval '240 hours','2027-01-10T21:00:00Z',${`sha256:${"c".repeat(64)}`} from expert_sales_bases b where b.id=${base}::uuid`,
    );
  await insert(grant);
  await seedEarlyBirdDraftRequest(db.db, {
    intentId: operation,
    userId: user,
    idempotencyKey: idem,
    digest: `sha256:${"c".repeat(64)}`,
  });
  const revoke = await ownerPricingApproval(db, {
    action: "revoke",
    target: grant,
    adminId: admin.adminId,
    sessionIdHash: admin.sessionIdHash,
  });
  const first = await db.db.$client.connect(),
    second = await db.db.$client.connect();
  try {
    const pid = (
      await second.query<{ pid: number }>("select pg_backend_pid() pid")
    ).rows[0]!.pid;
    await first.query("begin");
    await first.query(
      "update owner_test_pricing_grants set revoked_at=clock_timestamp(),revoked_by=$1,revoke_session_hash=$2,revoke_approval_id=$3 where id=$4",
      [admin.adminId, admin.sessionIdHash, revoke, grant],
    );
    const pending = second
      .query(
        "update early_bird_composite_intents set status='unknown' where id=$1",
        [operation],
      )
      .then(
        () => null,
        (error: Error) => error,
      );
    const deadline = Date.now() + 10000;
    let waiting = false;
    while (Date.now() < deadline) {
      const r = await db.db.execute<{ waiting: boolean }>(
        sql`select wait_event_type='Lock' waiting from pg_stat_activity where pid=${pid}`,
      );
      if (r.rows[0]?.waiting) {
        waiting = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(waiting).toBe(true);
    await first.query("commit");
    expect((await pending)?.message).toMatch(
      /early_bird_intent_dispatch_source/u,
    );
  } finally {
    await first.query("rollback");
    first.release();
    second.release();
  }
}, 120_000);
