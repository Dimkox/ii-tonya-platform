import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PostgresExpertResidencyRepository } from "../../packages/db/src/repositories/expert-residency-repository.js";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../../packages/db/src/testkit/expert-referral.js";

let testDb: ExpertReferralTestDatabase | undefined;

describe("expert residency active tariff discovery", () => {
  beforeAll(async () => {
    testDb = await startExpertReferralTestDatabase();
  }, 120_000);

  beforeEach(async () => {
    await testDb!.reset();
  });

  afterAll(async () => {
    await testDb?.stop();
  });

  it("returns only the first 20 currently effective tariffs in database order", async () => {
    await testDb!.enableExpertReferralCommands();
    const expert = await testDb!.createExpertIdentity();
    const audit = await testDb!.createAdminAudit({
      action: "expert_residency.tariff_create",
      objectId: randomUUID(),
    });
    const repository = new PostgresExpertResidencyRepository(testDb!.db);
    const referenceNow = Date.now();
    const active: { id: string; activeFrom: Date }[] = [];
    for (let index = 0; index < 21; index += 1) {
      const activeFrom = new Date(referenceNow - (120 - index) * 60_000);
      const tariff = await repository.createTariffVersion({
        tariffKey: `active-${index}`,
        displayName: `Active ${index}`,
        priceMinor: BigInt(100_000 + index),
        durationSeconds: 86_400,
        activeFrom,
        activeTo: new Date(referenceNow + 86_400_000),
        approvalId: audit.approvalId,
        adminSessionIdHash: audit.sessionIdHash,
      });
      active.push({ id: tariff.id, activeFrom });
    }
    const expired = await repository.createTariffVersion({
      tariffKey: "expired",
      displayName: "Expired",
      priceMinor: 90_000n,
      durationSeconds: 86_400,
      activeFrom: new Date(referenceNow - 172_800_000),
      activeTo: new Date(referenceNow - 86_400_000),
      approvalId: audit.approvalId,
      adminSessionIdHash: audit.sessionIdHash,
    });
    const future = await repository.createTariffVersion({
      tariffKey: "future",
      displayName: "Future",
      priceMinor: 110_000n,
      durationSeconds: 86_400,
      activeFrom: new Date(referenceNow + 86_400_000),
      activeTo: new Date(referenceNow + 172_800_000),
      approvalId: audit.approvalId,
      adminSessionIdHash: audit.sessionIdHash,
    });

    const result = await repository.listActiveTariffs({
      expertId: expert.expertId,
      limit: 20,
    });

    expect(result).toHaveLength(20);
    expect(result.map((tariff) => tariff.tariffVersionId)).toEqual(
      active
        .sort(
          (left, right) =>
            left.activeFrom.getTime() - right.activeFrom.getTime() ||
            left.id.localeCompare(right.id),
        )
        .slice(0, 20)
        .map((tariff) => tariff.id),
    );
    expect(result.map((tariff) => tariff.tariffVersionId)).not.toContain(
      expired.id,
    );
    expect(result.map((tariff) => tariff.tariffVersionId)).not.toContain(
      future.id,
    );
    expect(result[0]).toMatchObject({
      currency: "RUB",
      durationSeconds: 86_400,
    });
  });

  it("denies an expert deactivated before the discovery read", async () => {
    await testDb!.enableExpertReferralCommands();
    const expert = await testDb!.createExpertIdentity();
    await testDb!.db.execute(
      sql`update experts set active=false where id=${expert.expertId}::uuid`,
    );

    await expect(
      new PostgresExpertResidencyRepository(testDb!.db).listActiveTariffs({
        expertId: expert.expertId,
        limit: 20,
      }),
    ).rejects.toMatchObject({
      code: "EXPERT_RESIDENCY_EXPERT_NOT_ELIGIBLE",
    });
  });
});
