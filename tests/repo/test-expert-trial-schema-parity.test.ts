import { readFileSync } from "node:fs";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "../../packages/db/src/schema/index.js";

const names = (table: Parameters<typeof getTableConfig>[0]) => {
  const config = getTableConfig(table);
  return {
    checks: config.checks.map(({ name }) => name),
    indexes: config.indexes.map(({ config: index }) => index.name),
    uniques: config.uniqueConstraints.map(({ name }) => name),
  };
};

describe("test expert trial schema parity", () => {
  it("exports the five separate authority tables and exact cap checks", () => {
    expect(schema).toHaveProperty("testExpertCampaignVersions");
    expect(schema).toHaveProperty("testExpertRedemptions");
    expect(schema).toHaveProperty("testExpertReservations");
    expect(schema).toHaveProperty("testExpertOutcomes");
    expect(schema).toHaveProperty("testExpertAuditEvents");
    expect(names(schema.testExpertCampaignVersions).checks).toEqual(
      expect.arrayContaining([
        "test_expert_campaign_cap_check",
        "test_expert_campaign_provider_calls_check",
      ]),
    );
    expect(names(schema.testExpertRedemptions).checks).toContain(
      "test_expert_redemption_capacity_check",
    );
    expect(names(schema.testExpertReservations).checks).toContain(
      "test_expert_reservation_units_check",
    );
  });

  it("keeps migration additive, inactive by default, and detached from financial ledgers", () => {
    const migration = readFileSync(
      "packages/db/migrations/0038_test_expert_trial.sql",
      "utf8",
    );
    expect(migration).toContain("cap_units integer not null default 100");
    expect(migration).toContain(
      "provider_calls_per_message integer not null default 1",
    );
    expect(migration).toContain("status text not null default 'inactive'");
    expect(migration).toContain(
      "consumed_units + reserved_units <= granted_units",
    );
    expect(migration).not.toMatch(
      /message_packages|coupon|referral|partner|selarti_budget/iu,
    );
    expect(
      readFileSync("packages/db/migrations/meta/_journal.json", "utf8"),
    ).toContain("0038_test_expert_trial");
  });
});
