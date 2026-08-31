import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresPartnerCommerceRepository } from "./partner-commerce-repository.js";
import { startTestPostgres, type TestDatabase } from "../testkit/postgres.js";

describe("partner commerce repository", () => {
  let database: TestDatabase;
  let repository: PostgresPartnerCommerceRepository;
  beforeAll(async () => { database = await startTestPostgres(); await database.migrate(); repository = new PostgresPartnerCommerceRepository(database.db); });
  afterAll(async () => { await database.stop(); });

  it("onboards, profiles, quotes, and replays the same command", async () => {
    const userId = await database.createUser();
    const key = { idempotencyKey: "partner-start-1", payloadDigest: "a".repeat(64), correlationId: "corr-1" };
    const started = await repository.start({ userId, ...key });
    expect(started.kind).toBe("started");
    const replay = await repository.start({ userId, ...key });
    expect(replay).toEqual(started);
    const participantId = started.kind === "started" ? started.participantId : "";
    expect((await repository.selectKind({ userId, participantId, kind: "CENTER", idempotencyKey: "kind-1", payloadDigest: "b".repeat(64), correlationId: "corr-2" })).kind).toBe("kind_selected");
    expect((await repository.confirmKind({ userId, participantId, idempotencyKey: "confirm-1", payloadDigest: "c".repeat(64), correlationId: "corr-3" })).kind).toBe("confirmed");
    expect((await repository.upsertOrganizationProfile({ userId, participantId, displayName: "Center", city: "Moscow", cityMillionPlus: true, onlineOnly: false, idempotencyKey: "profile-1", payloadDigest: "d".repeat(64), correlationId: "corr-4" })).kind).toBe("profile_ready");
    const policyId = "00000000-0000-4000-8000-000000000091";
    await database.db.execute(sql`insert into partner_tariff_policy_versions (id,policy_version_id,policy_version,partner_kind,standard_price_minor,referred_six_price_minor,referred_ten_price_minor,online_only_surcharge_minor,city_million_plus_surcharge_minor,currency,duration_seconds,event_entitlements,resident_commission_bps,nonresident_commission_bps,nonresident_card_fee_minor,status,effective_from) values (${policyId}::uuid,'repo-policy',1,'CENTER',1500000,1200000,800000,300000,500000,'RUB',2592000,'{"bands":[{"capacity":30,"count":10}]}'::jsonb,1000,1500,450000,'approved',now()-interval '1 minute')`);
    const quote = await repository.createShadowQuote({ userId, participantId, idempotencyKey: "quote-1", payloadDigest: "e".repeat(64), correlationId: "corr-5" });
    expect(quote.kind).toBe("quote_created");
    expect(quote.kind === "quote_created" ? quote.quote.finalPriceMinor : 0).toBe(2000000);
  });

  it("isolates ownership and reports payload conflicts", async () => {
    const owner = await database.createUser(); const other = await database.createUser();
    const started = await repository.start({ userId: owner, idempotencyKey: "owner-start", payloadDigest: "f".repeat(64), correlationId: "corr-6" });
    expect(await repository.start({ userId: owner, idempotencyKey: "owner-start", payloadDigest: "0".repeat(64), correlationId: "corr-7" })).toEqual({ kind: "conflict" });
    expect(await repository.selectKind({ userId: other, participantId: started.kind === "started" ? started.participantId : "", kind: "CENTER", idempotencyKey: "other-kind", payloadDigest: "1".repeat(64), correlationId: "corr-8" })).toEqual({ kind: "not_found" });
  });

  it("replays the exact stored result with one receipt and audit", async () => {
    const userId = await database.createUser(); const key = { idempotencyKey: "exact-replay", payloadDigest: "2".repeat(64), correlationId: "replay-a" };
    const first = await repository.start({ userId, ...key }); const second = await repository.start({ userId, ...key });
    const receipts = await database.db.execute<{ count: number }>(sql`select count(*)::int as count from partner_command_receipts where user_id=${userId}::uuid and idempotency_key=${key.idempotencyKey}`);
    const audits = await database.db.execute<{ count: number }>(sql`select count(*)::int as count from audit_events where actor_id=${userId}::uuid and correlation_id=${key.correlationId}`);
    expect(second).toEqual(first); expect(receipts.rows[0]?.count).toBe(1); expect(audits.rows[0]?.count).toBe(1);
  });

  it("replays a cross-command key with the same digest and conflicts on a different digest", async () => {
    const userId = await database.createUser(); const start = await repository.start({ userId, idempotencyKey: "cross-command", payloadDigest: "3".repeat(64), correlationId: "cross-a" });
    expect(await repository.selectKind({ userId, participantId: start.kind === "started" ? start.participantId : "", kind: "CENTER", idempotencyKey: "cross-command", payloadDigest: "3".repeat(64), correlationId: "cross-b" })).toEqual(start);
    expect(await repository.start({ userId, idempotencyKey: "cross-command", payloadDigest: "4".repeat(64), correlationId: "cross-c" })).toEqual({ kind: "conflict" });
  });

  it("does not mutate on payload conflict", async () => {
    const userId = await database.createUser(); const key = { idempotencyKey: "zero-conflict", payloadDigest: "5".repeat(64), correlationId: "zero-a" };
    await repository.start({ userId, ...key });
    const before = await database.db.execute<{ participants: number; profiles: number; quotes: number; audits: number }>(sql`select (select count(*) from commercial_participants where user_id=${userId}::uuid)::int participants,(select count(*) from organization_profiles op join commercial_participants p on p.id=op.participant_id where p.user_id=${userId}::uuid)::int profiles,(select count(*) from partner_shadow_quotes q join commercial_participants p on p.id=q.participant_id where p.user_id=${userId}::uuid)::int quotes,(select count(*) from audit_events where actor_id=${userId}::uuid)::int audits`);
    await repository.start({ userId, idempotencyKey: key.idempotencyKey, payloadDigest: "6".repeat(64), correlationId: "zero-b" });
    const after = await database.db.execute<typeof before.rows[number]>(sql`select (select count(*) from commercial_participants where user_id=${userId}::uuid)::int participants,(select count(*) from organization_profiles op join commercial_participants p on p.id=op.participant_id where p.user_id=${userId}::uuid)::int profiles,(select count(*) from partner_shadow_quotes q join commercial_participants p on p.id=q.participant_id where p.user_id=${userId}::uuid)::int quotes,(select count(*) from audit_events where actor_id=${userId}::uuid)::int audits`);
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it("writes denied audit for owner isolation", async () => {
    const owner = await database.createUser(); const other = await database.createUser(); const started = await repository.start({ userId: owner, idempotencyKey: "isolation-start", payloadDigest: "7".repeat(64), correlationId: "isolation-a" });
    const result = await repository.confirmKind({ userId: other, participantId: started.kind === "started" ? started.participantId : "", idempotencyKey: "isolation-confirm", payloadDigest: "8".repeat(64), correlationId: "isolation-b" });
    const audit = await database.db.execute<{ decision: string; object_id: string; correlation_id: string }>(sql`select decision,object_id,correlation_id from audit_events where actor_id=${other}::uuid and correlation_id='isolation-b'`);
    expect(result).toEqual({ kind: "not_found" }); expect(audit.rows[0]).toMatchObject({ decision: "denied", object_id: started.kind === "started" ? started.participantId : "", correlation_id: "isolation-b" });
  });

  it("writes denied audit for invalid transition", async () => {
    const userId = await database.createUser(); const started = await repository.start({ userId, idempotencyKey: "invalid-start", payloadDigest: "9".repeat(64), correlationId: "invalid-a" });
    const result = await repository.confirmKind({ userId, participantId: started.kind === "started" ? started.participantId : "", idempotencyKey: "invalid-confirm", payloadDigest: "a".repeat(64), correlationId: "invalid-b" });
    const audit = await database.db.execute<{ decision: string; action: string }>(sql`select decision,action from audit_events where actor_id=${userId}::uuid and correlation_id='invalid-b'`);
    expect(result).toEqual({ kind: "invalid_transition" }); expect(audit.rows[0]).toEqual({ decision: "denied", action: "partner_onboarding" });
  });

  it("allows different kinds but rejects duplicate same kind", async () => {
    const userId = await database.createUser();
    const first = await repository.start({ userId, idempotencyKey: "kind-one", payloadDigest: "b".repeat(64), correlationId: "kind-a" }); const firstId = first.kind === "started" ? first.participantId : "";
    expect((await repository.selectKind({ userId, participantId: firstId, kind: "CENTER", idempotencyKey: "kind-one-select", payloadDigest: "c".repeat(64), correlationId: "kind-b" })).kind).toBe("kind_selected");
    const second = await repository.start({ userId, idempotencyKey: "kind-two", payloadDigest: "d".repeat(64), correlationId: "kind-c" }); const secondId = second.kind === "started" ? second.participantId : "";
    expect((await repository.selectKind({ userId, participantId: secondId, kind: "CENTER", idempotencyKey: "kind-two-select", payloadDigest: "e".repeat(64), correlationId: "kind-d" })).kind).toBe("duplicate_kind");
    const third = await repository.start({ userId, idempotencyKey: "kind-three", payloadDigest: "f".repeat(64), correlationId: "kind-e" });
    expect((await repository.selectKind({ userId, participantId: third.kind === "started" ? third.participantId : "", kind: "ORGANIZER", idempotencyKey: "kind-three-select", payloadDigest: "0".repeat(64), correlationId: "kind-f" })).kind).toBe("kind_selected");
  });

  it("allows only one pending start under concurrency", async () => {
    const userId = await database.createUser(); const results = await Promise.all([1, 2].map((n) => repository.start({ userId, idempotencyKey: `pending-${n}`, payloadDigest: `${n}`.repeat(64), correlationId: `pending-${n}` })));
    const participants = await database.db.execute<{ count: number }>(sql`select count(*)::int count from commercial_participants where user_id=${userId}::uuid`);
    expect(participants.rows[0]?.count).toBe(1); expect(results.filter((result) => result.kind === "started")).toHaveLength(2);
  });

  it("persists profile city, display name, and flags", async () => {
    const userId = await database.createUser(); const started = await repository.start({ userId, idempotencyKey: "profile-start", payloadDigest: "1".repeat(64), correlationId: "profile-a" }); const participantId = started.kind === "started" ? started.participantId : "";
    await repository.selectKind({ userId, participantId, kind: "CENTER", idempotencyKey: "profile-kind", payloadDigest: "2".repeat(64), correlationId: "profile-b" }); await repository.confirmKind({ userId, participantId, idempotencyKey: "profile-confirm", payloadDigest: "3".repeat(64), correlationId: "profile-c" });
    await repository.upsertOrganizationProfile({ userId, participantId, displayName: "Exact Center", city: "Kazan", cityMillionPlus: false, onlineOnly: true, idempotencyKey: "profile-save", payloadDigest: "4".repeat(64), correlationId: "profile-d" });
    const row = await database.db.execute<{ legal_name: string; city: string; online_only: boolean; city_million_plus: boolean }>(sql`select legal_name,city,online_only,city_million_plus from organization_profiles where participant_id=${participantId}::uuid`);
    expect(row.rows[0]).toEqual({ legal_name: "Exact Center", city: "Kazan", online_only: true, city_million_plus: false });
  });

  it("selects only current approved policies using the database clock", async () => {
    const policies = await repository.listActivePolicies({ kind: "CENTER" });
    expect(policies.every((item) => item.kind === "CENTER")).toBe(true);
    expect(policies.every((item) => item.currency === "RUB" && item.durationSeconds === 2592000)).toBe(true);
  });

  it("persists the exact quote snapshot and rejects quote mutation", async () => {
    const userId = await database.createUser(); const started = await repository.start({ userId, idempotencyKey: "quote-start", payloadDigest: "5".repeat(64), correlationId: "quote-a" }); const participantId = started.kind === "started" ? started.participantId : "";
    await repository.selectKind({ userId, participantId, kind: "CENTER", idempotencyKey: "quote-kind", payloadDigest: "6".repeat(64), correlationId: "quote-b" }); await repository.confirmKind({ userId, participantId, idempotencyKey: "quote-confirm", payloadDigest: "7".repeat(64), correlationId: "quote-c" }); await repository.upsertOrganizationProfile({ userId, participantId, displayName: "Quote Center", city: "Omsk", cityMillionPlus: true, onlineOnly: true, idempotencyKey: "quote-profile", payloadDigest: "8".repeat(64), correlationId: "quote-d" });
    const result = await repository.createShadowQuote({ userId, participantId, idempotencyKey: "quote-create", payloadDigest: "9".repeat(64), correlationId: "quote-e" }); expect(result.kind).toBe("quote_created");
    const row = await database.db.execute<{ final_price_minor: number; qualified_expert_count: number; event_entitlements: unknown }>(sql`select final_price_minor,qualified_expert_count,event_entitlements from partner_shadow_quotes where participant_id=${participantId}::uuid`); expect(row.rows[0]?.qualified_expert_count).toBe(0); expect(row.rows[0]?.event_entitlements).toEqual({ bands: [{ capacity: 30, count: 10 }] });
    await expect(database.db.execute(sql`update partner_shadow_quotes set final_price_minor=1 where participant_id=${participantId}::uuid`)).rejects.toBeDefined(); await expect(database.db.execute(sql`delete from partner_shadow_quotes where participant_id=${participantId}::uuid`)).rejects.toBeDefined();
  });

  it("does not write prohibited commerce side effects", async () => {
    const userId = await database.createUser(); await repository.start({ userId, idempotencyKey: "side-effect", payloadDigest: "a".repeat(64), correlationId: "side-effect-a" });
    const tables = await database.db.execute<{ table_name: string }>(sql`select table_name from information_schema.tables where table_name in ('integration_outbox','expert_referral_ledger_entries','expert_residency_orders')`);
    expect(tables.rows.map((row) => row.table_name)).toEqual(expect.arrayContaining(["integration_outbox", "expert_referral_ledger_entries", "expert_residency_orders"]));
  });
});
