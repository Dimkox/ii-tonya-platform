import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PostgresExpertResidencyRepository } from "./expert-residency-repository.js";
import { ExpertReferralTestkit } from "../testkit/expert-referral.js";
import { startTestPostgres, type TestDatabase } from "../testkit/postgres.js";

let testDb: TestDatabase;
let fixtures: ExpertReferralTestkit;
let repo: PostgresExpertResidencyRepository;

beforeAll(async () => {
  testDb = await startTestPostgres();
  await testDb.migrate();
  fixtures = new ExpertReferralTestkit(testDb.db);
  repo = new PostgresExpertResidencyRepository(testDb.db);
}, 120_000);

beforeEach(async () => testDb.reset());
afterAll(async () => testDb?.stop(), 120_000);

describe("expert residency tariffs and quotes", () => {
  it("fails quote closed while durable new commands are disabled", async () => {
    const expert = await fixtures.createExpert();

    await expect(
      repo.quote({ expertId: expert.expertId, tariffKey: "residency-month" }),
    ).rejects.toMatchObject({ code: "expert_residency_commands_disabled" });
  });

  it("creates one active tariff version and exposes a string-money quote", async () => {
    await fixtures.enableFeatureControl();
    const tariffVersionId = randomUUID();
    const evidence = await fixtures.createAdminEvidence(
      "expert_residency.tariff_create",
      tariffVersionId,
      {
        tariffKey: "residency-month",
        version: 1,
        displayName: "Monthly residency",
        description: "Thirty-day expert residency",
        priceMinor: "250001",
        durationSeconds: 2_592_000,
        activeFrom: "2026-01-01T00:00:00.000Z",
        activeTo: null,
      },
    );
    const expert = await fixtures.createExpert();

    await repo.createTariffVersion({
      tariffVersionId,
      tariffKey: "residency-month",
      version: 1,
      displayName: "Monthly residency",
      description: "Thirty-day expert residency",
      priceMinor: 250001n,
      durationSeconds: 2_592_000,
      activeFrom: new Date("2026-01-01T00:00:00.000Z"),
      activeTo: null,
      ...evidence,
    });

    await expect(
      repo.quote({
        expertId: expert.expertId,
        tariffKey: "residency-month",
      }),
    ).resolves.toMatchObject({
      tariffVersionId,
      displayName: "Monthly residency",
      description: "Thirty-day expert residency",
      priceMinor: "250001",
      currency: "RUB",
      durationSeconds: 2_592_000,
      creditMinor: "0",
      cashMinor: "250001",
    });
  });

  it("rejects conflicting overlapping tariff versions", async () => {
    const firstId = randomUUID();
    const firstEvidence = await fixtures.createAdminEvidence(
      "expert_residency.tariff_create",
      firstId,
      {
        tariffKey: "residency-month",
        version: 1,
        displayName: "Monthly residency",
        description: "First",
        priceMinor: "100000",
        durationSeconds: 2_592_000,
        activeFrom: "2026-01-01T00:00:00.000Z",
        activeTo: "2027-01-01T00:00:00.000Z",
      },
    );
    await repo.createTariffVersion({
      tariffVersionId: firstId,
      tariffKey: "residency-month",
      version: 1,
      displayName: "Monthly residency",
      description: "First",
      priceMinor: 100000n,
      durationSeconds: 2_592_000,
      activeFrom: new Date("2026-01-01T00:00:00.000Z"),
      activeTo: new Date("2027-01-01T00:00:00.000Z"),
      ...firstEvidence,
    });
    const secondId = randomUUID();
    const secondEvidence = await fixtures.createAdminEvidence(
      "expert_residency.tariff_create",
      secondId,
      {
        tariffKey: "residency-month",
        version: 2,
        displayName: "Monthly residency",
        description: "Overlap",
        priceMinor: "100000",
        durationSeconds: 2_592_000,
        activeFrom: "2026-06-01T00:00:00.000Z",
        activeTo: null,
      },
    );

    await expect(
      repo.createTariffVersion({
        tariffVersionId: secondId,
        tariffKey: "residency-month",
        version: 2,
        displayName: "Monthly residency",
        description: "Overlap",
        priceMinor: 100000n,
        durationSeconds: 2_592_000,
        activeFrom: new Date("2026-06-01T00:00:00.000Z"),
        activeTo: null,
        ...secondEvidence,
      }),
    ).rejects.toMatchObject({ code: "tariff_activation_overlap" });
  });

  it("retires a tariff with exact approval binding and stable replay", async () => {
    await fixtures.enableFeatureControl();
    const expert = await fixtures.createExpert();
    const tariffVersionId = randomUUID();
    const tariffKey = `retirement-${randomUUID()}`;
    const activeFrom = new Date(Date.now() - 86_400_000);
    const retirementAt = new Date(Date.now() - 1_000);
    const createPayload = {
      tariffKey,
      version: 1,
      displayName: "Retiring residency",
      description: "Retirement test",
      priceMinor: "150000",
      durationSeconds: 2_592_000,
      activeFrom: activeFrom.toISOString(),
      activeTo: null,
    };
    const createEvidence = await fixtures.createAdminEvidence(
      "expert_residency.tariff_create",
      tariffVersionId,
      createPayload,
    );
    await repo.createTariffVersion({
      tariffVersionId,
      tariffKey,
      version: 1,
      displayName: "Retiring residency",
      description: "Retirement test",
      priceMinor: 150000n,
      durationSeconds: 2_592_000,
      activeFrom,
      activeTo: null,
      ...createEvidence,
    });
    await expect(
      repo.quote({ expertId: expert.expertId, tariffKey }),
    ).resolves.toMatchObject({ tariffVersionId });

    const retirePayload = { activeTo: retirementAt.toISOString() };
    const wrongEvidence = await fixtures.createAdminEvidence(
      "expert_residency.tariff_retire",
      randomUUID(),
      retirePayload,
    );
    await expect(
      repo.retireTariffVersion({
        tariffVersionId,
        activeTo: retirementAt,
        ...wrongEvidence,
      }),
    ).rejects.toMatchObject({ code: "admin_evidence_invalid" });
    const beforeRetirement = await testDb.db.execute<{
      activeTo: Date | null;
      approvalConsumed: boolean;
    }>(sql`
      select active_to as "activeTo",
        (select consumed_at is not null from admin_approvals
          where id = ${wrongEvidence.approvalId}::uuid) as "approvalConsumed"
      from expert_residency_tariff_versions
      where id = ${tariffVersionId}::uuid
    `);
    expect(beforeRetirement.rows[0]).toEqual({
      activeTo: null,
      approvalConsumed: false,
    });

    const retireEvidence = await fixtures.createAdminEvidence(
      "expert_residency.tariff_retire",
      tariffVersionId,
      retirePayload,
    );
    const retireCommand = {
      tariffVersionId,
      activeTo: retirementAt,
      ...retireEvidence,
    };
    await repo.retireTariffVersion(retireCommand);
    await expect(
      repo.retireTariffVersion(retireCommand),
    ).resolves.toBeUndefined();
    await expect(
      repo.retireTariffVersion({
        ...retireCommand,
        activeTo: new Date(retirementAt.getTime() + 1_000),
      }),
    ).rejects.toMatchObject({ code: "admin_evidence_invalid" });
    await expect(
      repo.quote({ expertId: expert.expertId, tariffKey }),
    ).rejects.toMatchObject({ code: "tariff_not_active" });
    const retired = await testDb.db.execute<{
      activeTo: Date;
      approvalConsumed: boolean;
      auditCount: number;
    }>(sql`
      select active_to as "activeTo",
        (select consumed_at is not null from admin_approvals
          where id = ${retireEvidence.approvalId}::uuid) as "approvalConsumed",
        (select count(*)::integer from audit_events
          where action = 'expert_residency.tariff_retire'
            and object_id = ${tariffVersionId}::uuid) as "auditCount"
      from expert_residency_tariff_versions
      where id = ${tariffVersionId}::uuid
    `);
    expect({
      ...retired.rows[0],
      activeTo: new Date(retired.rows[0]!.activeTo),
    }).toEqual({
      activeTo: retirementAt,
      approvalConsumed: true,
      auditCount: 1,
    });

    const replacementId = randomUUID();
    const replacementPayload = {
      ...createPayload,
      version: 2,
      displayName: "Replacement residency",
      activeFrom: retirementAt.toISOString(),
    };
    const replacementEvidence = await fixtures.createAdminEvidence(
      "expert_residency.tariff_create",
      replacementId,
      replacementPayload,
    );
    await repo.createTariffVersion({
      tariffVersionId: replacementId,
      tariffKey,
      version: 2,
      displayName: "Replacement residency",
      description: "Retirement test",
      priceMinor: 150000n,
      durationSeconds: 2_592_000,
      activeFrom: retirementAt,
      activeTo: null,
      ...replacementEvidence,
    });
    await expect(
      repo.quote({ expertId: expert.expertId, tariffKey }),
    ).resolves.toMatchObject({ tariffVersionId: replacementId });
  });
});
