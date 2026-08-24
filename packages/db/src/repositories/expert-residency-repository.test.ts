import { randomUUID } from "node:crypto";
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
  it("creates one active tariff version and exposes a string-money quote", async () => {
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

    await expect(repo.quote({
      expertId: expert.expertId,
      tariffKey: "residency-month",
    })).resolves.toMatchObject({
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

    await expect(repo.createTariffVersion({
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
    })).rejects.toMatchObject({ code: "tariff_activation_overlap" });
  });
});
