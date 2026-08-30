import { getTableConfig, type AnyPgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "../../packages/db/src/schema/index.js";

const names = (table: AnyPgTable) => {
  const config = getTableConfig(table);
  return {
    checks: config.checks.map(({ name }) => name).sort(),
    foreignKeys: config.foreignKeys.map((foreignKey) => foreignKey.getName()).sort(),
    indexes: config.indexes.map(({ config: index }) => index.name).sort(),
    uniques: config.uniqueConstraints.map(({ name }) => name).sort(),
  };
};

describe("partner commerce schema parity", () => {
  it("exports all foundation relations", () => {
    for (const name of ["commercialParticipants", "organizationProfiles", "partnerTariffPolicyVersions", "partnerShadowQuotes", "partnerCommandReceipts"]) {
      expect(schema, name).toHaveProperty(name);
    }
  });

  it("describes required constraints and indexes", () => {
    expect(names(schema.commercialParticipants)).toMatchObject({
      checks: ["commercial_participants_kind_check", "commercial_participants_onboarding_state_check"],
      uniques: ["commercial_participants_id_kind_unique", "commercial_participants_user_kind_unique"],
    });
    expect(names(schema.organizationProfiles).checks).toEqual(["organization_profiles_kind_check", "organization_profiles_legal_name_check", "organization_profiles_verification_check"]);
    expect(names(schema.partnerTariffPolicyVersions).checks).toEqual(expect.arrayContaining([
      "partner_tariff_policy_versions_currency_check", "partner_tariff_policy_versions_entitlements_check", "partner_tariff_policy_versions_money_check", "partner_tariff_policy_versions_window_check",
    ]));
    expect(names(schema.partnerTariffPolicyVersions).indexes).toContain("partner_tariff_policy_versions_active_idx");
    expect(names(schema.partnerShadowQuotes).checks).toContain("partner_shadow_quotes_arithmetic_check");
  });
});
