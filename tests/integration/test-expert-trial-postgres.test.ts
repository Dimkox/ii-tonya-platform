import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresTestExpertTrialRepository } from "../../packages/db/src/repositories/test-expert-trial-repository.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

describe("test expert trial PostgreSQL authority", () => {
  let database: TestDatabase;
  beforeAll(async () => {
    database = await startTestPostgres();
    await database.migrate();
  }, 120_000);
  afterAll(async () => {
    await database?.stop();
  }, 60_000);

  it("upgrades through 0037 to 0038 without seeding active campaigns", async () => {
    const migrations = await database.db.execute<{ count: string }>(
      sql`select count(*)::text as count from drizzle.__drizzle_migrations`,
    );
    expect(Number(migrations.rows[0]?.count)).toBeGreaterThanOrEqual(39);
    const active = await database.db.execute<{ count: string }>(
      sql`select count(*)::text as count from test_expert_campaign_versions where status='active'`,
    );
    expect(active.rows[0]?.count).toBe("0");
  });

  it("enforces FK and cap constraints while concurrent reservations serialize", async () => {
    const userId = await database.createUser();
    const campaignId = "00000000-0000-4000-8000-000000000381";
    await database.db.execute(
      sql`insert into test_expert_campaign_versions (id,code,version) values (${campaignId}::uuid,'test-expert',1)`,
    );
    const repository = new PostgresTestExpertTrialRepository(database.db);
    const redemption = await repository.createOrGetRedemption({
      campaignVersionId: campaignId,
      userId,
      idempotencyKey: "pg-redemption-1",
    });
    const raced = await Promise.all(
      ["pg-request-a", "pg-request-b"].map((requestKey) =>
        repository.reserveAiTurn({
          redemptionId: redemption.id,
          requestKey,
          requestDigest: "a".repeat(64),
        }),
      ),
    );
    expect(raced).toHaveLength(2);
    await repository.recordOutcome({
      reservationId: raced[0]!.reservationId,
      outcome: "applied",
      providerRequestId: "provider-race-a",
    });
    await repository.recordOutcome({
      reservationId: raced[1]!.reservationId,
      outcome: "applied",
      providerRequestId: "provider-race-b",
    });
    const summary = await repository.summary(redemption.id);
    expect(summary).toMatchObject({ consumedUnits: 4, reservedUnits: 0 });
    await expect(
      database.db.execute(
        sql`insert into test_expert_redemptions (campaign_version_id,user_id,redemption_idempotency_key) values (${campaignId}::uuid,'00000000-0000-4000-8000-000000000399'::uuid,'bad-fk')`,
      ),
    ).rejects.toSatisfy(
      (error: { cause?: { code?: string } }) => error.cause?.code === "23503",
    );
  });

  it("keeps unknown reservations until explicit reconciliation and exposes an indexed lookup plan", async () => {
    const userId = await database.createUser();
    const campaignId = "00000000-0000-4000-8000-000000000382";
    await database.db.execute(
      sql`insert into test_expert_campaign_versions (id,code,version) values (${campaignId}::uuid,'test-expert',2)`,
    );
    const repository = new PostgresTestExpertTrialRepository(database.db);
    const redemption = await repository.createOrGetRedemption({
      campaignVersionId: campaignId,
      userId,
      idempotencyKey: "pg-redemption-2",
    });
    const reservation = await repository.reserveAiTurn({
      redemptionId: redemption.id,
      requestKey: "pg-request-unknown",
      requestDigest: "b".repeat(64),
    });
    await repository.recordOutcome({
      reservationId: reservation.reservationId,
      outcome: "unknown",
      providerRequestId: "provider-unknown-1",
    });
    await expect(repository.summary(redemption.id)).resolves.toMatchObject({
      consumedUnits: 0,
      reservedUnits: 2,
    });
    await expect(
      repository.reconcileUnknown({
        reservationId: reservation.reservationId,
        outcome: "not_applied",
        providerRequestId: "provider-unknown-1",
      }),
    ).resolves.toMatchObject({ consumedUnits: 0, reservedUnits: 0 });
    const plan = await database.db.execute<{ plan: string }>(
      sql`explain (format json) select id from test_expert_redemptions where id=${redemption.id}::uuid for update`,
    );
    expect(JSON.stringify(plan.rows)).toContain("test_expert_redemptions");
  });

  it("converges an identical same-key race and rejects a conflicting digest", async () => {
    const userId = await database.createUser();
    const campaignId = "00000000-0000-4000-8000-000000000383";
    await database.db.execute(
      sql`insert into test_expert_campaign_versions (id,code,version) values (${campaignId}::uuid,'test-expert-race',1)`,
    );
    const repository = new PostgresTestExpertTrialRepository(database.db);
    const redemption = await repository.createOrGetRedemption({
      campaignVersionId: campaignId,
      userId,
      idempotencyKey: `test-expert:${campaignId}:${userId}`,
    });
    const input = {
      redemptionId: redemption.id,
      requestKey: "telegram:race:test-expert",
      requestDigest: "c".repeat(64),
    };
    const [left, right] = await Promise.all([
      repository.reserveAiTurn(input),
      repository.reserveAiTurn(input),
    ]);
    expect(left.reservationId).toBe(right.reservationId);
    await expect(
      repository.reserveAiTurn({
        ...input,
        requestDigest: "d".repeat(64),
      }),
    ).rejects.toThrow("request_idempotency_conflict");
    await expect(repository.summary(redemption.id)).resolves.toMatchObject({
      consumedUnits: 0,
      reservedUnits: 2,
    });
  });
});
