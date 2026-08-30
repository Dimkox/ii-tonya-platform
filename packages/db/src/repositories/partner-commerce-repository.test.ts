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
});
